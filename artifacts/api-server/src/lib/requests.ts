import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import type { Member } from "./education-access";
import { DomainError } from "./education-validation";
import { recordAudit } from "./audit";
import { sendMail, smtpConfigured } from "./smtp";
import { logger } from "./logger";

/**
 * Internal requests and tasks. A manager (General Manager or branch manager) sends a task to an employee; the SYSTEM stamps the four
 * stages itself: sent, received (the first time the assignee opens it), responded, closed (the manager approves).
 * Managers see everything in their scope; every other administrative role sees only the requests addressed to them.
 */
const MANAGE: string[] = ["super_admin", "branch_manager"];
const STAFF: string[] = ["super_admin", "branch_manager", "finance", "coordinator", "warehouse_keeper", "procurement_officer", "hr_officer"];
export const canUseRequests = (m: Member) => STAFF.includes(m.role);
export const canManageRequests = (m: Member) => MANAGE.includes(m.role);
const deny = (msg = "ليست لديك صلاحية لهذه العملية"): never => { throw new DomainError(msg, 403); };
const TYPES = ["registration", "upload", "report", "other"];
const PRIORITIES = ["normal", "high", "urgent"];

const text = (v: unknown, what: string, max: number, required = true) => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s && required) throw new DomainError(`${what} مطلوب`);
  if (s.length > max) throw new DomainError(`${what} طويل جدًا (الحد ${max} حرفًا)`);
  return s || null;
};
const positiveInt = (v: unknown, what: string) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new DomainError(`${what} غير صحيح`); return n; };

/** SQL fragment that restricts rows to what a manager may see. */
const managerScope = (m: Member) => (m.role === "super_admin" ? sql`true` : m.branchId == null ? sql`false` : sql`v.branch_id = ${m.branchId}`);
/** SQL fragment: the request is addressed to this signed-in member (matched by the linked account or the employee e-mail). */
const isMine = (m: Member) => sql`(v.assignee_org_member_id = ${m.id} or lower(v.assignee_email) = lower(${m.email}))`;

const COLS = sql`v.id::int as id, v.request_no as "requestNo", v.title, v.description, v.request_type as "requestType", v.priority, v.status,
  v.branch_id::int as "branchId", v.branch_name as "branchName", v.assignee_id::int as "assigneeId", v.assignee_name as "assigneeName",
  v.assignee_job_title as "assigneeJobTitle", v.assignee_email as "assigneeEmail", v.assignee_phone as "assigneePhone",
  v.created_by::int as "createdById", cm.email as "createdByEmail", v.due_at as "dueAt", v.sent_at as "sentAt", v.received_at as "receivedAt",
  v.responded_at as "respondedAt", v.closed_at as "closedAt", v.cancelled_at as "cancelledAt", v.response_text as "responseText",
  v.response_links as "responseLinks", v.close_note as "closeNote",
  v.receive_seconds::float8 as "receiveSeconds", v.response_seconds::float8 as "responseSeconds", v.total_seconds::float8 as "totalSeconds", v.is_late as "isLate"`;
const FROM = sql`from (select r.*, e.org_member_id as assignee_org_member_id from v_internal_requests r join employees e on e.id = r.assignee_id) v left join org_members cm on cm.id = v.created_by`;

type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows as Row[];

async function loadFor(m: Member, id: number): Promise<{ row: Row; mine: boolean; managed: boolean }> {
  const [row] = await rows(sql`select ${COLS}, (${isMine(m)}) as mine, (${managerScope(m)}) as managed ${FROM} where v.id = ${id}`);
  if (!row) throw new DomainError("الطلب غير موجود", 404);
  const managed = MANAGE.includes(m.role) && row.managed === true;
  const mine = row.mine === true;
  if (!managed && !mine) throw new DomainError("الطلب غير موجود", 404);
  return { row, mine, managed };
}

export async function requestsCatalogue(m: Member) {
  if (!canUseRequests(m)) deny();
  const canManage = canManageRequests(m);
  const employees = canManage ? await rows(sql`select e.id::int as id, e.full_name as name, jt.name as "jobTitle", e.email, e.phone, e.branch_id::int as "branchId", b.name as "branchName"
      from employees e join branches b on b.id = e.branch_id left join job_titles jt on jt.id = e.job_title_id
     where e.status = 'active' and ${m.role === "super_admin" ? sql`true` : m.branchId == null ? sql`false` : sql`e.branch_id = ${m.branchId}`} order by e.full_name`) : [];
  return {
    canManage, employees,
    types: [{ id: "registration", label: "تسجيل في موقع" }, { id: "upload", label: "رفع ملفات" }, { id: "report", label: "إعداد تقرير" }, { id: "other", label: "أخرى" }],
    priorities: [{ id: "normal", label: "عادية" }, { id: "high", label: "مهمة" }, { id: "urgent", label: "عاجلة" }],
  };
}

export async function listRequests(m: Member, scope: "managed" | "mine", f: { status?: unknown; assigneeId?: unknown; q?: unknown }) {
  if (!canUseRequests(m)) deny();
  if (scope === "managed" && !canManageRequests(m)) deny("المتابعة الشاملة للمدراء فقط");
  const conds = [scope === "managed" ? managerScope(m) : isMine(m)];
  if (typeof f.status === "string" && f.status) {
    if (!["sent", "received", "responded", "closed", "cancelled", "open", "late"].includes(f.status)) throw new DomainError("حالة غير صحيحة");
    conds.push(f.status === "open" ? sql`v.status in ('sent','received','responded')` : f.status === "late" ? sql`v.is_late` : sql`v.status = ${f.status}`);
  }
  if (f.assigneeId != null && f.assigneeId !== "") conds.push(sql`v.assignee_id = ${positiveInt(f.assigneeId, "الموظف")}`);
  if (typeof f.q === "string" && f.q.trim()) { const like = `%${f.q.trim().slice(0, 80).replace(/[%_\\]/g, "\\$&")}%`; conds.push(sql`(v.title ilike ${like} or v.request_no ilike ${like} or v.assignee_name ilike ${like})`); }
  return rows(sql`select ${COLS} ${FROM} where ${sql.join(conds, sql` and `)} order by v.id desc limit 500`);
}

export async function requestDetail(m: Member, id: number) {
  if (!canUseRequests(m)) deny();
  const { row, mine, managed } = await loadFor(m, id);
  const events = await rows(sql`select ev.id::int as id, ev.event_type as "eventType", ev.note, ev.created_at as "createdAt", am.email as "actorEmail"
      from internal_request_events ev left join org_members am on am.id = ev.actor_member_id where ev.request_id = ${id} order by ev.id`);
  delete row.mine; delete row.managed;
  return { ...row, events, viewer: { isAssignee: mine, canManage: managed } };
}

/** Looks up the login account of the assignee (linked account first, e-mail second) to notify them inside the app. */
async function assigneeMember(assigneeId: number) {
  const [r] = await rows(sql`select coalesce(e.org_member_id, (select om.id from org_members om where lower(om.email) = lower(e.email) and om.status = 'active' limit 1))::int as id from employees e where e.id = ${assigneeId}`);
  return (r?.id as number | null) ?? null;
}
async function notify(memberId: number | null, title: string, body: string, requestId: number) {
  if (memberId == null) return;
  await db.execute(sql`insert into notifications (member_id, type, title, body, link, subject_type, subject_id) values (${memberId}, 'request', ${title}, ${body}, '/requests', 'internal_request', ${requestId})`);
}
const appLink = () => (process.env.APP_PUBLIC_URL ? `${process.env.APP_PUBLIC_URL.replace(/\/$/, "")}/requests` : "");
async function email(to: string | null | undefined, subject: string, lines: string[]) {
  if (!to || !smtpConfigured()) return;
  const link = appLink();
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const html = `<div dir="rtl" style="font-family:system-ui,sans-serif;line-height:1.9"><h2>${esc(subject)}</h2>${lines.map((l) => `<p>${esc(l)}</p>`).join("")}${link ? `<p><a href="${esc(link)}">فتح الطلبات</a></p>` : ""}</div>`;
  const r = await sendMail({ to, subject: `${subject} — صرح د. سعد البقمي التعليمي`, html });
  if (!r.sent) logger.warn({ error: r.error }, "request notification e-mail not sent");
}

export async function createRequest(m: Member, i: Record<string, unknown>) {
  if (!canManageRequests(m)) deny("إرسال الطلبات للمدراء فقط");
  const title = text(i.title, "عنوان الطلب", 200)!;
  const description = text(i.description, "تفاصيل الطلب", 4000, false);
  const requestType = typeof i.requestType === "string" && TYPES.includes(i.requestType) ? i.requestType : "other";
  const priority = typeof i.priority === "string" && PRIORITIES.includes(i.priority) ? i.priority : "normal";
  const assigneeId = positiveInt(i.assigneeId, "الموظف");
  let dueAt: Date | null = null;
  if (i.dueAt != null && i.dueAt !== "") { dueAt = new Date(String(i.dueAt)); if (Number.isNaN(dueAt.getTime())) throw new DomainError("موعد التسليم غير صحيح"); if (dueAt.getTime() < Date.now() - 60_000) throw new DomainError("موعد التسليم في الماضي"); }
  const [emp] = await rows(sql`select e.id::int as id, e.full_name as name, e.email, e.branch_id::int as "branchId", e.status, e.org_member_id::int as "memberId" from employees e where e.id = ${assigneeId}`);
  if (!emp || emp.status !== "active") throw new DomainError("الموظف غير موجود أو غير نشط", 404);
  if (m.role !== "super_admin" && emp.branchId !== m.branchId) throw new DomainError("لا تملك إسناد طلبات لموظف من فرع آخر", 403);
  if (emp.memberId === m.id || (typeof emp.email === "string" && emp.email.toLowerCase() === m.email.toLowerCase())) throw new DomainError("لا يمكن إسناد طلب لنفسك");

  const created = await db.transaction(async (tx) => {
    const no = (await tx.execute(sql`select next_doc_no('REQ') as n`)).rows[0] as { n: string };
    const [r] = (await tx.execute(sql`insert into internal_requests (request_no, title, description, request_type, priority, branch_id, assignee_id, created_by, due_at)
      values (${no.n}, ${title}, ${description}, ${requestType}, ${priority}, ${emp.branchId as number}, ${assigneeId}, ${m.id}, ${dueAt}) returning id::int as id, request_no as "requestNo", sent_at as "sentAt"`)).rows as { id: number; requestNo: string; sentAt: string }[];
    await tx.execute(sql`insert into internal_request_events (request_id, event_type, actor_member_id) values (${r!.id}, 'created', ${m.id})`);
    await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, branchId: emp.branchId as number, action: "request.create", subjectType: "internal_request", subjectId: r!.id, subjectNo: r!.requestNo, after: { title, assigneeId, priority, requestType } });
    return r!;
  });
  const memberId = await assigneeMember(assigneeId);
  await notify(memberId, "طلب جديد", `${created.requestNo}: ${title}`, created.id).catch((e) => logger.warn({ err: e }, "request notification failed"));
  void email(emp.email as string | null, "طلب جديد بانتظارك", [`رقم الطلب: ${created.requestNo}`, `العنوان: ${title}`, ...(dueAt ? [`موعد التسليم: ${dueAt.toLocaleString("ar-SA")}`] : [])]);
  return created;
}

/** Stage 2. Idempotent: only the very first open by the assignee stamps the time; later opens change nothing. */
export async function openRequest(m: Member, id: number) {
  if (!canUseRequests(m)) deny();
  const { mine } = await loadFor(m, id);
  if (mine) {
    await db.transaction(async (tx) => {
      const r = (await tx.execute(sql`update internal_requests set status = 'received', received_at = now() where id = ${id} and status = 'sent' returning id`)).rows;
      if (r.length) await tx.execute(sql`insert into internal_request_events (request_id, event_type, actor_member_id) values (${id}, 'received', ${m.id})`);
    });
  }
  return requestDetail(m, id);
}

/** Stage 3: the assignee answers with a note and optional links (proof of registration, uploaded file location...). */
export async function respondToRequest(m: Member, id: number, i: Record<string, unknown>) {
  if (!canUseRequests(m)) deny();
  const { mine, row } = await loadFor(m, id);
  if (!mine) deny("الرد للموظف المكلّف فقط");
  const note = text(i.text, "نص الرد", 4000)!;
  if (note.length < 3) throw new DomainError("اكتب ردًا واضحًا");
  const raw = Array.isArray(i.links) ? i.links : [];
  if (raw.length > 5) throw new DomainError("خمسة روابط كحد أقصى");
  const links = raw.map((l) => {
    const s = typeof l === "string" ? l.trim() : "";
    let u: URL; try { u = new URL(s); } catch { throw new DomainError("رابط غير صحيح"); }
    if (!["http:", "https:"].includes(u.protocol) || s.length > 500) throw new DomainError("الروابط تبدأ بـ http أو https");
    return s;
  });
  await db.transaction(async (tx) => {
    // a response also counts as "received" if the assignee never opened the request screen
    const r = (await tx.execute(sql`update internal_requests set status = 'responded', responded_at = now(), received_at = coalesce(received_at, now()),
        response_text = ${note}, response_links = ${JSON.stringify(links)}::jsonb where id = ${id} and status in ('sent','received') returning id, received_at`)).rows;
    if (!r.length) throw new DomainError("لا يمكن الرد على هذا الطلب في حالته الحالية", 409);
    if (row.status === "sent") await tx.execute(sql`insert into internal_request_events (request_id, event_type, actor_member_id) values (${id}, 'received', ${m.id})`);
    await tx.execute(sql`insert into internal_request_events (request_id, event_type, actor_member_id, note) values (${id}, 'responded', ${m.id}, ${note.slice(0, 300)})`);
  });
  const creator = row.createdById as number;
  await notify(creator, "تم الرد على طلبك", `${row.requestNo}: ${row.title}`, id).catch(() => undefined);
  void email(row.createdByEmail as string, "تم الرد على طلبك", [`رقم الطلب: ${row.requestNo}`, `العنوان: ${row.title}`, `الموظف: ${row.assigneeName}`]);
  return requestDetail(m, id);
}

/** Stage 4: the manager reviews the result and closes the request. The assignee can never close their own request. */
export async function closeRequest(m: Member, id: number, i: Record<string, unknown>) {
  if (!canManageRequests(m)) deny("إغلاق الطلبات للمدراء فقط");
  const { managed, mine, row } = await loadFor(m, id);
  if (!managed) deny();
  if (mine) deny("لا تغلق طلبًا موجّهًا إليك");
  const note = text(i.note, "ملاحظة الإغلاق", 1000, false);
  await db.transaction(async (tx) => {
    const r = (await tx.execute(sql`update internal_requests set status = 'closed', closed_at = now(), closed_by = ${m.id}, close_note = ${note} where id = ${id} and status = 'responded' returning id`)).rows;
    if (!r.length) throw new DomainError("لا يُغلق الطلب إلا بعد رد الموظف", 409);
    await tx.execute(sql`insert into internal_request_events (request_id, event_type, actor_member_id, note) values (${id}, 'closed', ${m.id}, ${note})`);
    await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, branchId: row.branchId as number, action: "request.close", subjectType: "internal_request", subjectId: id, subjectNo: row.requestNo as string, after: { note } });
  });
  const memberId = await assigneeMember(row.assigneeId as number);
  await notify(memberId, "أُغلق طلبك", `${row.requestNo}: ${row.title}`, id).catch(() => undefined);
  return requestDetail(m, id);
}

export async function cancelRequest(m: Member, id: number, i: Record<string, unknown>) {
  if (!canManageRequests(m)) deny("إلغاء الطلبات للمدراء فقط");
  const { managed, row } = await loadFor(m, id);
  if (!managed) deny();
  const note = text(i.note, "سبب الإلغاء", 1000)!;
  await db.transaction(async (tx) => {
    const r = (await tx.execute(sql`update internal_requests set status = 'cancelled', cancelled_at = now() where id = ${id} and status in ('sent','received','responded') returning id`)).rows;
    if (!r.length) throw new DomainError("لا يمكن إلغاء طلب مغلق أو ملغى", 409);
    await tx.execute(sql`insert into internal_request_events (request_id, event_type, actor_member_id, note) values (${id}, 'cancelled', ${m.id}, ${note})`);
    await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, branchId: row.branchId as number, action: "request.cancel", subjectType: "internal_request", subjectId: id, subjectNo: row.requestNo as string, reason: note });
  });
  const memberId = await assigneeMember(row.assigneeId as number);
  await notify(memberId, "أُلغي طلب", `${row.requestNo}: ${row.title}`, id).catch(() => undefined);
  return requestDetail(m, id);
}

/** Manager dashboard: counts, average stage times and a per-employee performance table (all derived from the stamped times). */
export async function requestsStats(m: Member) {
  if (!canManageRequests(m)) deny("لوحة المتابعة للمدراء فقط");
  const scope = managerScope(m);
  const [t] = await rows(sql`select count(*)::int as total,
      count(*) filter (where v.status = 'sent')::int as sent, count(*) filter (where v.status = 'received')::int as received,
      count(*) filter (where v.status = 'responded')::int as responded, count(*) filter (where v.status = 'closed')::int as closed,
      count(*) filter (where v.status = 'cancelled')::int as cancelled, count(*) filter (where v.is_late)::int as late,
      avg(v.receive_seconds)::float8 as "avgReceiveSeconds", avg(v.response_seconds)::float8 as "avgResponseSeconds", avg(v.total_seconds)::float8 as "avgTotalSeconds"
    from v_internal_requests v where ${scope}`);
  const perEmployee = await rows(sql`select v.assignee_id::int as "assigneeId", v.assignee_name as name, max(v.assignee_job_title) as "jobTitle",
      count(*)::int as total, count(*) filter (where v.status = 'closed')::int as closed,
      count(*) filter (where v.status in ('sent','received','responded'))::int as open, count(*) filter (where v.is_late)::int as late,
      avg(v.receive_seconds)::float8 as "avgReceiveSeconds", avg(v.response_seconds)::float8 as "avgResponseSeconds"
    from v_internal_requests v where ${scope} and v.status <> 'cancelled' group by v.assignee_id, v.assignee_name order by count(*) filter (where v.status in ('sent','received','responded')) desc, v.assignee_name`);
  const waiting = await rows(sql`select ${COLS} ${FROM} where ${scope} and v.status = 'responded' order by v.responded_at limit 10`);
  return { totals: t, perEmployee, awaitingClose: waiting };
}
