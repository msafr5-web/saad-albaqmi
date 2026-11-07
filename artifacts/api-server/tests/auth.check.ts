import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { eq, sql } from "drizzle-orm";
import { db, localAccounts, orgMembers, otpChallenges, pool } from "@workspace/db";

/** Integration test for the self-hosted sign-in and the in-app OTP channel (no Clerk, no e-mail provider). Scratch/CI database only. */
if (process.env.ALLOW_DB_TESTS !== "1") { console.log("skipped: set ALLOW_DB_TESTS=1 (scratch/CI database only)"); process.exit(0); }
const stamp = Date.now();
const OWNER = `owner-${stamp}@example.test`;
process.env.AUTH_MODE = "local";
process.env.ORG_OWNER_EMAIL = OWNER;
process.env.OWNER_SETUP_TOKEN = "setup-token-setup-token-1234";
process.env.OTP_HMAC_SECRET = "test-secret-test-secret-test-secret-0123456789";
process.env.OTP_RESEND_COOLDOWN_SECONDS = "1"; process.env.AUTH_RATE_LIMIT_PER_MINUTE = "200";
delete process.env.RESEND_API_KEY;

async function main() {
  const { default: app } = await import("../src/app");
  const { hashPassword, verifyPassword } = await import("../src/lib/local-auth");
  const { inboxFor, issueChallenge, verifyChallenge, otpChannel } = await import("../src/lib/otp");

  // 1. password hashing
  const h = await hashPassword("Correct-horse-9");
  assert.ok(await verifyPassword("Correct-horse-9", h)); assert.ok(!(await verifyPassword("Correct-horse-8", h))); assert.ok(!h.includes("Correct"));

  const server = app.listen(0); const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const jar = new Map<string, string>();
  const call = async (method: string, path: string, body?: unknown, who = "A", extra: Record<string, string> = {}) => {
    const r = await fetch(base + path, { method, headers: { "content-type": "application/json", origin: base, ...(jar.get(who) ? { cookie: jar.get(who)! } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.get("set-cookie"); if (set) { const c = set.split(";")[0]!; if (c.endsWith("=")) jar.delete(who); else jar.set(who, c); }
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown>, headers: r.headers };
  };

  try {
    assert.equal(otpChannel(), "app");
    assert.equal((await call("GET", "/api/auth/mode")).body.mode, "local");

    // 2. owner bootstrap needs the server-side token and the owner e-mail
    assert.equal((await call("POST", "/api/auth/setup-owner", { email: OWNER, password: "Owner-pass-12345", setupToken: "wrong-wrong-wrong-wrong" })).status, 403);
    assert.equal((await call("POST", "/api/auth/setup-owner", { email: `other-${stamp}@example.test`, password: "Owner-pass-12345", setupToken: process.env.OWNER_SETUP_TOKEN })).status, 403);
    assert.equal((await call("POST", "/api/auth/setup-owner", { email: OWNER, password: "short", setupToken: process.env.OWNER_SETUP_TOKEN })).status, 400);
    const setup = await call("POST", "/api/auth/setup-owner", { email: OWNER, password: "Owner-pass-12345", setupToken: process.env.OWNER_SETUP_TOKEN });
    assert.equal(setup.status, 201);
    assert.match(setup.headers.get("set-cookie")!, /HttpOnly/); assert.match(setup.headers.get("set-cookie")!, /SameSite=Lax/);
    assert.equal((await call("POST", "/api/auth/setup-owner", { email: OWNER, password: "Owner-pass-12345", setupToken: process.env.OWNER_SETUP_TOKEN }, "X")).status, 409, "setup only once");

    // 3. cross-origin writes are refused
    assert.equal((await call("POST", "/api/auth/login", { email: OWNER, password: "Owner-pass-12345" }, "X", { origin: "https://evil.example" })).status, 403);

    // 4. session -> me -> workspace resolves the owner as super_admin
    const me = await call("GET", "/api/auth/me"); assert.equal(me.body.signedIn, true); assert.equal(me.body.email, OWNER);
    const ws = await call("GET", "/api/workspace"); assert.equal(ws.status, 200);
    assert.equal((ws.body as { role?: string }).role ?? (ws.body as { member?: { role?: string } }).member?.role, "super_admin", JSON.stringify(ws.body).slice(0, 200));

    // 5. anonymous caller sees nothing of an org session
    assert.equal((await call("GET", "/api/auth/me", undefined, "ANON")).body.signedIn, false);
    assert.equal((await call("POST", "/api/otp/challenges", { action: "record.create", subjectType: "payment", subject: {} }, "ANON")).status, 401);

    // 6. admin issues an account for an invited member; temp password must be changed
    const emp = `emp-${stamp}@example.test`;
    assert.equal((await call("POST", "/api/auth/accounts", { email: emp })).status, 404, "must be invited first");
    await db.insert(orgMembers).values({ email: emp, role: "finance", status: "invited" });
    const issued = await call("POST", "/api/auth/accounts", { email: emp });
    assert.equal(issued.status, 201); const temp = issued.body.temporaryPassword as string; assert.ok(temp.length >= 12);
    assert.equal((await call("POST", "/api/auth/accounts", { email: emp }, "EMP")).status, 401, "non-admin cannot issue");
    const login = await call("POST", "/api/auth/login", { email: emp, password: temp }, "EMP");
    assert.equal(login.status, 200); assert.equal(login.body.mustChange, true);
    const blocked = await call("GET", "/api/workspace", undefined, "EMP"); assert.equal(blocked.status, 403); assert.equal(blocked.body.mustChange, true);
    assert.equal((await call("POST", "/api/auth/change-password", { currentPassword: temp, newPassword: temp }, "EMP")).status, 400);
    assert.equal((await call("POST", "/api/auth/change-password", { currentPassword: "nope-nope-123", newPassword: "Employee-pass-77" }, "EMP")).status, 403);
    assert.equal((await call("POST", "/api/auth/change-password", { currentPassword: temp, newPassword: "Employee-pass-77" }, "EMP")).status, 200);
    const ws2 = await call("GET", "/api/workspace", undefined, "EMP"); assert.equal(ws2.status, 200);
    const [m] = await db.select().from(orgMembers).where(sql`lower(${orgMembers.email}) = ${emp}`); assert.equal(m!.status, "active", "invitation claimed at first sign-in");

    // 7. wrong passwords: generic message, then a temporary lock
    for (let i = 0; i < 5; i++) { const r = await call("POST", "/api/auth/login", { email: emp, password: "Wrong-pass-0000" }, "L"); assert.ok([401, 429].includes(r.status)); }
    const locked = await call("POST", "/api/auth/login", { email: emp, password: "Employee-pass-77" }, "L");
    assert.equal(locked.status, 429, "locked after repeated failures");
    assert.equal((await call("POST", "/api/auth/login", { email: `nobody-${stamp}@example.test`, password: "Whatever-123456" }, "L")).body.error, "البريد أو كلمة المرور غير صحيحة");
    await db.update(localAccounts).set({ lockedUntil: null, failedAttempts: 0 }).where(sql`lower(${localAccounts.email}) = ${emp}`);

    // 8. logout kills the session server-side
    const cookie = jar.get("EMP")!; await call("POST", "/api/auth/logout", {}, "EMP");
    const replay = await fetch(base + "/api/auth/me", { headers: { cookie } }); assert.equal(((await replay.json()) as { signedIn: boolean }).signedIn, false);

    // 9. in-app OTP: no e-mail provider, the code is only in the owner's inbox and works exactly once for the exact document
    const [owner] = await db.select().from(orgMembers).where(sql`lower(${orgMembers.email}) = ${OWNER}`);
    const doc = { kind: "payment", name: "دفعة", branchId: 1, status: "paid", details: { amount: 900 } };
    const ch = await issueChallenge({ member: { id: owner!.id, email: owner!.email }, action: "record.create", subjectType: "payment", subject: doc, ctx: { ip: "10.0.0.1", userAgent: "t" } });
    assert.equal(ch.destination, "داخل التطبيق");
    const row = (await db.select().from(otpChallenges).where(eq(otpChallenges.id, ch.challengeId)))[0]!; assert.equal(row.channel, "app");
    const inbox = await call("GET", "/api/otp/inbox"); const item = (inbox.body.items as { challengeId: string; code: string }[]).find((i) => i.challengeId === ch.challengeId)!;
    assert.match(item.code, /^\d{6}$/); assert.ok(!JSON.stringify(row).includes(item.code), "code not stored");
    assert.equal((await call("GET", "/api/otp/inbox", undefined, "ANON")).status, 403);
    const bad = await verifyChallenge({ challengeId: ch.challengeId, memberId: owner!.id, code: item.code === "000000" ? "000001" : "000000", ctx: { ip: null, userAgent: null } });
    assert.equal(bad.ok, false);
    const good = await verifyChallenge({ challengeId: ch.challengeId, memberId: owner!.id, code: item.code, ctx: { ip: "10.0.0.1", userAgent: "t" } });
    assert.equal(good.ok, true);
    assert.equal((await inboxFor(owner!.id)).some((i) => i.challengeId === ch.challengeId), false, "verified code leaves the inbox");
    // 10. e-mail code sign-in through the organization mailbox (transport replaced by a capture)
    const { setMailTransport } = await import("../src/lib/smtp");
    const mails: { to: string; html: string }[] = [];
    setMailTransport(async (m) => { mails.push({ to: m.to, html: m.html }); });
    const codeOf = () => /letter-spacing[^>]*>(\d{6})</.exec(mails.at(-1)!.html)![1]!;
    assert.equal((await call("GET", "/api/auth/mode")).body.emailCode, true);
    const stranger = `stranger-${stamp}@example.test`;
    assert.equal((await call("POST", "/api/auth/code/request", { email: stranger })).status, 200);
    assert.equal(mails.length, 0, "no mail for an uninvited address (and the answer looks the same)");
    const newcomer = `new-${stamp}@example.test`;
    await db.insert(orgMembers).values({ email: newcomer, role: "coordinator", status: "invited" });
    assert.equal((await call("POST", "/api/auth/code/request", { email: newcomer })).status, 200);
    assert.equal(mails.length, 1); assert.equal(mails[0]!.to, newcomer);
    assert.equal((await call("POST", "/api/auth/code/request", { email: newcomer })).status, 200); assert.equal(mails.length, 1, "cooldown: no second mail within a minute");
    const right = codeOf();
    const wrong = right === "000000" ? "000001" : "000000";
    assert.equal((await call("POST", "/api/auth/code/verify", { email: newcomer, code: wrong }, "N")).status, 401);
    assert.equal((await call("GET", "/api/auth/me", undefined, "N")).body.signedIn, false);
    assert.equal((await call("POST", "/api/auth/code/verify", { email: newcomer, code: right }, "N")).status, 200);
    assert.equal((await call("GET", "/api/auth/me", undefined, "N")).body.email, newcomer);
    assert.equal((await call("GET", "/api/workspace", undefined, "N")).status, 200);
    assert.equal((await call("POST", "/api/auth/code/verify", { email: newcomer, code: right }, "N2")).status, 401, "a code works once");
    const [codeRow] = await db.execute(sql`select code_hmac from login_codes where lower(email) = ${newcomer} limit 1`).then((r) => r.rows as { code_hmac: string }[]);
    assert.ok(codeRow && !codeRow.code_hmac.includes(right), "code not stored");
    // lock after repeated wrong codes
    await db.execute(sql`update login_codes set requested_at = now() - interval '2 minutes' where lower(email) = ${newcomer}`);
    await call("POST", "/api/auth/code/request", { email: newcomer }); assert.equal(mails.length, 2);
    for (let i = 0; i < 5; i++) await call("POST", "/api/auth/code/verify", { email: newcomer, code: codeOf() === "111111" ? "222222" : "111111" }, "N3");
    assert.equal((await call("POST", "/api/auth/code/verify", { email: newcomer, code: codeOf() }, "N3")).status, 401, "five wrong codes burn the challenge");
    // revoked members get nothing
    await db.update(orgMembers).set({ status: "revoked" }).where(sql`lower(${orgMembers.email}) = ${newcomer}`);
    await db.execute(sql`update login_codes set requested_at = now() - interval '2 minutes' where lower(email) = ${newcomer}`);
    await call("POST", "/api/auth/code/request", { email: newcomer }); assert.equal(mails.length, 2);
    // transaction OTP over the same mailbox
    process.env.OTP_CHANNEL = "email"; process.env.SMTP_HOST = "x"; process.env.SMTP_USER = "x"; process.env.SMTP_PASSWORD = "x";
    const em = await issueChallenge({ member: { id: owner!.id, email: owner!.email }, action: "record.update", subjectType: "payment", subject: doc, ctx: { ip: null, userAgent: null } });
    assert.match(em.destination, /\*\*\*@/); assert.equal(mails.at(-1)!.to, owner!.email); setMailTransport(null);
    console.log("auth.check: all assertions passed");
  } finally { server.close(); }
}

main().then(() => pool.end()).catch((e) => { console.error(e); pool.end().finally(() => process.exit(1)); });
