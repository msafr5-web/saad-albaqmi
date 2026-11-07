import crypto from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { eq, sql } from "drizzle-orm";
import { db, localAccounts, orgMembers } from "@workspace/db";
import { clientIp, inetOrNull, rateLimit } from "../middlewares/security";
import { accessOf, sameOrigin, workspaceAccess } from "../middlewares/workspaceAccess";
import { DomainError } from "../lib/education-validation";
import { ownerEmail } from "../lib/org-membership";
import { requestLoginCode, verifyLoginCode } from "../lib/login-code";
import { smtpConfigured } from "../lib/smtp";
import {
  SESSION_COOKIE, authenticate, checkPasswordPolicy, clearCookieHeader, cookieHeader, createSession, destroyAllSessions, destroySession,
  hashPassword, localAuthEnabled, normalizeEmail, parseCookie, sessionAccount, verifyPassword,
} from "../lib/local-auth";

const router: IRouter = Router();
const secureCookie = (req: Request) => req.secure || req.get("x-forwarded-proto") === "https";
const ctx = (req: Request) => ({ ip: inetOrNull(clientIp(req)), ua: req.get("user-agent") ?? null });
const strict = rateLimit({ name: "auth", windowMs: 60_000, max: Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE ?? 10), key: (req) => clientIp(req) });

router.get("/auth/mode", (_req, res) => { res.json({ mode: localAuthEnabled() ? "local" : "clerk", emailCode: smtpConfigured() }); });

router.use("/auth", (req, res, next) => {
  if (!localAuthEnabled()) { res.status(404).json({ error: "الدخول المحلي غير مفعّل" }); return; }
  if (req.method !== "GET" && !sameOrigin(req)) { res.status(403).json({ error: "مصدر الطلب غير مسموح" }); return; }
  next();
});

async function startSession(req: Request, res: Response, accountId: number) {
  const { ip, ua } = ctx(req);
  const s = await createSession(accountId, ip, ua);
  res.append("Set-Cookie", cookieHeader(s.token, s.expiresAt, secureCookie(req)));
}

const safeEqual = (a: string, b: string) => {
  const x = crypto.createHash("sha256").update(a).digest();
  const y = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(x, y);
};

/** First administrator: the owner e-mail plus the one-time setup token generated on the server (OWNER_SETUP_TOKEN). */
router.post("/auth/setup-owner", strict, async (req, res) => {
  const owner = ownerEmail();
  const token = process.env.OWNER_SETUP_TOKEN;
  if (!owner || !token || token.length < 16) throw new DomainError("إعداد المالك غير مهيأ على الخادم", 503);
  const { email, password, setupToken } = (req.body ?? {}) as Record<string, unknown>;
  if (normalizeEmail(email) !== owner || typeof setupToken !== "string" || !safeEqual(setupToken, token)) throw new DomainError("بيانات الإعداد غير صحيحة", 403);
  checkPasswordPolicy(password);
  const hash = await hashPassword(password as string);
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('local-owner-setup'))`);
    const [exists] = await tx.select({ id: localAccounts.id }).from(localAccounts).where(sql`lower(${localAccounts.email}) = ${owner}`);
    if (exists) return null;
    const [row] = await tx.insert(localAccounts).values({ email: owner, passwordHash: hash }).returning({ id: localAccounts.id });
    return row!;
  });
  if (!created) throw new DomainError("حساب المالك أُنشئ مسبقًا؛ سجّل الدخول", 409);
  await startSession(req, res, created.id);
  res.status(201).json({ ok: true });
});

/** E-mail code sign-in: request (always answers ok) then verify. No password needed. */
router.post("/auth/code/request", strict, async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!smtpConfigured()) throw new DomainError("الدخول برمز البريد غير مهيأ", 503);
  await requestLoginCode(email, ctx(req).ip);
  res.json({ ok: true });
});

router.post("/auth/code/verify", strict, async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const accountId = await verifyLoginCode(email, String(req.body?.code ?? ""), ctx(req).ip);
  await startSession(req, res, accountId);
  res.json({ ok: true });
});

router.post("/auth/login", strict, async (req, res) => {
  const acc = await authenticate(req.body?.email, req.body?.password);
  await startSession(req, res, acc.id);
  res.json({ ok: true, mustChange: acc.mustChange });
});

router.post("/auth/logout", async (req, res) => {
  const t = parseCookie(req.get("cookie"), SESSION_COOKIE);
  if (t) await destroySession(t);
  res.append("Set-Cookie", clearCookieHeader(secureCookie(req)));
  res.json({ ok: true });
});

router.get("/auth/me", async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  const acc = await sessionAccount(parseCookie(req.get("cookie"), SESSION_COOKIE));
  res.json(acc ? { signedIn: true, email: acc.email, mustChange: acc.mustChange } : { signedIn: false });
});

router.post("/auth/change-password", strict, async (req, res) => {
  const acc = await sessionAccount(parseCookie(req.get("cookie"), SESSION_COOKIE));
  if (!acc) { res.status(401).json({ error: "سجّل الدخول أولًا" }); return; }
  const { currentPassword, newPassword } = (req.body ?? {}) as Record<string, unknown>;
  const [row] = await db.select().from(localAccounts).where(eq(localAccounts.id, acc.id));
  if (!row || typeof currentPassword !== "string" || !(await verifyPassword(currentPassword, row.passwordHash))) throw new DomainError("كلمة المرور الحالية غير صحيحة", 403);
  checkPasswordPolicy(newPassword);
  if (newPassword === currentPassword) throw new DomainError("اختر كلمة مرور مختلفة عن الحالية");
  await db.update(localAccounts).set({ passwordHash: await hashPassword(newPassword as string), mustChange: false }).where(eq(localAccounts.id, acc.id));
  await destroyAllSessions(acc.id);
  await startSession(req, res, acc.id);
  res.json({ ok: true });
});

/**
 * Administrator issues (or resets) a member's account. The member must already be invited/active in the organization.
 * A random temporary password is returned ONCE; the member must replace it at first sign-in. Hand it over in person or by phone.
 */
router.post("/auth/accounts", workspaceAccess, async (req, res) => {
  const a = accessOf(res);
  if (a.kind !== "org" || a.member.role !== "super_admin") { res.status(403).json({ error: "إصدار الحسابات للإدارة العليا فقط" }); return; }
  const email = normalizeEmail(req.body?.email);
  const [m] = await db.select().from(orgMembers).where(sql`lower(${orgMembers.email}) = ${email} and ${orgMembers.status} <> 'revoked'`);
  if (!m) throw new DomainError("ادعُ العضو من صفحة الفريق أولًا ثم أصدر حسابه", 404);
  const temp = crypto.randomBytes(9).toString("base64url") + "7a";
  const hash = await hashPassword(temp);
  const [exists] = await db.select({ id: localAccounts.id }).from(localAccounts).where(sql`lower(${localAccounts.email}) = ${email}`);
  if (exists) {
    await db.update(localAccounts).set({ passwordHash: hash, mustChange: true, failedAttempts: 0, lockedUntil: null }).where(eq(localAccounts.id, exists.id));
    await destroyAllSessions(exists.id);
  } else await db.insert(localAccounts).values({ email, passwordHash: hash, mustChange: true });
  res.set("Cache-Control", "no-store").status(201).json({ email, temporaryPassword: temp, note: "تظهر مرة واحدة فقط ويجب تغييرها عند أول دخول" });
});

export default router;
