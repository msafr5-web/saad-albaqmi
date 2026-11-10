import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, departments, employees, jobTitles, leaveTypes, leaveRequests, approvalDelegations, orgMembers, branches } from "@workspace/db";
import type { Member } from "./education-access";
import { DomainError } from "./education-validation";
import { consumeChallenge, otpEnabled } from "./otp";
import { recordAudit } from "./audit";
import { syncOrganization } from "./legacy-sync";

/**
 * Human resources: departments, employee records, leave and approval delegations.
 * HR (hr_officer) maintains records and PROPOSES delegations; the General Manager (super_admin) approves them (different people,
 * enforced by the database). Salaries are visible to HR, the General Manager and finance only. Branch managers see their branch.
 */
const HR_WRITE: string[] = ["super_admin", "hr_officer"];
const READ: string[] = ["super_admin", "hr_officer", "branch_manager", "finance"];
const SALARY_VISIBLE: string[] = ["super_admin", "hr_officer", "finance"];
const ORG_WIDE: string[] = ["hr_officer", "finance"];
const inScope = (m: Member, branchId: number | null) => m.role === "super_admin" || branchId == null ? true : m.branchId === branchId || (ORG_WIDE.includes(m.role) && m.branchId == null);
const deny = (msg = "ليست لديك صلاحية لهذه العملية"): never => { throw new DomainError(msg, 403); };
export const canReadHr = (m: Member) => READ.includes(m.role);
const pgCode = (e: unknown) => ((e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code);
const pgMessage = (e: unknown) => String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message ?? "");
function friendly(e: unknown): never {
  if (e instanceof DomainError) throw e;
  const msg = pgMessage(e), code = pgCode(e);
  if (/leave_requests_no_overlap/.test(msg)) throw new DomainError("توجد إجازة أخرى تتداخل مع هذه الفترة", 409);
  if (/approval_delegations_no_overlap/.test(msg)) throw new DomainError("يوجد تفويض آخر لنفس المفوِّض في هذه الفترة", 409);
  if (/approval_delegations_approved_ck/.test(msg)) throw new DomainError("لا يعتمد التفويض من اقترحه", 409);
  if (/employees_national_id_uq/.test(msg)) throw new DomainError("رقم الهوية مسجل لموظف آخر", 409);
  if (/employees_iban_ck/.test(msg)) throw new DomainError("رقم الآيبان غير صحيح (SA + 22 رقمًا)");
  if (code === "23514" || code === "23505" || code === "23503") throw new DomainError("خالفت العملية قاعدة من قواعد الموارد البشرية", 409);
  throw e;
}
const str = (v: unknown, what: string, max = 200, required = true) => { const s = typeof v === "string" ? v.trim() : ""; if (!s && required) throw new DomainError(`${what} مطلوب`); if (s.length > max) throw new DomainError(`${what} طويل جدًا`); return s || null; };
const date = (v: unknown, what: string) => { if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new DomainError(`${what} غير صحيح`); return v; };
const halalas = (v: unknown, what: string) => { if (v == null || v === "") return 0; if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 1e10) throw new DomainError(`${what} غير صحيح`); return v as number; };

export async function hrCatalogue(m: Member) {
  if (!canReadHr(m)) deny();
  await syncOrganization();
  const [deps, titles, types] = await Promise.all([
    db.select().from(departments).orderBy(asc(departments.name)), db.select().from(jobTitles).orderBy(asc(jobTitles.name)), db.select().from(leaveTypes).orderBy(asc(leaveTypes.name)),
  ]);
  const brs = (await db.execute(sql`select id::int as id, name from branches where status = 'active' order by id`)).rows as { id: number; name: string }[];
  const members = HR_WRITE.includes(m.role) ? (await db.select({ id: orgMembers.id, email: orgMembers.email, role: orgMembers.role, branchId: orgMembers.branchId }).from(orgMembers).where(eq(orgMembers.status, "active")).orderBy(asc(orgMembers.email))) : [];
  return { departments: deps.filter((d) => inScope(m, d.branchId)), jobTitles: titles, leaveTypes: types, branches: brs.filter((b) => inScope(m, b.id)), members };
}

export async function createDepartment(m: Member, i: { name?: unknown; branchId?: unknown; code?: unknown }) {
  if (!HR_WRITE.includes(m.role)) deny("إدارة الأقسام للموارد البشرية");
  const name = str(i.name, "اسم القسم")!;
  const branchId = i.branchId == null || i.branchId === "" ? null : Number(i.branchId);
  if (branchId != null && !Number.isInteger(branchId)) throw new DomainError("الفرع غير صحيح");
  try {
    return await db.transaction(async (tx) => {
      const code = (str(i.code, "الرمز", 20, false) ?? `D${Date.now().toString(36).toUpperCase()}`).toUpperCase();
      const [row] = await tx.insert(departments).values({ name, code, branchId }).returning();
      await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, branchId, action: "department.create", subjectType: "department", subjectId: row!.id, subjectNo: code, after: { name } });
      return row!;
    });
  } catch (e) { return friendly(e); }
}

/** Rename a department, change its code or branch (used by the Excel update sheet and available to HR directly). */
export async function updateDepartment(m: Member, id: number, i: { name?: unknown; branchId?: unknown; code?: unknown }) {
  if (!HR_WRITE.includes(m.role)) deny("إدارة الأقسام للموارد البشرية");
  const name = str(i.name, "اسم القسم")!;
  const code = str(i.code, "الرمز", 20)!.toUpperCase();
  const branchId = i.branchId == null || i.branchId === "" ? null : Number(i.branchId);
  if (branchId != null && !Number.isInteger(branchId)) throw new DomainError("الفرع غير صحيح");
  try {
    return await db.transaction(async (tx) => {
      const [prev] = await tx.select().from(departments).where(eq(departments.id, id));
      if (!prev) throw new DomainError("القسم غير موجود", 404);
      const [row] = await tx.update(departments).set({ name, code, branchId }).where(eq(departments.id, id)).returning();
      await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, branchId, action: "department.update", subjectType: "department", subjectId: id, subjectNo: code, before: { name: prev.name, code: prev.code, branchId: prev.branchId }, after: { name, code, branchId } });
      return row!;
    });
  } catch (e) { return friendly(e); }
}

export async function listEmployees(m: Member) {
  if (!canReadHr(m)) deny();
  const rows = await db.select().from(employees).orderBy(desc(employees.id)).limit(500);
  const showPay = SALARY_VISIBLE.includes(m.role);
  return rows.filter((e) => inScope(m, e.branchId)).map((e) => {
    const { nationalId: _n, iban: _i, ...rest } = e;
    return showPay ? e : { ...rest, nationalId: null, iban: null, basicSalaryHalalas: null, housingAllowanceHalalas: null, transportAllowanceHalalas: null };
  });
}

type EmployeeInput = Record<string, unknown>;
function employeeValues(i: EmployeeInput) {
  const iban = typeof i.iban === "string" && i.iban.trim() ? i.iban.replace(/\s+/g, "").toUpperCase() : null;
  const email = typeof i.email === "string" && i.email.trim() ? i.email.trim().toLowerCase() : null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DomainError("البريد الإلكتروني غير صحيح");
  return {
    fullName: str(i.fullName, "اسم الموظف")!, branchId: Number.isInteger(i.branchId) ? (i.branchId as number) : (() => { throw new DomainError("اختر الفرع"); })(),
    departmentId: Number.isInteger(i.departmentId) ? (i.departmentId as number) : null, jobTitleId: Number.isInteger(i.jobTitleId) ? (i.jobTitleId as number) : null,
    nationalId: str(i.nationalId, "رقم الهوية", 20, false), nationality: str(i.nationality, "الجنسية", 60, false), email, phone: str(i.phone, "الجوال", 30, false), iban,
    employmentType: typeof i.employmentType === "string" ? i.employmentType : "full_time", hireDate: date(i.hireDate, "تاريخ التعيين"),
    basicSalaryHalalas: halalas(i.basicSalaryHalalas, "الراتب الأساسي"), housingAllowanceHalalas: halalas(i.housingAllowanceHalalas, "بدل السكن"), transportAllowanceHalalas: halalas(i.transportAllowanceHalalas, "بدل النقل"),
  };
}

export async function createEmployee(m: Member, i: EmployeeInput) {
  if (!HR_WRITE.includes(m.role)) deny("إدارة الموظفين للموارد البشرية");
  const v = employeeValues(i);
  try {
    return await db.transaction(async (tx) => {
      const n = (await tx.execute(sql`insert into document_sequences (prefix, year, last_value) values ('EMP', 0, 1) on conflict (prefix, year) do update set last_value = document_sequences.last_value + 1 returning last_value`)).rows[0] as { last_value: string };
      const [row] = await tx.insert(employees).values({ employeeNo: `EMP-${String(n.last_value).padStart(4, "0")}`, ...v }).returning();
      await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, branchId: v.branchId, action: "employee.create", subjectType: "employee", subjectId: row!.id, subjectNo: row!.employeeNo, after: { fullName: v.fullName, departmentId: v.departmentId } });
      return row!;
    });
  } catch (e) { return friendly(e); }
}

/** Salary changes are always audited with the previous value. */
export async function updateEmployee(m: Member, id: number, i: EmployeeInput & { status?: unknown; terminationDate?: unknown }) {
  if (!HR_WRITE.includes(m.role)) deny("إدارة الموظفين للموارد البشرية");
  const v = employeeValues({ ...i });
  const status = typeof i.status === "string" ? i.status : undefined;
  if (status && !["active", "on_leave", "suspended", "terminated"].includes(status)) throw new DomainError("الحالة غير صحيحة");
  try {
    return await db.transaction(async (tx) => {
      const [prev] = await tx.select().from(employees).where(eq(employees.id, id));
      if (!prev) throw new DomainError("الموظف غير موجود", 404);
      const [row] = await tx.update(employees).set({ ...v, ...(status ? { status } : {}), terminationDate: status === "terminated" ? date(i.terminationDate, "تاريخ انتهاء الخدمة") : null }).where(eq(employees.id, id)).returning();
      await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, branchId: v.branchId, action: "employee.update", subjectType: "employee", subjectId: id, subjectNo: prev.employeeNo,
        before: { basic: prev.basicSalaryHalalas, housing: prev.housingAllowanceHalalas, transport: prev.transportAllowanceHalalas, status: prev.status, departmentId: prev.departmentId }, after: { basic: v.basicSalaryHalalas, housing: v.housingAllowanceHalalas, transport: v.transportAllowanceHalalas, status: status ?? prev.status, departmentId: v.departmentId } });
      return row!;
    });
  } catch (e) { return friendly(e); }
}

// ---------- Leave -------------------------------------------------------------------------------------------------
export async function listLeave(m: Member) {
  if (!canReadHr(m)) deny();
  const rows = (await db.execute(sql`select l.id::int as id, l.employee_id::int as employee_id, e.full_name, e.branch_id::int as branch_id, t.name as leave_type, l.start_date, l.end_date, l.status, l.reason
      from leave_requests l join employees e on e.id = l.employee_id join leave_types t on t.id = l.leave_type_id order by l.start_date desc limit 300`)).rows as { branch_id: number }[];
  return rows.filter((r) => inScope(m, r.branch_id));
}
export async function createLeave(m: Member, i: { employeeId?: unknown; leaveTypeId?: unknown; startDate?: unknown; endDate?: unknown; reason?: unknown }) {
  if (!HR_WRITE.includes(m.role)) deny("تسجيل الإجازات للموارد البشرية");
  if (!Number.isInteger(i.employeeId) || !Number.isInteger(i.leaveTypeId)) throw new DomainError("اختر الموظف ونوع الإجازة");
  const start = date(i.startDate, "بداية الإجازة"), end = date(i.endDate, "نهاية الإجازة");
  if (end < start) throw new DomainError("نهاية الإجازة قبل بدايتها");
  try {
    return await db.transaction(async (tx) => {
      const [emp] = await tx.select().from(employees).where(eq(employees.id, i.employeeId as number));
      if (!emp) throw new DomainError("الموظف غير موجود", 404);
      const [row] = await tx.insert(leaveRequests).values({ employeeId: emp.id, leaveTypeId: i.leaveTypeId as number, startDate: start, endDate: end, reason: str(i.reason, "السبب", 300, false), requestedBy: m.id }).returning();
      await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, branchId: emp.branchId, action: "leave.create", subjectType: "leave", subjectId: row!.id, subjectNo: emp.employeeNo, after: { start, end } });
      return row!;
    });
  } catch (e) { return friendly(e); }
}
/** Approved by the General Manager or the employee's branch manager; never by the person who recorded it. */
export async function decideLeave(m: Member, id: number, approve: boolean) {
  if (!["super_admin", "branch_manager"].includes(m.role)) deny("اعتماد الإجازة للمدير العام ومدير الفرع");
  try {
    return await db.transaction(async (tx) => {
      const [l] = await tx.select().from(leaveRequests).where(eq(leaveRequests.id, id));
      if (!l || l.status !== "pending") throw new DomainError("الطلب غير موجود أو تم البت فيه", 404);
      const [emp] = await tx.select().from(employees).where(eq(employees.id, l.employeeId));
      if (m.role === "branch_manager" && m.branchId !== emp!.branchId) deny("الموظف خارج فرعك");
      if (l.requestedBy === m.id) throw new DomainError("لا يبتّ الشخص في طلب سجّله بنفسه", 403);
      const [row] = await tx.update(leaveRequests).set({ status: approve ? "approved" : "rejected", decidedBy: m.id, decidedAt: new Date() }).where(eq(leaveRequests.id, id)).returning();
      await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, branchId: emp!.branchId, action: approve ? "leave.approve" : "leave.reject", subjectType: "leave", subjectId: id, subjectNo: emp!.employeeNo });
      return row!;
    });
  } catch (e) { return friendly(e); }
}

// ---------- Delegations --------------------------------------------------------------------------------------------
export async function listDelegations(m: Member) {
  if (!["super_admin", "hr_officer", "branch_manager"].includes(m.role)) deny();
  return (await db.execute(sql`select d.id::int as id, d.status, d.scope, d.valid_from, d.valid_to, d.delegator_member_id::int as delegator_id, a.email as delegator, a.branch_id::int as branch_id, b.email as delegate, p.email as proposed_by_email
      from approval_delegations d join org_members a on a.id = d.delegator_member_id join org_members b on b.id = d.delegate_member_id join org_members p on p.id = d.proposed_by order by d.id desc limit 200`)).rows
    .filter((r) => m.role !== "branch_manager" || (r as { branch_id: number }).branch_id === m.branchId);
}
export async function proposeDelegation(m: Member, i: { delegatorMemberId?: unknown; delegateMemberId?: unknown; validFrom?: unknown; validTo?: unknown; scope?: unknown; leaveRequestId?: unknown }) {
  if (!HR_WRITE.includes(m.role)) deny("اقتراح التفويض للموارد البشرية");
  if (!Number.isInteger(i.delegatorMemberId) || !Number.isInteger(i.delegateMemberId)) throw new DomainError("اختر المفوِّض والمفوَّض إليه");
  const from = date(i.validFrom, "بداية التفويض"), to = date(i.validTo, "نهاية التفويض");
  if (to < from) throw new DomainError("نهاية التفويض قبل بدايتها");
  const scope = typeof i.scope === "string" ? i.scope : "purchase_approval";
  if (!["purchase_approval", "finance_approval", "all"].includes(scope)) throw new DomainError("نطاق التفويض غير صحيح");
  try {
    return await db.transaction(async (tx) => {
      const [dg] = await tx.select().from(orgMembers).where(eq(orgMembers.id, i.delegatorMemberId as number));
      const [de] = await tx.select().from(orgMembers).where(eq(orgMembers.id, i.delegateMemberId as number));
      if (!dg || dg.status !== "active" || dg.role !== "branch_manager") throw new DomainError("المفوِّض يجب أن يكون مدير فرع نشطًا");
      if (!de || de.status !== "active") throw new DomainError("المفوَّض إليه غير نشط");
      if (de.role === "student" || de.role === "instructor") throw new DomainError("لا يُفوَّض إلى طالب أو مدرب");
      const [row] = await tx.insert(approvalDelegations).values({ delegatorMemberId: dg.id, delegateMemberId: de.id, validFrom: from, validTo: to, scope, proposedBy: m.id, leaveRequestId: Number.isInteger(i.leaveRequestId) ? (i.leaveRequestId as number) : null }).returning();
      await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, branchId: dg.branchId, action: "delegation.propose", subjectType: "delegation", subjectId: row!.id, subjectNo: `${dg.email}>${de.email}`, after: { from, to, scope } });
      return row!;
    });
  } catch (e) { return friendly(e); }
}
/** Only the General Manager approves, and never a proposal he or she made. */
export async function decideDelegation(m: Member, id: number, approve: boolean, ctx: { challengeId?: string; userAgent?: string | null }) {
  if (m.role !== "super_admin") deny("اعتماد التفويض للمدير العام");
  try {
    return await db.transaction(async (tx) => {
      const [d] = await tx.select().from(approvalDelegations).where(eq(approvalDelegations.id, id));
      if (!d || d.status !== "proposed") throw new DomainError("التفويض غير موجود أو تم البت فيه", 404);
      if (approve && d.proposedBy === m.id) throw new DomainError("لا يعتمد المدير تفويضًا اقترحه بنفسه", 403);
      const subject = { delegationId: id, delegator: d.delegatorMemberId, delegate: d.delegateMemberId, from: d.validFrom, to: d.validTo, scope: d.scope, approve };
      const otp = approve && otpEnabled() ? await consumeChallenge(tx, { challengeId: ctx.challengeId, memberId: m.id, action: "hr.delegation.approve", subject }) : null;
      const [row] = await tx.update(approvalDelegations).set({ status: approve ? "approved" : "rejected", approvedBy: m.id, approvedAt: new Date() }).where(eq(approvalDelegations.id, id)).returning();
      await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, action: approve ? "delegation.approve" : "delegation.reject", subjectType: "delegation", subjectId: id, after: subject,
        otp: otp ? { challengeId: otp.challengeId, sentAt: otp.sentAt, verifiedAt: otp.verifiedAt, sentIp: otp.sentIp, verifiedIp: otp.verifiedIp } : null, userAgent: ctx.userAgent, contentHash: otp?.subjectHash });
      return row!;
    });
  } catch (e) { return friendly(e); }
}
export async function revokeDelegation(m: Member, id: number) {
  if (m.role !== "super_admin") deny("إلغاء التفويض للمدير العام");
  const [row] = await db.update(approvalDelegations).set({ status: "revoked" }).where(and(eq(approvalDelegations.id, id), eq(approvalDelegations.status, "approved"))).returning();
  if (!row) throw new DomainError("التفويض غير موجود أو غير معتمد", 404);
  return row;
}
void branches;
