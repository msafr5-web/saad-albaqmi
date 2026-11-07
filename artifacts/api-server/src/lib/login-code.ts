import crypto from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, localAccounts, loginCodes, orgMembers } from "@workspace/db";
import { DomainError } from "./education-validation";
import { ownerEmail } from "./org-membership";
import { hashPassword } from "./local-auth";
import { sendMail } from "./smtp";

const TTL_MS = 5 * 60_000, COOLDOWN_MS = 60_000, MAX_ATTEMPTS = 5;

function secret() {
  const s = process.env.OTP_HMAC_SECRET;
  if (!s || s.length < 32) throw new DomainError("خدمة رمز الدخول غير مهيأة", 503);
  return s;
}
const mac = (id: string, email: string, code: string) => crypto.createHmac("sha256", secret()).update(`login|${id}|${email}|${code}`).digest("hex");
const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));

/** Only the owner e-mail and people the administration invited (or activated) may receive a sign-in code. */
export async function mayReceiveCode(email: string): Promise<boolean> {
  if (email === ownerEmail()) return true;
  const [m] = await db.select({ id: orgMembers.id }).from(orgMembers).where(sql`lower(${orgMembers.email}) = ${email} and ${orgMembers.status} <> 'revoked'`);
  return !!m;
}

const html = (code: string) => `<div dir="rtl" style="font-family:system-ui,sans-serif;line-height:1.9"><h2>رمز الدخول</h2>
<p>استخدم هذا الرمز لتسجيل الدخول إلى صرح د. سعد البقمي التعليمي:</p>
<p style="font-size:32px;letter-spacing:8px;font-weight:700;direction:ltr;text-align:right">${code}</p>
<p>الرمز صالح 5 دقائق ويُستخدم مرة واحدة. إن لم تطلبه فتجاهل الرسالة ولا تشاركه مع أحد.</p></div>`;

/** Always looks the same to the caller; only people allowed to sign in actually get a message. */
export async function requestLoginCode(email: string, ip: string | null): Promise<void> {
  secret();
  if (!(await mayReceiveCode(email))) return;
  const [last] = await db.select({ at: loginCodes.requestedAt }).from(loginCodes).where(sql`lower(${loginCodes.email}) = ${email}`).orderBy(desc(loginCodes.requestedAt)).limit(1);
  if (last && Date.now() - last.at.getTime() < COOLDOWN_MS) return;
  const id = crypto.randomUUID();
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await db.insert(loginCodes).values({ id, email, codeHmac: mac(id, email, code), expiresAt: new Date(Date.now() + TTL_MS), requestedIp: ip });
  const r = await sendMail({ to: email, subject: "رمز الدخول — صرح د. سعد البقمي التعليمي", html: html(code), text: `رمز الدخول: ${code} (صالح 5 دقائق)` });
  if (!r.sent) {
    await db.update(loginCodes).set({ status: "failed" }).where(eq(loginCodes.id, id));
    throw new DomainError("تعذر إرسال رمز الدخول؛ حاول لاحقًا أو تواصل مع الإدارة", 503);
  }
}

/** Returns the local account id once the code is right; creates the account on first sign-in (the mailbox is the proof). */
export async function verifyLoginCode(email: string, code: string, ip: string | null): Promise<number> {
  const bad = (msg = "الرمز غير صحيح أو منتهي") => new DomainError(msg, 401);
  if (!/^\d{6}$/.test(code)) throw bad("الرمز مكوّن من 6 أرقام");
  // Failures are returned, not thrown: a throw would roll back the attempt counter and make guessing free.
  const out = await db.transaction(async (tx): Promise<{ id: number } | { error: DomainError }> => {
    const [row] = await tx.select().from(loginCodes).where(and(sql`lower(${loginCodes.email}) = ${email}`, eq(loginCodes.status, "pending"))).orderBy(desc(loginCodes.requestedAt)).limit(1).for("update");
    if (!row) return { error: bad() };
    if (row.expiresAt.getTime() <= Date.now()) { await tx.update(loginCodes).set({ status: "expired" }).where(eq(loginCodes.id, row.id)); return { error: bad() }; }
    const attempts = row.attempts + 1;
    if (!same(row.codeHmac, mac(row.id, email, code))) {
      await tx.update(loginCodes).set({ attempts, status: attempts >= MAX_ATTEMPTS ? "failed" : "pending" }).where(eq(loginCodes.id, row.id));
      return { error: bad(attempts >= MAX_ATTEMPTS ? "استُنفدت المحاولات؛ اطلب رمزًا جديدًا" : undefined) };
    }
    await tx.update(loginCodes).set({ attempts, status: "used", usedAt: new Date(), usedIp: ip }).where(eq(loginCodes.id, row.id));
    if (!(await mayReceiveCode(email))) return { error: bad() };
    const [acc] = await tx.select({ id: localAccounts.id }).from(localAccounts).where(sql`lower(${localAccounts.email}) = ${email}`);
    if (acc) { await tx.update(localAccounts).set({ lastLoginAt: new Date(), failedAttempts: 0, lockedUntil: null }).where(eq(localAccounts.id, acc.id)); return { id: acc.id }; }
    const [created] = await tx.insert(localAccounts).values({ email, passwordHash: await hashPassword(crypto.randomBytes(24).toString("base64url")), lastLoginAt: new Date() }).returning({ id: localAccounts.id });
    return { id: created!.id };
  });
  if ("error" in out) throw out.error;
  return out.id;
}
