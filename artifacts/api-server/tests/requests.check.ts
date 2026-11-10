import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db, branches, employees, orgMembers, pool } from "@workspace/db";
import { cancelRequest, closeRequest, createRequest, listRequests, openRequest, requestDetail, requestsCatalogue, requestsStats, respondToRequest } from "../src/lib/requests";
import { setMailTransport } from "../src/lib/smtp";
import { DomainError } from "../src/lib/education-validation";
import type { Member } from "../src/lib/education-access";

/** Internal requests and tasks on a MIGRATED scratch/CI database (ALLOW_DB_TESTS=1). */
if (process.env.ALLOW_DB_TESTS !== "1") { console.log("skipped: set ALLOW_DB_TESTS=1 (scratch/CI database only)"); process.exit(0); }
process.env.SMTP_HOST = "x"; process.env.SMTP_USER = "x"; process.env.SMTP_PASSWORD = "x";
const mails: { to: string; subject: string }[] = [];
setMailTransport(async (m) => { mails.push({ to: m.to, subject: m.subject }); });
const stamp = Date.now();
const fails = async (p: Promise<unknown>, status: number, label: string) => {
  try { await p; } catch (e) { assert.ok(e instanceof DomainError, `${label}: not a DomainError (${(e as Error).message})`); assert.equal(e.status, status, `${label}: expected ${status}, got ${e.status} (${e.message})`); return; }
  assert.fail(`${label}: expected failure ${status}`);
};
const mk = async (n: string, role: string, branchId: number | null): Promise<Member> => {
  const [r] = await db.insert(orgMembers).values({ email: `rq-${n}-${stamp}@example.test`, role, status: "active", branchId, clerkUserId: `u_${n}_${stamp}` }).returning();
  return { id: r!.id, clerkUserId: r!.clerkUserId!, email: r!.email, role: role as Member["role"], branchId, linkedRecordId: null };
};
const emp = async (n: string, branchId: number, email: string | null) => (await db.insert(employees).values({ employeeNo: `RQ-${n}-${stamp}`, fullName: `موظف ${n}`, branchId, email, phone: "0500000000", hireDate: "2026-01-01" }).returning())[0]!;
const pgCode = (e: unknown) => ((e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code);

async function main() {
  const [brA] = await db.insert(branches).values({ code: `QA${stamp}`, name: "فرع أ", city: "الرياض" }).returning();
  const [brB] = await db.insert(branches).values({ code: `QB${stamp}`, name: "فرع ب", city: "جدة" }).returning();
  const gm = await mk("gm", "super_admin", null), mgrA = await mk("mgrA", "branch_manager", brA!.id), mgrB = await mk("mgrB", "branch_manager", brB!.id);
  const coord = await mk("coord", "coordinator", brA!.id), keeper = await mk("keeper", "warehouse_keeper", brA!.id), teacher = await mk("teacher", "instructor", brA!.id);
  const eA = await emp("A", brA!.id, coord.email), eB = await emp("B", brB!.id, `other-${stamp}@example.test`), eSelf = await emp("S", brA!.id, mgrA.email);

  // access: only administrative roles; only managers create
  await fails(requestsCatalogue(teacher), 403, "instructors have no requests access");
  await fails(createRequest(coord, { title: "x", assigneeId: eA.id }), 403, "a non-manager cannot send requests");
  const cat = await requestsCatalogue(mgrA);
  assert.ok(cat.canManage && cat.employees.some((e) => e.id === eA.id) && !cat.employees.some((e) => e.id === eB.id), "branch manager picks only employees of the branch");
  assert.ok((await requestsCatalogue(gm)).employees.some((e) => e.id === eB.id), "general manager sees all employees");
  assert.deepEqual((await requestsCatalogue(coord)).employees, [], "staff get no employee list");

  // stage 1: sent
  await fails(createRequest(mgrA, { title: "", assigneeId: eA.id }), 400, "title required");
  await fails(createRequest(mgrA, { title: "تقرير", assigneeId: eB.id }), 403, "other branch employee");
  await fails(createRequest(mgrA, { title: "لنفسي", assigneeId: eSelf.id }), 400, "not to yourself");
  await fails(createRequest(mgrA, { title: "ماضي", assigneeId: eA.id, dueAt: "2020-01-01T00:00:00Z" }), 400, "due date in the past");
  const r1 = await createRequest(mgrA, { title: "التسجيل في منصة قوى", description: "سجّل المعهد وأرسل الإثبات", requestType: "registration", priority: "high", assigneeId: eA.id, dueAt: new Date(Date.now() + 86_400_000).toISOString() });
  assert.match(r1.requestNo, /^REQ-\d{4}-\d{6}$/);
  const d0 = await requestDetail(mgrA, r1.id);
  assert.equal(d0.status, "sent"); assert.ok(d0.sentAt); assert.equal(d0.receivedAt, null); assert.equal(d0.events.length, 1);
  assert.equal(d0.assigneeName, "موظف A"); assert.equal(d0.assigneePhone, "0500000000"); assert.equal(d0.branchId, brA!.id);
  assert.equal(mails.at(-1)!.to, coord.email, "the assignee is e-mailed");
  const note = (await db.execute(sql`select title from notifications where member_id = ${coord.id} and subject_id = ${r1.id}`)).rows;
  assert.equal(note.length, 1, "and notified inside the app");

  // visibility
  assert.ok((await listRequests(coord, "mine", {})).some((r) => r.id === r1.id), "assignee sees it in their inbox");
  assert.equal((await listRequests(keeper, "mine", {})).length, 0, "someone else's inbox is empty");
  await fails(requestDetail(keeper, r1.id), 404, "a third party cannot read it");
  await fails(requestDetail(mgrB, r1.id), 404, "another branch manager cannot read it");
  await fails(listRequests(coord, "managed", {}), 403, "staff cannot use the manager list");
  assert.ok(!(await listRequests(mgrB, "managed", {})).some((r) => r.id === r1.id));
  assert.ok((await listRequests(gm, "managed", {})).some((r) => r.id === r1.id), "the general manager sees every branch");
  assert.ok((await listRequests(mgrA, "managed", { q: "قوى" })).some((r) => r.id === r1.id), "search by title");

  // stage 2: received = the assignee's first open, stamped once
  const manager = await openRequest(mgrA, r1.id); assert.equal(manager.status, "sent", "a manager looking does not count as received");
  const opened = await openRequest(coord, r1.id); assert.equal(opened.status, "received"); assert.ok(opened.receivedAt);
  const again = await openRequest(coord, r1.id); assert.equal(String(again.receivedAt), String(opened.receivedAt), "a second open changes nothing");
  assert.equal(again.events.filter((e) => e.eventType === "received").length, 1);
  assert.ok(Number(again.receiveSeconds) >= 0);

  // stage 3: responded
  await fails(respondToRequest(mgrA, r1.id, { text: "رد المدير" }), 403, "only the assignee answers");
  await fails(respondToRequest(coord, r1.id, { text: "ok" }), 400, "meaningful answer");
  await fails(respondToRequest(coord, r1.id, { text: "تم التسجيل", links: ["javascript:alert(1)"] }), 400, "unsafe link");
  await fails(respondToRequest(coord, r1.id, { text: "تم التسجيل", links: Array(6).fill("https://example.test/a") }), 400, "too many links");
  await fails(closeRequest(mgrA, r1.id, {}), 409, "cannot close before the answer");
  const answered = await respondToRequest(coord, r1.id, { text: "تم التسجيل وإرفاق الإثبات", links: ["https://example.test/proof.pdf"] });
  assert.equal(answered.status, "responded"); assert.deepEqual(answered.responseLinks, ["https://example.test/proof.pdf"]); assert.ok(Number(answered.responseSeconds) >= 0);
  assert.equal(mails.at(-1)!.to, mgrA.email, "the manager is e-mailed when the answer arrives");
  await fails(respondToRequest(coord, r1.id, { text: "رد ثانٍ" }), 409, "one answer");

  // stage 4: closed by the manager
  await fails(closeRequest(coord, r1.id, {}), 403, "assignee cannot close");
  await fails(closeRequest(mgrB, r1.id, {}), 404, "other branch manager cannot close");
  const closed = await closeRequest(mgrA, r1.id, { note: "ممتاز" });
  assert.equal(closed.status, "closed"); assert.ok(closed.closedAt); assert.equal(closed.closeNote, "ممتاز");
  assert.deepEqual(closed.events.map((e) => e.eventType), ["created", "received", "responded", "closed"]);
  assert.ok(Number(closed.totalSeconds) >= Number(closed.responseSeconds) + Number(closed.receiveSeconds) - 1, "total covers every stage");
  await fails(closeRequest(mgrA, r1.id, {}), 409, "closed once");
  await fails(cancelRequest(mgrA, r1.id, { note: "x" }), 409, "a closed request cannot be cancelled");

  // answering directly counts as received; cancel path
  const r2 = await createRequest(mgrA, { title: "رفع ملف الميزانية", requestType: "upload", assigneeId: eA.id });
  const direct = await respondToRequest(coord, r2.id, { text: "تم الرفع بنجاح" });
  assert.ok(direct.receivedAt && direct.respondedAt); assert.deepEqual(direct.events.map((e) => e.eventType), ["created", "received", "responded"]);
  const r3 = await createRequest(mgrA, { title: "تقرير شهري", requestType: "report", assigneeId: eA.id });
  await fails(cancelRequest(mgrA, r3.id, {}), 400, "a reason is required");
  await fails(cancelRequest(coord, r3.id, { note: "ألغِ" }), 403, "staff cannot cancel");
  const cancelled = await cancelRequest(mgrA, r3.id, { note: "لم تعد هناك حاجة" });
  assert.equal(cancelled.status, "cancelled"); assert.ok(cancelled.cancelledAt);
  await fails(respondToRequest(coord, r3.id, { text: "رد متأخر" }), 409, "no answer after cancellation");

  // late flag
  const r4 = await createRequest(mgrA, { title: "مهمة متأخرة", assigneeId: eA.id, dueAt: new Date(Date.now() + 3_600_000).toISOString() });
  await db.execute(sql`update internal_requests set due_at = now() - interval '1 hour' where id = ${r4.id}`);
  assert.ok((await listRequests(mgrA, "managed", { status: "late" })).some((r) => r.id === r4.id), "an open request past its due date is late");
  assert.ok(!(await listRequests(mgrA, "managed", { status: "late" })).some((r) => r.id === r1.id), "a request answered in time is not late");

  // dashboard
  const st = await requestsStats(mgrA);
  assert.ok(st.totals!.total as number >= 4 && (st.totals!.closed as number) >= 1 && (st.totals!.cancelled as number) >= 1 && (st.totals!.late as number) >= 1);
  assert.ok(st.perEmployee.some((e) => e.assigneeId === eA.id && (e.closed as number) >= 1));
  assert.ok(st.awaitingClose.some((r) => r.id === r2.id), "answered but not closed waits for the manager");
  assert.ok(!(await requestsStats(mgrB)).perEmployee.some((e) => e.assigneeId === eA.id), "another branch sees nothing of it");
  await fails(requestsStats(coord), 403, "dashboard is for managers");

  // database rules hold even outside the application
  await db.execute(sql`update internal_requests set status = 'closed' where id = ${r4.id}`).then(() => assert.fail("closed needs its timestamps"), (e) => assert.equal(pgCode(e), "23514"));
  await db.execute(sql`update internal_request_events set note = 'x' where request_id = ${r1.id}`).then(() => assert.fail("timeline is append-only"), (e) => assert.ok(pgCode(e)));
  await db.execute(sql`update internal_requests set received_at = sent_at - interval '1 minute' where id = ${r4.id}`).then(() => assert.fail("time moves forward"), (e) => assert.equal(pgCode(e), "23514"));
  await db.execute(sql`insert into internal_requests (request_no, title, branch_id, assignee_id, created_by, status) values ('X-${sql.raw(String(stamp))}', 't', ${brA!.id}, ${eA.id}, ${mgrA.id}, 'weird')`).then(() => assert.fail("status list"), (e) => assert.equal(pgCode(e), "23514"));

  setMailTransport(null);
  console.log("requests.check passed");
}

main().then(() => pool.end()).catch((e) => { console.error(e); pool.end().finally(() => process.exit(1)); });
