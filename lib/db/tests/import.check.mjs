// Legacy -> relational importer on a MIGRATED scratch/CI database. Everything runs inside transactions that are rolled back.
import assert from "node:assert/strict";
import pg from "pg";
import { runImport, monthsOf } from "../scripts/import-legacy.mjs";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set");
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
const stamp = Date.now();
const one = async (sql, p = []) => (await c.query(sql, p)).rows[0];
const n = async (sql, p = []) => Number((await one(sql, p)).n);
const legacy = async (kind, name, branchId, details, status = "نشط") => (await one("insert into education_records (owner_id, kind, name, branch_id, status, details) values ('org:main',$1,$2,$3,$4,$5) returning id::int id", [kind, name, branchId, status, JSON.stringify(details)])).id;

console.log("Importer checks");
assert.deepEqual([monthsOf("سنتان").months, monthsOf("2 سنة").months, monthsOf("18 شهر").months, monthsOf("4 فصول").months], [24, 24, 18, 16]);
assert.ok(monthsOf("غير معروف").note, "unparsable duration is flagged");

await c.query("begin");
try {
  const admin = (await one("insert into org_members (email, role, status, clerk_user_id) values ($1,'super_admin','active',$2) returning email", [`imp-admin-${stamp}@example.test`, `u_imp_${stamp}`])).email;
  const A = await legacy("branch", `المركز الرئيسي ${stamp}`, null, { city: "الطائف", budget: 80000 });
  const B = await legacy("branch", `فرع الرياض ${stamp}`, null, { city: "الرياض", budget: 60000 });
  const R1 = await legacy("room", "معمل الحاسب", A, { type: "عملي", area: 80, capacity: 2, powerKw: 12 });
  const R2 = await legacy("room", "قاعة 2", B, { type: "نظري", area: 60, capacity: 30 });
  const D = await legacy("diploma", "دبلوم تقنية المعلومات", null, { duration: "سنتان", fee: 24000 });
  const E = await legacy("diploma", "دبلوم الإدارة", null, { duration: "4 فصول", fee: 20000 });
  const L1 = await legacy("level", "المستوى الأول", null, { diplomaId: D, order: 1 }), L2 = await legacy("level", "المستوى الثاني", null, { diplomaId: D, order: 2 });
  const S1 = await legacy("subject", "مقدمة البرمجة", null, { diplomaId: D, levelId: L1, price: 3000, hours: 40, prerequisiteIds: [] }, "active");
  const S2 = await legacy("subject", "قواعد البيانات", null, { diplomaId: D, levelId: L2, price: 3500, hours: 40, prerequisiteIds: [S1] }, "active");
  const s1 = await legacy("student", "طالب 1", A, { diplomaId: D, levelId: L1, fees: 24000, email: "s1@example.test", phone: "0500000001", subjectIds: [S1] }, "enrolled");
  const s2 = await legacy("student", "طالب 2", A, { diplomaId: D, fees: 24000, email: "not-an-email" }, "enrolled");
  const s3 = await legacy("student", "طالب بلا دبلوم", A, { diplomaId: 999999, fees: 1 }, "enrolled");
  const i1 = await legacy("instructor", "مدرب 1", A, { qualification: "ماجستير", hourlyRate: 150, weeklyHours: 18, subjectIds: [S1] });
  const i2 = await legacy("instructor", "مدرب بأجر خاطئ", A, { hourlyRate: "abc", weeklyHours: 5 });
  const base = { roomId: R1, instructorId: i1, diplomaId: D, subjectId: S1, studentIds: [s1, s2] };
  const ss1 = await legacy("session", "حصة 1", A, { ...base, date: "2026-11-05", start: "09:00", end: "11:00" }, "scheduled");
  const ss2 = await legacy("session", "حصة متداخلة", A, { ...base, date: "2026-11-05", start: "10:00", end: "12:00" }, "scheduled");
  const ss3 = await legacy("session", "حصة منعقدة", A, { ...base, date: "2026-11-04", start: "09:00", end: "11:00" }, "done");
  const at1 = await legacy("attendance", "حضور", A, { studentId: s1, sessionId: ss1, present: true }, "recorded");
  const at2 = await legacy("attendance", "حضور ناقص", A, { studentId: s2, sessionId: ss1 }, "recorded");
  const g1 = await legacy("grade", "درجة", A, { studentId: s1, subject: "مقدمة البرمجة", score: 85, maxScore: 100 }, "recorded");
  const g2 = await legacy("grade", "درجة مادة مجهولة", A, { studentId: s1, subject: "مادة غير موجودة", score: 5, maxScore: 10 }, "recorded");
  const as1 = await legacy("asset", "أجهزة حاسب", A, { roomId: R1, serial: "PC-01", value: 24000, purchaseDate: "2026-01-15", maintenanceDate: "2026-12-01" }, "active");
  const e1 = await legacy("expense", "مستلزمات", A, { category: "ورقيات", amount: 12000, date: "2026-11-01" });
  const e2 = await legacy("expense", "مصروف بفئة غريبة", A, { category: "فئة جديدة", amount: 500.5, date: "2026-11-02" });
  const e3 = await legacy("expense", "مصروف صفري", A, { category: "ورقيات", amount: 0, date: "2026-11-02" });
  const u1 = await legacy("invoice", "كهرباء نوفمبر", A, { meter: `M-${stamp}`, month: "2026-11", kwh: 8200, amount: 6000 });
  const u2 = await legacy("invoice", "كهرباء مكررة", A, { meter: `M-${stamp}`, month: "2026-11", kwh: 1, amount: 1 });
  const in1 = await legacy("installment", "القسط الأول", A, { studentId: s1, amount: 12000, dueDate: "2026-11-03" }, "pending");
  const in2 = await legacy("installment", "القسط الثاني", A, { studentId: s1, amount: 12000, dueDate: "2026-12-15" }, "pending");
  const p1 = await legacy("payment", "دفعة 1", A, { studentId: s1, amount: 15000, date: "2026-11-03" }, "paid");
  const p2 = await legacy("payment", "دفعة 2", A, { studentId: s1, amount: 9000, date: "2026-11-20" }, "paid");
  const p3 = await legacy("payment", "دفعة لطالب مجهول", A, { studentId: 999999, amount: 100, date: "2026-11-20" }, "paid");

  // ---- dry run: reports, writes nothing ----
  await c.query("savepoint dry");
  const dry = await runImport(c, { dryRun: true, actorEmail: admin });
  assert.equal(dry.dryRun, true); assert.ok(dry.kinds.payment.imported >= 2);
  await c.query("rollback to savepoint dry"); await c.query("release savepoint dry");
  assert.equal(await n("select count(*)::int n from payments where id = any($1)", [[p1, p2]]), 0, "dry run leaves no trace");

  // ---- real run ----
  const r = await runImport(c, { actorEmail: admin });
  const skipped = (kind, id) => r.skipped.find((x) => x.kind === kind && x.id === id);
  assert.equal(r.ok, true, JSON.stringify(r.totals));
  for (const k of ["payments_halalas", "expenses_halalas", "installments_halalas", "utility_halalas"]) assert.equal(r.totals[k].ok, true, k);
  assert.ok(r.totals.payments_halalas.legacy >= 2400000, "payments reconcile to the halala");

  // same ids everywhere
  assert.equal(await n("select count(*)::int n from students where id = any($1)", [[s1, s2]]), 2);
  assert.equal(await n("select count(*)::int n from payments where id = any($1)", [[p1, p2]]), 2);
  assert.equal(await n("select count(*)::int n from branches where id = any($1)", [[A, B]]), 2);
  assert.equal((await one("select is_head_office h from branches where id = $1", [A])).h, true, "head office detected");

  // conversions
  assert.equal((await one("select duration_months::int n, total_hours::int h, price_halalas::int p from diplomas where id = $1", [D])).n, 24);
  assert.equal(await n("select duration_months::int n from diplomas where id = $1", [E]), 16);
  assert.equal(await n("select price_halalas::int n from subjects where id = $1", [S2]), 350000);
  assert.equal(await n("select count(*)::int n from subject_prerequisites where subject_id = $1 and prerequisite_id = $2", [S2, S1]), 1);
  assert.equal((await one("select email from students where id = $1", [s2])).email, null, "invalid e-mail dropped");
  assert.equal(await n("select count(*)::int n from student_subjects where student_id = $1", [s1]), 1);
  assert.equal(await n("select count(*)::int n from session_students where session_id = $1", [ss1]), 2);
  assert.equal((await one("select status from class_sessions where id = $1", [ss3])).status, "done");
  assert.equal(await n("select count(*)::int n from attendance_records where session_id = $1 and student_id = $2 and present", [ss1, s1]), 1);
  assert.equal(await n("select (score * 100)::int n from grades where id = $1", [g1]), 8500);
  assert.equal(await n("select purchase_cost_halalas::int n from assets where id = $1", [as1]), 2400000);
  assert.equal(await n("select count(*)::int n from asset_maintenance where asset_id = $1 and due_date = '2026-12-01'", [as1]), 1);
  assert.equal(await n("select net_halalas::int n from expenses where id = $1", [e1]), 1200000);
  assert.equal(await n("select net_halalas::int n from expenses where id = $1", [e2]), 50050, "decimal SAR becomes exact halalas");
  assert.equal((await one("select c.code from expenses e join expense_categories c on c.id = e.category_id where e.id = $1", [e2])).code, "OTHER");
  assert.equal((await one("select c.code, e.status, e.source from expenses e join expense_categories c on c.id = e.category_id where e.id = $1", [e1])).code, "PAPER");
  assert.equal(await n("select net_halalas::int n from utility_invoices where id = $1", [u1]), 600000);

  // payments allocated oldest-due first: 15000 -> 12000 + 3000, then 9000 -> remaining 9000
  const al = (await c.query("select payment_id::int p, installment_id::int i, amount_halalas::int a from payment_allocations order by payment_id, installment_id")).rows.filter((x) => [p1, p2].includes(x.p));
  assert.deepEqual(al.map((x) => [x.p, x.i, x.a]), [[p1, in1, 1200000], [p1, in2, 300000], [p2, in2, 900000]]);
  assert.deepEqual((await c.query("select status from installments where id = any($1) order by id", [[in1, in2]])).rows.map((x) => x.status), ["paid", "paid"]);

  // skips carry the reason
  assert.match(skipped("student", s3).reason, /دبلوم/); assert.match(skipped("instructor", i2).reason, /أجر/);
  assert.ok(skipped("session", ss2), "overlapping session refused by the exclusion constraint"); assert.match(skipped("attendance", at2).reason, /الحضور/);
  assert.match(skipped("grade", g2).reason, /غير معروفة/); assert.ok(skipped("expense", e3)); assert.ok(skipped("invoice", u2), "duplicate meter-month refused");
  assert.ok(skipped("payment", p3)); assert.ok(r.notes.some((x) => x.includes("فئة جديدة")), "unknown expense category is reported");
  void at1;

  // idempotent: a second run changes nothing
  const before = { pay: await n("select count(*)::int n from payments"), exp: await n("select count(*)::int n from expenses"), alloc: await n("select count(*)::int n from payment_allocations"), st: await n("select count(*)::int n from students") };
  const again = await runImport(c, { actorEmail: admin });
  assert.equal(again.ok, true); assert.equal(again.kinds.payment.imported, 0); assert.equal(again.kinds.expense.imported, 0); assert.equal(again.kinds.installment.imported, 0);
  assert.deepEqual({ pay: await n("select count(*)::int n from payments"), exp: await n("select count(*)::int n from expenses"), alloc: await n("select count(*)::int n from payment_allocations"), st: await n("select count(*)::int n from students") }, before);

  // sequences repaired: a normal insert gets a fresh id
  await c.query("insert into students (student_no, branch_id, diploma_id, full_name) values ($1,$2,$3,'يدوي')", [`ST-M${stamp}`, A, D]);

  // an updated legacy record is picked up (master data), money stays frozen
  await c.query("update education_records set name = 'طالب 1 معدّل' where id = $1", [s1]);
  await c.query("update education_records set details = jsonb_set(details, '{amount}', '99999') where id = $1", [p1]);
  await runImport(c, { actorEmail: admin });
  assert.equal((await one("select full_name from students where id = $1", [s1])).full_name, "طالب 1 معدّل");
  assert.equal(await n("select amount_halalas::int n from payments where id = $1", [p1]), 1500000, "confirmed payments are never rewritten");
  console.log("  ok   importer: ids, conversions, allocation, skips with reasons, idempotency, dry run");
} finally {
  await c.query("rollback");
  await c.end();
}
console.log("import.check passed");
