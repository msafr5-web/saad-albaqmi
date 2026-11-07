import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { db, orgMembers, otpChallenges, pool } from "@workspace/db";
import { consumeChallenge, hashSubject, issueChallenge, verifyChallenge } from "../src/lib/otp";
import { recordAudit } from "../src/lib/audit";
import { DomainError } from "../src/lib/education-validation";

/**
 * Integration test for the OTP service and the audit ledger. It needs a MIGRATED database and leaves audit rows behind
 * (the ledger is append-only by design), so it only runs against scratch/CI databases: set ALLOW_DB_TESTS=1.
 */
if (process.env.ALLOW_DB_TESTS !== "1") { console.log("skipped: set ALLOW_DB_TESTS=1 (scratch/CI database only)"); process.exit(0); }
process.env.OTP_HMAC_SECRET = "test-secret-test-secret-test-secret-0123456789";
process.env.RESEND_API_KEY = "test"; process.env.RESEND_FROM_EMAIL = "test@example.test";
process.env.OTP_RESEND_COOLDOWN_SECONDS = "1";

// Capture the "email" instead of calling Resend.
let sent: { to: string; html: string }[] = []; let failMail = false;
globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
  if (failMail) return new Response("nope", { status: 500 });
  const b = JSON.parse(init!.body!); sent.push({ to: b.to[0], html: b.html }); return new Response("{}", { status: 200 });
}) as typeof fetch;
const lastCode = () => /letter-spacing[^>]*>(\d{6})</.exec(sent.at(-1)!.html)![1]!;
const ctx = { ip: "10.1.2.3", userAgent: "check/1.0" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fails = async (p: Promise<unknown>, status: number, label: string) => {
  try { await p; } catch (e) { assert.ok(e instanceof DomainError || (e as { status?: number }).status !== undefined, `${label}: not a DomainError (${(e as Error).message})`); assert.equal((e as DomainError).status, status, `${label}: expected ${status}, got ${(e as DomainError).status}`); return; }
  assert.fail(`${label}: expected failure ${status}`);
};
const stamp = Date.now();
const mk = async (n: string) => (await db.insert(orgMembers).values({ email: `otp-${n}-${stamp}@example.test`, role: "finance", status: "active" }).returning())[0]!;

async function main() {
  const a = await mk("a"), b = await mk("b");
  const doc = { kind: "payment", name: "دفعة", branchId: 1, status: "paid", details: { amount: 1500 } };

  // 1. issue -> email carries a 6 digit code, the database never stores it
  const ch = await issueChallenge({ member: a, action: "record.create", subjectType: "payment", subject: doc, ctx });
  assert.equal(sent.length, 1); assert.equal(sent[0]!.to, a.email); assert.match(ch.destination, /^o\*\*\*@example\.test$/);
  const code = lastCode(); assert.match(code, /^\d{6}$/);
  const row = (await db.select().from(otpChallenges).where(eq(otpChallenges.id, ch.challengeId)))[0]!;
  assert.ok(!JSON.stringify(row).includes(code), "the code must not be stored"); assert.equal(row.sentIp, "10.1.2.3");

  // 2. cooldown
  await fails(issueChallenge({ member: a, action: "record.create", subjectType: "payment", subject: doc, ctx }), 429, "cooldown");

  // 3. wrong code, other member, bad format
  const wrong = code === "000000" ? "111111" : "000000";
  let r = await verifyChallenge({ challengeId: ch.challengeId, memberId: a.id, code: wrong, ctx }); assert.equal(r.ok, false);
  await fails(verifyChallenge({ challengeId: ch.challengeId, memberId: b.id, code, ctx }), 404, "another member must not see the challenge");
  await fails(verifyChallenge({ challengeId: ch.challengeId, memberId: a.id, code: "12", ctx }), 400, "format");

  // 4. consuming before verification is refused
  await fails(db.transaction((tx) => consumeChallenge(tx, { challengeId: ch.challengeId, memberId: a.id, action: "record.create", subject: doc })), 428, "unverified");

  // 4b. the 428 carries the exact subject the server hashes, so the web app never has to rebuild it
  try { await db.transaction((tx) => consumeChallenge(tx, { challengeId: undefined, memberId: a.id, action: "record.create", subject: doc })); assert.fail("must require an OTP"); }
  catch (e) { const o = e as DomainError & { otpRequired?: boolean; otpSubject?: unknown; otpSubjectType?: string }; assert.equal(o.status, 428); assert.equal(o.otpRequired, true); assert.deepEqual(o.otpSubject, doc); assert.equal(o.otpSubjectType, "payment"); }

  // 5. correct code verifies, records the verifier IP, and can be spent exactly once on exactly this document
  r = await verifyChallenge({ challengeId: ch.challengeId, memberId: a.id, code, ctx: { ip: "10.9.9.9", userAgent: "other/2" } }); assert.equal(r.ok, true);
  await fails(db.transaction((tx) => consumeChallenge(tx, { challengeId: ch.challengeId, memberId: a.id, action: "record.create", subject: { ...doc, details: { amount: 9999 } } })), 428, "modified document");
  await fails(db.transaction((tx) => consumeChallenge(tx, { challengeId: ch.challengeId, memberId: a.id, action: "record.delete", subject: doc })), 428, "different action");
  await fails(db.transaction((tx) => consumeChallenge(tx, { challengeId: ch.challengeId, memberId: b.id, action: "record.create", subject: doc })), 428, "different member");
  const ev = await db.transaction(async (tx) => {
    const e = await consumeChallenge(tx, { challengeId: ch.challengeId, memberId: a.id, action: "record.create", subject: doc });
    await recordAudit(tx, { actorMemberId: a.id, actorRole: "finance", action: "record.create", subjectType: "payment", subjectNo: "RC-TEST", after: doc, otp: { challengeId: e.challengeId, sentAt: e.sentAt, verifiedAt: e.verifiedAt, sentIp: e.sentIp, verifiedIp: e.verifiedIp }, userAgent: "check/1.0", contentHash: e.subjectHash });
    return e;
  });
  assert.equal(ev.subjectHash, hashSubject(doc)); assert.equal(ev.sentIp, "10.1.2.3"); assert.equal(ev.verifiedIp, "10.9.9.9");
  await fails(db.transaction((tx) => consumeChallenge(tx, { challengeId: ch.challengeId, memberId: a.id, action: "record.create", subject: doc })), 428, "replay");

  // 6. the audit workflow shows both IPs and the confirmation time
  const wf = (await pool.query("select host(ip_sent) s, host(ip_verified) v, seconds_to_confirm from v_audit_workflow where subject_no = 'RC-TEST' order by id desc limit 1")).rows[0];
  assert.deepEqual([wf.s, wf.v], ["10.1.2.3", "10.9.9.9"]); assert.ok(wf.seconds_to_confirm >= 0);
  assert.equal((await pool.query("select * from verify_audit_chain()")).rowCount, 0, "audit chain must verify");

  // 7. attempts are limited
  await sleep(1100);
  const ch2 = await issueChallenge({ member: a, action: "record.update", subjectType: "payment", subject: { id: 1 }, ctx }); const c2 = lastCode();
  const bad = c2 === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) await verifyChallenge({ challengeId: ch2.challengeId, memberId: a.id, code: bad, ctx });
  await fails(verifyChallenge({ challengeId: ch2.challengeId, memberId: a.id, code: c2, ctx }), 409, "exhausted challenge stays closed");
  assert.equal((await db.select().from(otpChallenges).where(eq(otpChallenges.id, ch2.challengeId)))[0]!.status, "failed");

  // 8. expiry
  await sleep(1100);
  const ch3 = await issueChallenge({ member: a, action: "record.delete", subjectType: "payment", subject: { id: 2 }, ctx }); const c3 = lastCode();
  await db.execute(sql`update otp_challenges set sent_at = now() - interval '10 minutes', expires_at = now() - interval '5 minutes' where id = ${ch3.challengeId}`);
  const exp = await verifyChallenge({ challengeId: ch3.challengeId, memberId: a.id, code: c3, ctx }); assert.equal(exp.ok, false);

  // 9. fail closed when the email cannot be delivered
  await sleep(1100); failMail = true;
  await fails(issueChallenge({ member: b, action: "record.create", subjectType: "payment", subject: doc, ctx }), 503, "mail failure");
  const cancelled = await db.select().from(otpChallenges).where(eq(otpChallenges.memberId, b.id));
  assert.ok(cancelled.length === 1 && cancelled[0]!.status === "cancelled", "undeliverable challenge is cancelled");

  console.log("otp.check passed");
}
main().then(() => pool.end(), (e) => { console.error(e); pool.end().finally(() => process.exit(1)); });
