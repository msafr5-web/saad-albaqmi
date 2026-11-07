import crypto from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, identityCards, presenceEvents, employees, ORG_OWNER_ID } from "@workspace/db";
import type { Member } from "./education-access";
import { DomainError } from "./education-validation";
import { recordAudit } from "./audit";
import { syncOrganization } from "./legacy-sync";

/**
 * Digital identity card (student, instructor, employee) and presence.
 *  - Every holder has ONE card. In the app it is a virtual card whose QR code rotates every 30 seconds (HMAC-signed), so a
 *    screenshot is useless. An optional physical NFC tag carries only a random opaque token (never the UID, never personal data).
 *  - Scanning a card at the gate checks employees/instructors in and out; an instructor scanning a student during a session
 *    records attendance; an instructor proves presence in a room with the room's own signed tag.
 *  - Loss: revoke the card (immediate) and reissue. Everything is branch-scoped and audited.
 * Employees live in the relational tables; students, instructors and sessions are still legacy records, read through SQL.
 */
const QR_STEP_SECONDS = 30;
const MANAGE_ROLES: string[] = ["super_admin", "hr_officer", "branch_manager"];
const GATE_ROLES: string[] = ["super_admin", "hr_officer", "branch_manager", "coordinator"];
const TZ = "Asia/Riyadh";
type HolderType = "student" | "employee" | "instructor";
type Holder = { type: HolderType; id: number; name: string; number: string; branchId: number | null; label: string };
const LABEL: Record<HolderType, string> = { student: "طالب", employee: "موظف", instructor: "مدرب" };
const deny = (msg = "ليست لديك صلاحية لهذه العملية"): never => { throw new DomainError(msg, 403); };

function secret(): string {
  const s = process.env.CARD_HMAC_SECRET;
  if (!s || s.length < 32) throw new DomainError("خدمة البطاقات غير مهيأة (CARD_HMAC_SECRET)", 503);
  return s;
}
const mac = (data: string) => crypto.createHmac("sha256", secret()).update(data).digest("base64url").slice(0, 22);
const eq22 = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const windowOf = (ms = Date.now()) => Math.floor(ms / 1000 / QR_STEP_SECONDS);
export const qrPayload = (cardId: number, ms = Date.now()) => { const w = windowOf(ms); return `SQ1.${cardId}.${w}.${mac(`SQ1|${cardId}|${w}`)}`; };
export const roomPayload = (roomId: number) => `RM1.${roomId}.${mac(`RM1|${roomId}`)}`;
const tokenHash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
const riyadhNow = (d = new Date()) => ({ date: d.toLocaleDateString("en-CA", { timeZone: TZ }), time: d.toLocaleTimeString("en-GB", { timeZone: TZ, hour12: false }).slice(0, 5) });
const minutes = (t: string) => { const [h, m] = t.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const ipOf = (v?: string | null) => (v && /^[0-9a-fA-F:.]+$/.test(v) && v.length <= 45 ? v : null);

// ---------- Holders -----------------------------------------------------------------------------------------------
async function loadHolder(type: HolderType, id: number): Promise<Holder | null> {
  if (type === "employee") {
    const [e] = await db.select().from(employees).where(eq(employees.id, id));
    return e ? { type, id, name: e.fullName, number: e.employeeNo, branchId: e.branchId, label: LABEL[type] } : null;
  }
  const r = (await db.execute(sql`select id::int as id, name, branch_id::int as branch_id from education_records where owner_id = ${ORG_OWNER_ID} and kind = ${type} and id = ${id}`)).rows[0] as { id: number; name: string; branch_id: number | null } | undefined;
  return r ? { type, id, name: r.name, number: `${type === "student" ? "ST" : "IN"}-${String(r.id).padStart(5, "0")}`, branchId: r.branch_id, label: LABEL[type] } : null;
}
const inBranch = (m: Member, branchId: number | null) => m.role === "super_admin" || branchId == null || m.branchId === branchId || (m.branchId == null && ["hr_officer", "finance"].includes(m.role));

/** The card holder behind a signed-in account: employee record, or the student/instructor record the account is linked to. */
async function holderOfMember(m: Member): Promise<Holder | null> {
  const [e] = await db.select().from(employees).where(eq(employees.orgMemberId, m.id));
  if (e) return loadHolder("employee", e.id);
  if ((m.role === "student" || m.role === "instructor") && m.linkedRecordId) return loadHolder(m.role, m.linkedRecordId);
  return null;
}

// ---------- My card ------------------------------------------------------------------------------------------------
async function ensureCard(holder: Holder, issuedBy: number | null) {
  const [active] = await db.select().from(identityCards).where(and(eq(identityCards.holderType, holder.type), eq(identityCards.holderId, holder.id), eq(identityCards.status, "active")));
  if (active) return active;
  const [row] = await db.insert(identityCards).values({ tokenHash: tokenHash(crypto.randomBytes(24).toString("base64url")), holderType: holder.type, holderId: holder.id, cardType: "virtual", issuedBy }).returning();
  return row!;
}
const cardNumber = (id: number) => String(id).padStart(12, "0").replace(/(\d{4})(?=\d)/g, "$1 ");

export async function myCard(m: Member) {
  const holder = await holderOfMember(m);
  if (!holder) throw new DomainError("لا توجد بطاقة لحسابك؛ تُصدر البطاقة لمن لديه سجل موظف أو طالب أو مدرب مرتبط بحسابه", 404);
  const card = await ensureCard(holder, null);
  const now = Date.now();
  return {
    card: { id: card.id, number: cardNumber(card.id), type: card.cardType, status: card.status, issuedAt: card.issuedAt },
    holder: { name: holder.name, number: holder.number, label: holder.label, type: holder.type },
    qr: qrPayload(card.id, now), qrStepSeconds: QR_STEP_SECONDS, secondsLeft: QR_STEP_SECONDS - (Math.floor(now / 1000) % QR_STEP_SECONDS),
  };
}
export async function myPresence(m: Member) {
  const holder = await holderOfMember(m);
  if (!holder) return [];
  return (await db.select().from(presenceEvents).where(and(eq(presenceEvents.holderType, holder.type), eq(presenceEvents.holderId, holder.id))).orderBy(desc(presenceEvents.occurredAt)).limit(30));
}

// ---------- Resolving a scanned payload ------------------------------------------------------------------------------
type Resolved = { cardId: number; holder: Holder; method: "qr" | "nfc" };
async function resolvePayload(payload: unknown): Promise<Resolved> {
  const p = typeof payload === "string" ? payload.trim() : "";
  const bad = () => new DomainError("البطاقة غير صالحة أو منتهية؛ اطلب من حاملها تحديث الرمز", 422);
  let cardRow: typeof identityCards.$inferSelect | undefined; let method: "qr" | "nfc";
  if (p.startsWith("SQ1.")) {
    const [, id, win, sig] = p.split(".");
    const cardId = Number(id), w = Number(win);
    if (!Number.isInteger(cardId) || !Number.isInteger(w) || !sig || !eq22(sig, mac(`SQ1|${cardId}|${w}`))) throw bad();
    if (Math.abs(windowOf() - w) > 1) throw bad();                                    // QR codes live ~30-60 seconds
    [cardRow] = await db.select().from(identityCards).where(eq(identityCards.id, cardId)); method = "qr";
  } else if (p.startsWith("ST1.")) {
    [cardRow] = await db.select().from(identityCards).where(eq(identityCards.tokenHash, tokenHash(p.slice(4)))); method = "nfc";
  } else throw bad();
  if (!cardRow) throw bad();
  if (cardRow.status !== "active") throw new DomainError("البطاقة موقوفة أو مفقودة", 423);
  const holder = await loadHolder(cardRow.holderType as HolderType, Number(cardRow.holderId));
  if (!holder) throw bad();
  return { cardId: cardRow.id, holder, method };
}

// ---------- Gate scan (employees / instructors / students entering a branch) ------------------------------------------
export async function gateScan(m: Member, input: { payload?: unknown }, ip?: string | null) {
  if (!GATE_ROLES.includes(m.role)) deny("المسح عند البوابة للمنسق ومدير الفرع والموارد البشرية");
  const r = await resolvePayload(input.payload);
  if (!inBranch(m, r.holder.branchId)) deny("حامل البطاقة يتبع فرعًا آخر");
  if (r.holder.branchId == null) throw new DomainError("لا يتبع حامل البطاقة فرعًا", 409);
  await syncOrganization();
  const day = riyadhNow().date;
  const last = (await db.execute(sql`select event_type from presence_events where holder_type = ${r.holder.type} and holder_id = ${r.holder.id} and session_id is null and room_id is null
      and (occurred_at at time zone ${TZ})::date = ${day}::date order by occurred_at desc limit 1`)).rows[0] as { event_type: string } | undefined;
  const eventType = last?.event_type === "check_in" ? "check_out" : "check_in";
  const [ev] = await db.insert(presenceEvents).values({ cardId: r.cardId, holderType: r.holder.type, holderId: r.holder.id, branchId: r.holder.branchId, eventType, method: r.method, deviceMemberId: m.id, verified: true, ip: ipOf(ip) }).returning();
  return { event: ev!, holder: r.holder, eventType };
}

// ---------- Instructor: room check-in and student attendance ---------------------------------------------------------
type SessionRow = { id: number; name: string; branch_id: number; date: string; start: string; end: string; room_id: number; instructor_id: number; student_ids: number[]; status: string };
async function todaysSessions(instructorId: number, roomId?: number): Promise<SessionRow[]> {
  const day = riyadhNow().date;
  return (await db.execute(sql`select id::int as id, name, branch_id::int as branch_id, details->>'date' as date, details->>'start' as start, details->>'end' as "end", (details->>'roomId')::int as room_id,
      (details->>'instructorId')::int as instructor_id, coalesce((select array_agg(x::int) from jsonb_array_elements_text(details->'studentIds') x), '{}') as student_ids, status
      from education_records where owner_id = ${ORG_OWNER_ID} and kind = 'session' and details->>'date' = ${day} and (details->>'instructorId')::int = ${instructorId}
        and status not in ('cancelled','ملغي') ${roomId ? sql`and (details->>'roomId')::int = ${roomId}` : sql``} order by details->>'start'`)).rows as SessionRow[];
}
const instructorOf = async (m: Member) => {
  if (m.role !== "instructor" || !m.linkedRecordId) deny("هذه الخدمة للمدرب المرتبط بسجل مدرب");
  const h = await loadHolder("instructor", m.linkedRecordId!);
  if (!h) deny("سجل المدرب غير موجود");
  return h!;
};

export async function mySessions(m: Member) {
  const ins = await instructorOf(m);
  return todaysSessions(ins.id);
}

/** The instructor taps the room's tag (or scans its QR) from their own signed-in phone: presence in the room during the scheduled session. */
export async function roomCheckIn(m: Member, input: { roomToken?: unknown }, ip?: string | null) {
  const ins = await instructorOf(m);
  const t = typeof input.roomToken === "string" ? input.roomToken.trim() : "";
  const [tag, id, sig] = t.split(".");
  const roomId = Number(id);
  if (tag !== "RM1" || !Number.isInteger(roomId) || !sig || !eq22(sig, mac(`RM1|${roomId}`))) throw new DomainError("رمز القاعة غير صحيح", 422);
  const now = riyadhNow();
  const session = (await todaysSessions(ins.id, roomId)).find((s) => minutes(now.time) >= minutes(s.start) - 30 && minutes(now.time) <= minutes(s.end));
  if (!session) throw new DomainError("لا توجد حصة مجدولة لك الآن في هذه القاعة", 409);
  await syncOrganization();
  const [dup] = (await db.execute(sql`select id from presence_events where holder_type = 'instructor' and holder_id = ${ins.id} and session_id is null and room_id = ${roomId} and (occurred_at at time zone ${TZ})::date = ${now.date}::date and event_type = 'check_in' limit 1`)).rows;
  if (dup) return { already: true, session };
  const [ev] = await db.insert(presenceEvents).values({ holderType: "instructor", holderId: ins.id, branchId: session.branch_id, eventType: "check_in", roomId, method: "qr", deviceMemberId: m.id, verified: true, ip: ipOf(ip) }).returning();
  return { already: false, session, event: ev! };
}

/** Student attendance for one of today's sessions, recorded by scanning the student's card. Creates the legacy attendance record once. */
export async function studentScan(m: Member, input: { payload?: unknown; sessionId?: unknown }, ip?: string | null) {
  const sessionId = Number(input.sessionId);
  if (!Number.isInteger(sessionId)) throw new DomainError("اختر الحصة");
  const r = await resolvePayload(input.payload);
  if (r.holder.type !== "student") throw new DomainError("هذه ليست بطاقة طالب", 422);
  const s = (await db.execute(sql`select id::int as id, name, branch_id::int as branch_id, details->>'date' as date, (details->>'instructorId')::int as instructor_id, coalesce((select array_agg(x::int) from jsonb_array_elements_text(details->'studentIds') x), '{}') as student_ids, status
      from education_records where owner_id = ${ORG_OWNER_ID} and kind = 'session' and id = ${sessionId}`)).rows[0] as Pick<SessionRow, "id" | "name" | "branch_id" | "date" | "instructor_id" | "student_ids" | "status"> | undefined;
  if (!s || ["cancelled", "ملغي"].includes(s.status)) throw new DomainError("الحصة غير موجودة", 404);
  if (s.date !== riyadhNow().date) throw new DomainError("يُسجَّل الحضور في يوم الحصة فقط", 409);
  if (m.role === "instructor") { if (m.linkedRecordId !== s.instructor_id) deny("الحصة ليست من حصصك"); }
  else if (!(["super_admin", "branch_manager", "coordinator"].includes(m.role) && inBranch(m, s.branch_id))) deny("تسجيل الحضور للمدرب أو المنسق");
  if (!s.student_ids.includes(r.holder.id)) throw new DomainError(`الطالب «${r.holder.name}» غير مسجل في هذه الحصة`, 409);
  await syncOrganization();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ORG_OWNER_ID}))`);        // same lock the records API uses: no duplicate attendance rows
    const exists = (await tx.execute(sql`select id::int as id from education_records where owner_id = ${ORG_OWNER_ID} and kind = 'attendance' and (details->>'studentId')::int = ${r.holder.id} and (details->>'sessionId')::int = ${sessionId}`)).rows[0];
    if (exists) return { already: true, holder: r.holder, session: s };
    await tx.execute(sql`insert into education_records (owner_id, kind, name, branch_id, status, details) values (${ORG_OWNER_ID}, 'attendance', ${`حضور ${r.holder.name}`}, ${s.branch_id}, 'recorded',
        ${JSON.stringify({ studentId: r.holder.id, sessionId, present: true, method: r.method })}::jsonb)`);
    await tx.insert(presenceEvents).values({ cardId: r.cardId, holderType: "student", holderId: r.holder.id, branchId: s.branch_id, eventType: "check_in", method: r.method, deviceMemberId: m.id, verified: true, ip: ipOf(ip),
      sessionId: null, roomId: null });
    return { already: false, holder: r.holder, session: s };
  });
}

// ---------- Administration --------------------------------------------------------------------------------------------
export async function listHolders(m: Member, type: HolderType) {
  if (!MANAGE_ROLES.includes(m.role)) deny();
  if (!["student", "employee", "instructor"].includes(type)) throw new DomainError("نوع غير صحيح");
  const rows = type === "employee"
    ? (await db.execute(sql`select id::int as id, full_name as name, employee_no as number, branch_id::int as branch_id from employees where status <> 'terminated' order by full_name`)).rows
    : (await db.execute(sql`select id::int as id, name, ${type === "student" ? "ST-" : "IN-"} || lpad(id::text, 5, '0') as number, branch_id::int as branch_id from education_records where owner_id = ${ORG_OWNER_ID} and kind = ${type} order by name`)).rows;
  const cards = await db.select().from(identityCards).where(and(eq(identityCards.holderType, type), eq(identityCards.status, "active")));
  const has = new Map(cards.map((c) => [Number(c.holderId), c]));
  return (rows as { id: number; name: string; number: string; branch_id: number | null }[]).filter((r) => inBranch(m, r.branch_id)).map((r) => ({ ...r, cardId: has.get(r.id)?.id ?? null, cardType: has.get(r.id)?.cardType ?? null }));
}

/** Issue or re-key a physical NFC tag. The token is returned ONCE (write it to the tag with the NFC tools page); only its hash is stored. */
export async function issuePhysicalCard(m: Member, input: { holderType?: unknown; holderId?: unknown }) {
  if (!MANAGE_ROLES.includes(m.role)) deny("إصدار البطاقات للموارد البشرية ومدير الفرع");
  const type = input.holderType as HolderType; const id = Number(input.holderId);
  if (!["student", "employee", "instructor"].includes(type) || !Number.isInteger(id)) throw new DomainError("حامل البطاقة غير صحيح");
  const holder = await loadHolder(type, id);
  if (!holder) throw new DomainError("حامل البطاقة غير موجود", 404);
  if (!inBranch(m, holder.branchId)) deny("حامل البطاقة يتبع فرعًا آخر");
  const token = crypto.randomBytes(24).toString("base64url");
  return db.transaction(async (tx) => {
    const [active] = await tx.select().from(identityCards).where(and(eq(identityCards.holderType, type), eq(identityCards.holderId, id), eq(identityCards.status, "active")));
    const [card] = active
      ? await tx.update(identityCards).set({ tokenHash: tokenHash(token), cardType: "nfc", keyVersion: active.keyVersion + 1, issuedBy: m.id, issuedAt: new Date() }).where(eq(identityCards.id, active.id)).returning()
      : await tx.insert(identityCards).values({ tokenHash: tokenHash(token), holderType: type, holderId: id, cardType: "nfc", issuedBy: m.id }).returning();
    await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, branchId: holder.branchId, action: active ? "card.rekey" : "card.issue", subjectType: "identity_card", subjectId: card!.id, subjectNo: holder.number, after: { holder: holder.name, type } });
    return { card: card!, token: `ST1.${token}`, holder };
  });
}

export async function revokeCard(m: Member, cardId: number, reason: unknown, status: "lost" | "revoked" = "revoked") {
  if (!MANAGE_ROLES.includes(m.role)) deny();
  const why = typeof reason === "string" ? reason.trim() : "";
  if (why.length < 5) throw new DomainError("اكتب سبب الإيقاف");
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(identityCards).where(eq(identityCards.id, cardId));
    if (!c || c.status !== "active") throw new DomainError("البطاقة غير موجودة أو موقوفة", 404);
    const holder = await loadHolder(c.holderType as HolderType, Number(c.holderId));
    if (holder && !inBranch(m, holder.branchId)) deny("حامل البطاقة يتبع فرعًا آخر");
    const [row] = await tx.update(identityCards).set({ status, revokedAt: new Date(), revokedReason: why.slice(0, 200) }).where(eq(identityCards.id, cardId)).returning();
    await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, branchId: holder?.branchId ?? null, action: `card.${status}`, subjectType: "identity_card", subjectId: cardId, subjectNo: holder?.number ?? null, reason: why });
    return row!;
  });
}

export async function todayPresence(m: Member, branchId?: unknown) {
  if (!GATE_ROLES.includes(m.role)) deny();
  const day = riyadhNow().date;
  const b = branchId == null || branchId === "" ? null : Number(branchId);
  const rows = (await db.execute(sql`select p.id::int as id, p.holder_type, p.holder_id::int as holder_id, p.event_type, p.method, p.occurred_at, p.branch_id::int as branch_id, p.room_id::int as room_id,
      coalesce(e.full_name, r.name) as name from presence_events p left join employees e on p.holder_type = 'employee' and e.id = p.holder_id
      left join education_records r on p.holder_type <> 'employee' and r.id = p.holder_id and r.owner_id = ${ORG_OWNER_ID}
     where (p.occurred_at at time zone ${TZ})::date = ${day}::date and (${b}::bigint is null or p.branch_id = ${b}) order by p.occurred_at desc limit 300`)).rows as { branch_id: number }[];
  return rows.filter((r) => inBranch(m, r.branch_id));
}
