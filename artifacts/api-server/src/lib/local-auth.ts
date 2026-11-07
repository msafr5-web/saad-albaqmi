import crypto from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, sql } from "drizzle-orm";
import { db, localAccounts, localSessions } from "@workspace/db";
import { DomainError } from "./education-validation";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;

/** Self-hosted sign-in (no Clerk). Selected with AUTH_MODE=local; any other value keeps the Clerk behaviour. */
export const localAuthEnabled = () => process.env.AUTH_MODE === "local";
export const SESSION_COOKIE = "sq_session";
const SESSION_DAYS = 14;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const N = 16384, R = 8, P = 1;

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 32, { N, r: R, p: P });
  return `s1$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [v, n, r, p, salt, key] = stored.split("$");
  if (v !== "s1" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const got = await scrypt(pw, Buffer.from(salt, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

export function checkPasswordPolicy(pw: unknown): string {
  if (typeof pw !== "string" || pw.length < 10) throw new DomainError("كلمة المرور 10 أحرف على الأقل");
  if (pw.length > 128) throw new DomainError("كلمة المرور طويلة جدًا");
  if (!/[A-Za-z؀-ۿ]/.test(pw) || !/\d/.test(pw)) throw new DomainError("كلمة المرور يجب أن تحوي حروفًا وأرقامًا");
  return pw;
}

export const normalizeEmail = (v: unknown): string => {
  const e = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 200) throw new DomainError("البريد الإلكتروني غير صحيح");
  return e;
};

const tokenHash = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
export const userIdOf = (accountId: number) => `local_${accountId}`;
export const accountIdFrom = (userId: string) => (userId.startsWith("local_") ? Number(userId.slice(6)) : NaN);

export async function createSession(accountId: number, ip: string | null, userAgent: string | null) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(localSessions).values({ tokenHash: tokenHash(token), accountId, expiresAt, ip, userAgent: userAgent?.slice(0, 300) ?? null });
  return { token, expiresAt };
}

export async function sessionAccount(token: string | undefined) {
  if (!token) return null;
  const [row] = await db.select({ id: localAccounts.id, email: localAccounts.email, mustChange: localAccounts.mustChange })
    .from(localSessions).innerJoin(localAccounts, eq(localAccounts.id, localSessions.accountId))
    .where(and(eq(localSessions.tokenHash, tokenHash(token)), gt(localSessions.expiresAt, new Date())));
  return row ?? null;
}

export const destroySession = (token: string) => db.delete(localSessions).where(eq(localSessions.tokenHash, tokenHash(token)));
export const destroyAllSessions = (accountId: number) => db.delete(localSessions).where(eq(localSessions.accountId, accountId));

/** Same answer for an unknown e-mail and a wrong password, and a lock after repeated failures. */
export async function authenticate(emailRaw: unknown, password: unknown) {
  const email = normalizeEmail(emailRaw);
  const fail = () => new DomainError("البريد أو كلمة المرور غير صحيحة", 401);
  if (typeof password !== "string" || !password || password.length > 128) throw fail();
  const [acc] = await db.select().from(localAccounts).where(sql`lower(${localAccounts.email}) = ${email}`);
  if (!acc) { await hashPassword(password); throw fail(); }
  if (acc.lockedUntil && acc.lockedUntil > new Date()) throw new DomainError("تم إيقاف الدخول مؤقتًا لكثرة المحاولات؛ حاول بعد قليل", 429);
  if (!(await verifyPassword(password, acc.passwordHash))) {
    const fails = acc.failedAttempts + 1;
    await db.update(localAccounts).set(fails >= MAX_FAILS
      ? { failedAttempts: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } : { failedAttempts: fails }).where(eq(localAccounts.id, acc.id));
    throw fail();
  }
  await db.update(localAccounts).set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(localAccounts.id, acc.id));
  return acc;
}

/** Trusted e-mail of a local account (accounts are only created by the owner token or an administrator). */
export async function localEmails(userId: string): Promise<string[]> {
  const id = accountIdFrom(userId);
  if (!Number.isInteger(id)) return [];
  const [acc] = await db.select({ email: localAccounts.email }).from(localAccounts).where(eq(localAccounts.id, id));
  return acc ? [acc.email.trim().toLowerCase()] : [];
}

export function parseCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export const cookieHeader = (token: string, expires: Date, secure: boolean) =>
  `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${secure ? "; Secure" : ""}`;
export const clearCookieHeader = (secure: boolean) => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
