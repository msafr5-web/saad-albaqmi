import crypto from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, otpChallenges } from "@workspace/db";
import { DomainError } from "./education-validation";
import { maskEmail, sendOtpEmail } from "./otp-mail";

/** Financial operations require an OTP only when this flag is on (turn it on after RESEND_* and OTP_HMAC_SECRET are set). */
export const otpEnabled = () => process.env.OTP_FINANCE_REQUIRED === "true";

const intEnv = (name: string, fallback: number) => { const n = Number(process.env[name]); return Number.isInteger(n) && n > 0 ? n : fallback; };
export const otpTtlSeconds = () => intEnv("OTP_TTL_SECONDS", 300);
const cooldownSeconds = () => intEnv("OTP_RESEND_COOLDOWN_SECONDS", 60);
const maxAttempts = () => intEnv("OTP_MAX_ATTEMPTS", 5);
/** How long a verified code may wait before it is used for the real operation. */
const CONSUME_WINDOW_SECONDS = 600;

export const OTP_ACTIONS: Record<string, string> = {
  "record.create": "تسجيل معاملة مالية",
  "record.update": "تعديل معاملة مالية",
  "record.delete": "حذف معاملة مالية",
  "stock.movement": "حركة مخزون",
  "procurement.award.approve": "اعتماد ترسية عرض سعر",
  "procurement.po.prepare": "إعداد أمر شراء",
  "procurement.po.approve": "اعتماد أمر شراء",
  "procurement.grn.confirm": "تأكيد استلام بضاعة",
  "procurement.invoice.approve": "اعتماد فاتورة مورد",
  "procurement.payment": "سداد فاتورة مورد",
  "hr.delegation.approve": "اعتماد تفويض صلاحيات",
};

export type OtpContext = { ip: string | null; userAgent: string | null };
export type OtpMember = { id: number; email: string };

function secret(): string {
  const s = process.env.OTP_HMAC_SECRET;
  if (!s || s.length < 32) throw new DomainError("خدمة رمز التأكيد غير مهيأة", 503);
  return s;
}

/** Deterministic JSON (sorted keys) so the same document always hashes the same. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
export const hashSubject = (v: unknown) => crypto.createHash("sha256").update(canonical(v)).digest("hex");

const codeHmac = (id: string, memberId: number, action: string, subjectHash: string, code: string) =>
  crypto.createHmac("sha256", secret()).update(`${id}|${memberId}|${action}|${subjectHash}|${code}`).digest("hex");

const equalHex = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));

/** Creates a challenge bound to (member, action, exact document) and emails the code. Fails closed if the email cannot be sent. */
export async function issueChallenge(input: { member: OtpMember; action: string; subjectType: string; subjectId?: number | null; subject: unknown; ctx: OtpContext }) {
  if (!OTP_ACTIONS[input.action]) throw new DomainError("إجراء غير مدعوم");
  secret();
  const recent = await db.select({ sentAt: otpChallenges.sentAt }).from(otpChallenges)
    .where(and(eq(otpChallenges.memberId, input.member.id), eq(otpChallenges.action, input.action))).orderBy(desc(otpChallenges.sentAt)).limit(1);
  if (recent[0] && Date.now() - recent[0].sentAt.getTime() < cooldownSeconds() * 1000) throw new DomainError("انتظر قليلًا قبل طلب رمز جديد", 429);

  const id = crypto.randomUUID();
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const subjectHash = hashSubject(input.subject);
  const expiresAt = new Date(Date.now() + otpTtlSeconds() * 1000);
  const masked = maskEmail(input.member.email);
  await db.insert(otpChallenges).values({
    id, memberId: input.member.id, action: input.action, subjectType: input.subjectType, subjectId: input.subjectId ?? null, subjectHash,
    codeHmac: codeHmac(id, input.member.id, input.action, subjectHash, code), channel: "email", destinationMasked: masked, expiresAt,
    maxAttempts: maxAttempts(), sentIp: input.ctx.ip, sentUserAgent: input.ctx.userAgent?.slice(0, 300) ?? null,
  });
  const mail = await sendOtpEmail(input.member.email, code, OTP_ACTIONS[input.action]!, Math.round(otpTtlSeconds() / 60));
  if (!mail.sent) {
    await db.update(otpChallenges).set({ status: "cancelled" }).where(eq(otpChallenges.id, id));
    throw new DomainError(`تعذر إرسال رمز التأكيد: ${mail.error}`, 503);
  }
  return { challengeId: id, expiresAt: expiresAt.toISOString(), destination: masked };
}

/** Checks a submitted code. Wrong codes count against max_attempts; expired or exhausted challenges are closed. */
export async function verifyChallenge(input: { challengeId: string; memberId: number; code: string; ctx: OtpContext }) {
  if (!/^\d{6}$/.test(input.code)) throw new DomainError("الرمز مكوّن من 6 أرقام");
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(otpChallenges)
      .where(and(eq(otpChallenges.id, input.challengeId), eq(otpChallenges.memberId, input.memberId))).for("update");
    if (!row) throw new DomainError("طلب التأكيد غير موجود", 404);
    if (row.status !== "pending") throw new DomainError("انتهت صلاحية هذا الطلب أو استُخدم؛ اطلب رمزًا جديدًا", 409);
    if (row.expiresAt.getTime() <= Date.now()) {
      await tx.update(otpChallenges).set({ status: "expired" }).where(eq(otpChallenges.id, row.id));
      return { ok: false as const, status: 410, error: "انتهت صلاحية الرمز؛ اطلب رمزًا جديدًا" };
    }
    const attempts = row.attempts + 1;
    const good = equalHex(row.codeHmac, codeHmac(row.id, row.memberId, row.action, row.subjectHash, input.code));
    if (good) {
      await tx.update(otpChallenges).set({ attempts, status: "verified", verifiedAt: new Date(), verifiedIp: input.ctx.ip, verifiedUserAgent: input.ctx.userAgent?.slice(0, 300) ?? null }).where(eq(otpChallenges.id, row.id));
      return { ok: true as const };
    }
    await tx.update(otpChallenges).set({ attempts, status: attempts >= row.maxAttempts ? "failed" : "pending" }).where(eq(otpChallenges.id, row.id));
    return { ok: false as const, status: 401, error: attempts >= row.maxAttempts ? "استُنفدت المحاولات؛ اطلب رمزًا جديدًا" : "الرمز غير صحيح" };
  });
}

type Tx = Pick<typeof db, "update">;

/** 428 Precondition Required. The body includes the exact subject the server hashes, so the web app asks for a code for precisely that document. */
function otpRequired(message: string, input: { action: string; subject: unknown }) {
  const kind = (input.subject as { kind?: unknown } | null)?.kind;
  return Object.assign(new DomainError(message, 428), { otpRequired: true, otpAction: input.action, otpSubject: input.subject, otpSubjectType: typeof kind === "string" ? kind : "record" });
}

/**
 * Spends a verified challenge for exactly one operation. The challenge must belong to this member, this action and
 * this exact document (hash), be verified recently and not yet consumed. Returns the evidence for the audit trail.
 */
export async function consumeChallenge(tx: Tx, input: { challengeId: string | undefined; memberId: number; action: string; subject: unknown }) {
  if (!input.challengeId || !/^[0-9a-f-]{36}$/i.test(input.challengeId)) {
    throw otpRequired("يلزم تأكيد العملية برمز OTP", input);
  }
  const rows = await tx.update(otpChallenges).set({ consumedAt: new Date() })
    .where(and(eq(otpChallenges.id, input.challengeId), eq(otpChallenges.memberId, input.memberId), eq(otpChallenges.action, input.action),
      eq(otpChallenges.subjectHash, hashSubject(input.subject)), eq(otpChallenges.status, "verified"), isNull(otpChallenges.consumedAt),
      sql`${otpChallenges.verifiedAt} > now() - make_interval(secs => ${CONSUME_WINDOW_SECONDS})`)).returning();
  const c = rows[0];
  if (!c) throw otpRequired("رمز التأكيد غير صالح لهذه العملية أو سبق استخدامه", input);
  return { challengeId: c.id, sentAt: c.sentAt, verifiedAt: c.verifiedAt, sentIp: c.sentIp, verifiedIp: c.verifiedIp, subjectHash: c.subjectHash };
}
