import assert from "node:assert/strict";
import { db, branches, employees, orgMembers, pool } from "@workspace/db";
import { gateScan, issuePhysicalCard, listHolders, myCard, myPresence, mySessions, qrPayload, revokeCard, roomCheckIn, roomPayload, studentScan, todayPresence } from "../src/lib/cards";
import { syncOrganization } from "../src/lib/legacy-sync";
import { DomainError } from "../src/lib/education-validation";
import type { Member } from "../src/lib/education-access";

/** Digital card, rotating QR, gate scan, room check-in and student attendance on a MIGRATED scratch/CI database (ALLOW_DB_TESTS=1). */
if (process.env.ALLOW_DB_TESTS !== "1") { console.log("skipped: set ALLOW_DB_TESTS=1 (scratch/CI database only)"); process.exit(0); }
process.env.CARD_HMAC_SECRET = "card-secret-card-secret-card-secret-0123456789";
const stamp = Date.now();
const fails = async (p: Promise<unknown>, status: number, label: string) => {
  try { await p; } catch (e) { assert.ok(e instanceof DomainError, `${label}: not a DomainError (${(e as Error).message})`); assert.equal(e.status, status, `${label}: expected ${status}, got ${e.status} (${e.message})`); return e as DomainError; }
  assert.fail(`${label}: expected failure ${status}`);
};
const mk = async (n: string, role: string, branchId: number | null, linked: number | null = null): Promise<Member> => {
  const [r] = await db.insert(orgMembers).values({ email: `cd-${n}-${stamp}@example.test`, role, status: "active", branchId, linkedRecordId: linked, clerkUserId: `u_${n}_${stamp}` }).returning();
  return { id: r!.id, clerkUserId: r!.clerkUserId!, email: r!.email, role: role as Member["role"], branchId, linkedRecordId: linked };
};
const legacy = async (kind: string, name: string, branchId: number | null, details: object, status = "نشط") =>
  (await pool.query("insert into education_records (owner_id, kind, name, branch_id, status, details) values ('org:main',$1,$2,$3,$4,$5) returning id::int", [kind, name, branchId, status, JSON.stringify(details)])).rows[0].id as number;
const riyadh = () => ({ date: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" }), mins: (() => { const [h, m] = new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Riyadh", hour12: false }).slice(0, 5).split(":").map(Number); return h! * 60 + m!; })() });
const hhmm = (m: number) => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;

async function main() {
  const brA = await legacy("branch", `فرع البطاقات ${stamp}`, null, { city: "الرياض", budget: 1 });
  const brB = await legacy("branch", `فرع آخر ${stamp}`, null, { city: "جدة", budget: 1 });
  const room = await legacy("room", "قاعة 1", brA, { type: "قاعة", area: 40, capacity: 20 });
  const room2 = await legacy("room", "قاعة 2", brA, { type: "قاعة", area: 40, capacity: 20 });
  const insA = await legacy("instructor", "مدرب أ", brA, { hourlyRate: 100, weeklyHours: 10 }), insB = await legacy("instructor", "مدرب ب", brA, { hourlyRate: 100, weeklyHours: 10 });
  const s1 = await legacy("student", "طالب 1", brA, { fees: 100 }), s2 = await legacy("student", "طالب 2", brA, { fees: 100 }), s3 = await legacy("student", "طالب 3", brA, { fees: 100 });
  const t = riyadh();
  const session = await legacy("session", "حصة اليوم", brA, { date: t.date, start: hhmm(t.mins - 10), end: hhmm(t.mins + 50), roomId: room, instructorId: insA, studentIds: [s1, s2], diplomaId: 0 }, "scheduled");
  await syncOrganization({ force: true });

  const hr = await mk("hr", "hr_officer", null), coordA = await mk("coordA", "coordinator", brA), coordB = await mk("coordB", "coordinator", brB), gm = await mk("gm", "super_admin", null);
  const instA = await mk("insA", "instructor", brA, insA), instB = await mk("insB", "instructor", brA, insB), stu1 = await mk("stu1", "student", brA, s1), stu3 = await mk("stu3", "student", brA, s3), nobody = await mk("nobody", "finance", null);
  const empMember = await mk("emp", "coordinator", brA);
  const [emp] = await db.insert(employees).values({ employeeNo: `E-${stamp}`, fullName: "موظف البطاقة", branchId: brA, hireDate: "2026-01-01", orgMemberId: empMember.id }).returning();
  void brB; void room2;

  // the card: one per holder, virtual, rotating QR; accounts without a holder have none
  const c1 = await myCard(stu1);
  assert.match(c1.card.number, /^\d{4} \d{4} \d{4}$/); assert.equal(c1.holder.label, "طالب"); assert.match(c1.qr, /^SQ1\.\d+\.\d+\.[\w-]{22}$/); assert.ok(c1.secondsLeft >= 1 && c1.secondsLeft <= 30);
  assert.equal((await myCard(stu1)).card.id, c1.card.id, "one card per holder");
  await fails(myCard(nobody), 404, "no holder, no card");
  assert.equal((await myCard(empMember)).holder.type, "employee"); assert.equal((await myCard(instA)).holder.type, "instructor");

  // gate: coordinator of the branch toggles check-in/out; QR expires; tampering and wrong branch are refused
  const g1 = await gateScan(coordA, { payload: qrPayload(c1.card.id) }); assert.equal(g1.eventType, "check_in");
  assert.equal((await gateScan(coordA, { payload: qrPayload(c1.card.id) }, "10.0.0.7")).eventType, "check_out");
  assert.equal((await gateScan(coordA, { payload: qrPayload(c1.card.id) })).eventType, "check_in");
  assert.equal((await gateScan(coordA, { payload: qrPayload(c1.card.id, Date.now() - 31_000) })).eventType, "check_out", "one window of tolerance");
  await fails(gateScan(coordA, { payload: qrPayload(c1.card.id, Date.now() - 5 * 60_000) }), 422, "expired QR");
  const forged = qrPayload(c1.card.id).replace(/.$/, (c) => (c === "A" ? "B" : "A")); await fails(gateScan(coordA, { payload: forged }), 422, "tampered QR");
  await fails(gateScan(coordA, { payload: `SQ1.${c1.card.id + 999}.${Math.floor(Date.now() / 30000)}.${"x".repeat(22)}` }), 422, "unknown card");
  await fails(gateScan(coordB, { payload: qrPayload(c1.card.id) }), 403, "other branch scanner");
  await fails(gateScan(stu1, { payload: qrPayload(c1.card.id) }), 403, "students cannot scan");
  const ev = (await pool.query("select host(ip) ip, verified, method from presence_events where holder_type='student' and holder_id=$1 order by id", [s1])).rows; assert.equal(ev.length, 4); assert.ok(ev.every((e) => e.verified && e.method === "qr")); assert.equal(ev[1].ip, "10.0.0.7");
  assert.equal((await myPresence(stu1)).length, 4);

  // physical NFC tag: token returned once, only the hash stored; re-keying kills the old token
  await fails(issuePhysicalCard(coordA, { holderType: "employee", holderId: emp!.id }), 403, "coordinators do not issue cards");
  const phys = await issuePhysicalCard(hr, { holderType: "employee", holderId: emp!.id });
  assert.match(phys.token, /^ST1\.[\w-]{32}$/); assert.equal(phys.card.cardType, "nfc");
  assert.ok(!JSON.stringify((await pool.query("select * from identity_cards where id=$1", [phys.card.id])).rows[0]).includes(phys.token.slice(4)), "token is not stored");
  const tap = await gateScan(coordA, { payload: phys.token }); assert.equal(tap.holder.type, "employee"); assert.equal((await pool.query("select method from presence_events where id=$1", [tap.event.id])).rows[0].method, "nfc");
  const rekey = await issuePhysicalCard(hr, { holderType: "employee", holderId: emp!.id }); assert.equal(rekey.card.id, phys.card.id); assert.equal(rekey.card.keyVersion, 3);
  await fails(gateScan(coordA, { payload: phys.token }), 422, "old tag token after re-key");
  assert.equal((await gateScan(coordA, { payload: rekey.token })).eventType, "check_out");

  // instructor: own sessions, room check-in with the room's signed tag
  assert.equal((await mySessions(instA)).length, 1); await fails(mySessions(stu1), 403, "students have no sessions view");
  await fails(roomCheckIn(instA, { roomToken: roomPayload(room2) }), 409, "no session in that room");
  await fails(roomCheckIn(instA, { roomToken: `${roomPayload(room)}x` }), 422, "forged room tag");
  await fails(roomCheckIn(instB, { roomToken: roomPayload(room) }), 409, "another instructor has no session there");
  const rc = await roomCheckIn(instA, { roomToken: roomPayload(room) }, "10.0.0.9"); assert.equal(rc.already, false); assert.equal(rc.session.id, session);
  assert.equal((await roomCheckIn(instA, { roomToken: roomPayload(room) })).already, true);

  // student attendance by scanning the card: only registered students, only the session's instructor, recorded once
  const c3 = await myCard(stu3);
  await fails(studentScan(instA, { payload: qrPayload(c3.card.id), sessionId: session }), 409, "student not registered in the session");
  await fails(studentScan(instB, { payload: qrPayload(c1.card.id), sessionId: session }), 403, "not your session");
  await fails(studentScan(instA, { payload: qrPayload((await myCard(empMember)).card.id), sessionId: session }), 422, "not a student card");
  const a1 = await studentScan(instA, { payload: qrPayload(c1.card.id), sessionId: session }); assert.equal(a1.already, false);
  assert.equal((await studentScan(instA, { payload: qrPayload(c1.card.id), sessionId: session })).already, true);
  const att = (await pool.query("select details, branch_id::int b, status from education_records where kind='attendance' and (details->>'studentId')::int=$1", [s1])).rows; assert.equal(att.length, 1);
  assert.deepEqual([att[0].details.sessionId, att[0].details.present, att[0].b, att[0].status], [session, true, brA, "recorded"]);

  // loss: revoking is immediate and needs a reason; a fresh card is issued on next use
  await fails(revokeCard(coordA, c1.card.id, "فقدت"), 403, "coordinators cannot revoke");
  await fails(revokeCard(hr, c1.card.id, "x"), 400, "reason required");
  await revokeCard(hr, c1.card.id, "فقدان البطاقة", "lost");
  await fails(gateScan(coordA, { payload: qrPayload(c1.card.id) }), 423, "revoked card refused");
  const fresh = await myCard(stu1); assert.notEqual(fresh.card.id, c1.card.id);

  // administration views
  const holders = await listHolders(coordA.role === "coordinator" ? hr : hr, "student"); assert.ok(holders.find((h) => h.id === s1)!.cardId === fresh.card.id);
  await fails(listHolders(coordA, "student"), 403, "coordinators do not manage cards");
  const today = await todayPresence(coordA, undefined); assert.ok(today.length >= 5 && today.every((r) => (r as { branch_id: number }).branch_id === brA), "today's log is branch-scoped");
  assert.ok((await todayPresence(gm, undefined)).length >= today.length);
  const audit = (await pool.query("select action from audit_events where subject_type='identity_card' order by id")).rows.map((r) => r.action);
  assert.deepEqual(audit, ["card.rekey", "card.rekey", "card.lost"]);   // the employee already had a virtual card, so issuing a physical tag re-keys it
  assert.equal((await pool.query("select * from verify_audit_chain()")).rowCount, 0);
  console.log("cards.check passed");
}
main().then(() => pool.end(), (e) => { console.error(e); pool.end().finally(() => process.exit(1)); });
