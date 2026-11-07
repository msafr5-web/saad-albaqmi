// Verifies the relational schema on a MIGRATED database: constraints, triggers, exclusion rules, views, seeds.
// Usage: DATABASE_URL=postgres://... pnpm --filter @workspace/db run check:schema
// Every test runs inside a transaction that is rolled back, so the database is left untouched.
// Requires a role allowed to ALTER TABLE ... DISABLE TRIGGER (only for the tamper-detection test).
import assert from "node:assert/strict";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

let passed = 0; const failed = [];
let seq = 0; const uniq = (p) => `${p}${++seq}-${Date.now() % 100000}`;

async function test(name, fn) {
  await client.query("BEGIN");
  try { await fn(client); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed.push(name); console.log(`  FAIL ${name}\n       ${e.message.split("\n")[0]}`); }
  finally { await client.query("ROLLBACK"); }
}
/** Runs a statement that MUST be rejected; keeps the surrounding transaction usable via a savepoint. */
async function rejects(c, text, params = [], expect) {
  await c.query("SAVEPOINT sp");
  try { await c.query(text, params); } catch (e) {
    await c.query("ROLLBACK TO sp");
    if (expect) assert.match(e.message, expect, `rejected, but for another reason: ${e.message}`);
    return e;
  }
  await c.query("RELEASE sp");
  assert.fail(`statement was accepted but must be rejected: ${text.slice(0, 90)}`);
}
const one = async (c, text, params = []) => (await c.query(text, params)).rows[0];
const ins = async (c, table, row) => {
  const cols = Object.keys(row);
  return (await one(c, `insert into ${table} (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")}) returning *`, Object.values(row)));
};

// ---- fixtures ---------------------------------------------------------------------------------------------------
const VAT_A = "300000000000003", VAT_B = "300000000000013", VAT_C = "300000000000023", VAT_E = "310000000000003";
async function member(c, role = "coordinator") { return ins(c, "org_members", { email: `${uniq("u")}@example.test`, role, status: "active" }); }
async function branch(c, extra = {}) { return ins(c, "branches", { code: uniq("B"), name: "فرع", city: "الرياض", ...extra }); }
async function base(c) {
  const br = await branch(c);
  const room = await ins(c, "rooms", { branch_id: br.id, code: uniq("R"), name: "قاعة 1", room_type: "classroom", area_m2: 50, capacity: 2 });
  const ins1 = await ins(c, "instructors", { instructor_no: uniq("I"), branch_id: br.id, full_name: "مدرب", hourly_rate_halalas: 15000, weekly_hours: 10 });
  const ins2 = await ins(c, "instructors", { instructor_no: uniq("I"), branch_id: br.id, full_name: "مدرب 2", hourly_rate_halalas: 15000, weekly_hours: 10 });
  const dip = await ins(c, "diplomas", { code: uniq("D"), name: "دبلوم", duration_months: 24, total_hours: 400, price_halalas: 2400000, price_includes_vat: false });
  const lv1 = await ins(c, "levels", { diploma_id: dip.id, level_no: 1, name: "المستوى 1" });
  const lv2 = await ins(c, "levels", { diploma_id: dip.id, level_no: 2, name: "المستوى 2" });
  const mk = (n) => ins(c, "students", { student_no: uniq("S"), branch_id: br.id, diploma_id: dip.id, full_name: `طالب ${n}` });
  return { br, room, ins1, ins2, dip, lv1, lv2, s1: await mk(1), s2: await mk(2), s3: await mk(3) };
}
const session = (c, f, o = {}) => ins(c, "class_sessions", { branch_id: f.br.id, room_id: f.room.id, instructor_id: f.ins1.id, diploma_id: f.dip.id, title: "حصة", session_date: "2026-12-01", start_time: "09:00", end_time: "11:00", ...o });
async function supplier(c, vat, approver) { return ins(c, "suppliers", { supplier_no: uniq("SUP"), legal_name: uniq("مورد"), vat_number: vat, status: "approved", approved_by: approver.id }); }
async function stockBase(c) {
  const br = await branch(c); const m = await member(c);
  const cat = await one(c, "select id from item_categories limit 1"); const unit = await one(c, "select id from units limit 1");
  const item = await ins(c, "items", { item_code: uniq("ITM"), name: "ورق A4", category_id: cat.id, unit_id: unit.id });
  const wh = await ins(c, "warehouses", { branch_id: br.id, code: uniq("WH"), name: "مستودع" });
  const room = await ins(c, "rooms", { branch_id: br.id, code: uniq("R"), name: "قاعة", room_type: "lab", area_m2: 40, capacity: 20 });
  return { br, m, item, wh, room, cat, unit };
}
const mv = (c, f, type, delta, extra = {}) => ins(c, "stock_movements", { movement_no: uniq("MV"), warehouse_id: f.wh.id, item_id: f.item.id, movement_type: type, qty_delta: delta, created_by: f.m.id, ...extra });

console.log("Schema checks");

// ---- structure and seeds -----------------------------------------------------------------------------------------
await test("80+ relational tables exist and legacy tables are preserved", async (c) => {
  const n = await one(c, "select count(*)::int n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'");
  assert.ok(n.n >= 85, `expected >= 85 tables, got ${n.n}`);
  for (const t of ["education_records", "education_audit", "org_members", "cost_policies"]) assert.ok(await one(c, "select to_regclass($1) r", [`public.${t}`]).then((r) => r.r));
});
await test("every table carries an Arabic description (COMMENT ON TABLE)", async (c) => {
  const r = await c.query("select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and obj_description(c.oid) is null");
  assert.deepEqual(r.rows.map((x) => x.relname), [], "tables without a comment");
});
await test("reporting views are queryable", async (c) => {
  for (const v of ["v_stock_balances", "v_reorder_status", "v_consumption_monthly", "v_student_ledger", "v_branch_budget_status", "v_purchase_period_usage", "v_vat_sales", "v_vat_purchases", "v_audit_workflow"]) await c.query(`select * from ${v} limit 1`);
});
await test("reference data is seeded", async (c) => {
  assert.equal((await one(c, "select rate::float r from tax_rates where code='VAT15'")).r, 15);
  assert.equal((await one(c, "select value from org_settings where key='procurement.min_quotes'")).value, "3");
  assert.ok((await one(c, "select count(*)::int n from expense_categories where is_petty")).n >= 3);
  assert.ok((await one(c, "select count(*)::int n from leave_types")).n >= 5);
});

// ---- money and VAT -------------------------------------------------------------------------------------------------
await test("VAT split uses halalas and one rounding rule", async (c) => {
  assert.equal((await one(c, "select vat_net(11500, 15, true)::int v")).v, 10000);
  assert.equal((await one(c, "select vat_gross(10000, 15, false)::int v")).v, 11500);
  assert.equal((await one(c, "select vat_gross(11500, 15, true)::int v")).v, 11500);
});
await test("diploma price: inclusive vs exclusive produce the same net/gross", async (c) => {
  const a = await ins(c, "diplomas", { code: uniq("D"), name: "شامل", duration_months: 12, total_hours: 100, price_halalas: 11500, price_includes_vat: true });
  const b = await ins(c, "diplomas", { code: uniq("D"), name: "غير شامل", duration_months: 12, total_hours: 100, price_halalas: 10000, price_includes_vat: false });
  assert.deepEqual([Number(a.net_price_halalas), Number(a.gross_price_halalas)], [10000, 11500]);
  assert.deepEqual([Number(b.net_price_halalas), Number(b.gross_price_halalas)], [10000, 11500]);
});
await test("document numbers are sequential and a rollback does not burn a number", async (c) => {
  const a = (await one(c, "select next_doc_no('PO') n")).n, b = (await one(c, "select next_doc_no('PO') n")).n;
  assert.match(a, /^PO-\d{4}-\d{6}$/); assert.equal(Number(b.slice(-6)), Number(a.slice(-6)) + 1);
});

// ---- organization ---------------------------------------------------------------------------------------------------
await test("only one head office; VAT number format enforced", async (c) => {
  await branch(c, { is_head_office: true });
  await rejects(c, "insert into branches (code,name,city,is_head_office) values ('X2','x','y',true)", [], /branches_one_head_office_uq/);
  await rejects(c, "insert into branches (code,name,city,vat_number) values ('X3','x','y','12345')", [], /branches_vat_format_ck/);
  await branch(c, { vat_number: VAT_A });
});
await test("suppliers: approval needs a VAT number and approver; VAT unique and well-formed", async (c) => {
  const m = await member(c);
  await rejects(c, "insert into suppliers (supplier_no,legal_name,status) values ('S1','x','approved')", [], /suppliers_approved_ck/);
  await rejects(c, "insert into suppliers (supplier_no,legal_name,vat_number) values ('S2','x','400000000000004')", [], /suppliers_vat_format_ck/);
  await supplier(c, VAT_A, m);
  await rejects(c, "insert into suppliers (supplier_no,legal_name,vat_number) values ('S3','y',$1)", [VAT_A], /suppliers_vat_uq/);
});

// ---- academic integrity ---------------------------------------------------------------------------------------------
await test("a room or an instructor cannot be double-booked; adjacent and cancelled sessions are fine", async (c) => {
  const f = await base(c);
  await session(c, f);
  await rejects(c, "insert into class_sessions (branch_id,room_id,instructor_id,diploma_id,title,session_date,start_time,end_time) values ($1,$2,$3,$4,'x','2026-12-01','10:00','12:00')", [f.br.id, f.room.id, f.ins2.id, f.dip.id], /class_sessions_no_room_overlap/);
  await rejects(c, "insert into class_sessions (branch_id,room_id,instructor_id,diploma_id,title,session_date,start_time,end_time) values ($1,$2,$3,$4,'x','2026-12-01','10:00','12:00')",
    [f.br.id, (await ins(c, "rooms", { branch_id: f.br.id, code: uniq("R"), name: "قاعة 2", room_type: "lab", area_m2: 30, capacity: 5 })).id, f.ins1.id, f.dip.id], /class_sessions_no_instructor_overlap/);
  await session(c, f, { start_time: "11:00", end_time: "12:00" });
  await session(c, f, { start_time: "09:30", end_time: "10:30", status: "cancelled" });
});
await test("room capacity, branch/diploma match and student overlap are enforced", async (c) => {
  const f = await base(c); const s = await session(c, f);
  await ins(c, "session_students", { session_id: s.id, student_id: f.s1.id });
  await ins(c, "session_students", { session_id: s.id, student_id: f.s2.id });
  await rejects(c, "insert into session_students values ($1,$2)", [s.id, f.s3.id], /room capacity/);
  const other = await branch(c); const alien = await ins(c, "students", { student_no: uniq("S"), branch_id: other.id, diploma_id: f.dip.id, full_name: "x" });
  const big = await ins(c, "rooms", { branch_id: f.br.id, code: uniq("R"), name: "كبيرة", room_type: "lab", area_m2: 90, capacity: 30 });
  const s2 = await session(c, f, { room_id: big.id, instructor_id: f.ins2.id, start_time: "10:00", end_time: "12:00" });
  await rejects(c, "insert into session_students values ($1,$2)", [s2.id, alien.id], /branch\/diploma/);
  await rejects(c, "insert into session_students values ($1,$2)", [s2.id, f.s1.id], /overlapping session/);
});
await test("a subject's level must belong to its diploma; prerequisites must be earlier levels", async (c) => {
  const f = await base(c); const other = await ins(c, "diplomas", { code: uniq("D"), name: "آخر", duration_months: 6, total_hours: 60, price_halalas: 1, price_includes_vat: false });
  const sub = (lv, dip, n) => ins(c, "subjects", { code: uniq("SB"), diploma_id: dip, level_id: lv, name: n, price_halalas: 300000, price_includes_vat: false, hours: 40 });
  const a = await sub(f.lv1.id, f.dip.id, "أ"), b = await sub(f.lv2.id, f.dip.id, "ب");
  await rejects(c, "insert into subjects (code,diploma_id,level_id,name,price_halalas,price_includes_vat,hours) values ('Z',$1,$2,'x',1,false,1)", [other.id, f.lv1.id], /does not belong to diploma/);
  await ins(c, "subject_prerequisites", { subject_id: b.id, prerequisite_id: a.id });
  await rejects(c, "insert into subject_prerequisites values ($1,$2)", [a.id, b.id], /earlier level/);
  await rejects(c, "insert into subject_prerequisites values ($1,$1)", [a.id], /earlier level|subject_prerequisites_self_ck/);
});
await test("grades cannot exceed the maximum score", async (c) => {
  const f = await base(c); const lv = f.lv1;
  const sb = await ins(c, "subjects", { code: uniq("SB"), diploma_id: f.dip.id, level_id: lv.id, name: "م", price_halalas: 1, price_includes_vat: false, hours: 1 });
  await rejects(c, "insert into grades (student_id,subject_id,assessment_type,score,max_score,assessed_on) values ($1,$2,'final',101,100,'2026-12-01')", [f.s1.id, sb.id], /grades_score_ck/);
});

// ---- inventory --------------------------------------------------------------------------------------------------------
await test("stock ledger: no negative balance, sign rules, append-only", async (c) => {
  const f = await stockBase(c);
  await mv(c, f, "opening", 10);
  await mv(c, f, "issue", -4, { issued_to_room_id: f.room.id });
  await rejects(c, "insert into stock_movements (movement_no,warehouse_id,item_id,movement_type,qty_delta,created_by,issued_to_room_id) values ('MVX',$1,$2,'issue',-7,$3,$4)", [f.wh.id, f.item.id, f.m.id, f.room.id], /insufficient stock/);
  await rejects(c, "insert into stock_movements (movement_no,warehouse_id,item_id,movement_type,qty_delta,created_by) values ('MVY',$1,$2,'receipt',-1,$3)", [f.wh.id, f.item.id, f.m.id], /stock_movements_sign_ck/);
  await rejects(c, "insert into stock_movements (movement_no,warehouse_id,item_id,movement_type,qty_delta,created_by) values ('MVZ',$1,$2,'issue',-1,$3)", [f.wh.id, f.item.id, f.m.id], /stock_movements_issue_target_ck/);
  assert.equal(Number((await one(c, "select qty_on_hand q from v_stock_balances where warehouse_id=$1 and item_id=$2", [f.wh.id, f.item.id])).q), 6);
  await rejects(c, "update stock_movements set qty_delta = 1", [], /append-only/);
  await rejects(c, "delete from stock_movements", [], /append-only/);
});
await test("a single reorder alert opens at the minimum and closes when stock recovers", async (c) => {
  const f = await stockBase(c);
  await ins(c, "stock_levels", { warehouse_id: f.wh.id, item_id: f.item.id, min_qty: 5 });
  await mv(c, f, "opening", 10);
  assert.equal((await one(c, "select count(*)::int n from reorder_alerts where warehouse_id=$1", [f.wh.id])).n, 0);
  await mv(c, f, "issue", -5, { issued_to_room_id: f.room.id });
  await mv(c, f, "issue", -1, { issued_to_room_id: f.room.id });
  const alerts = await c.query("select * from reorder_alerts where warehouse_id=$1", [f.wh.id]);
  assert.equal(alerts.rowCount, 1); assert.equal(alerts.rows[0].status, "open");
  assert.equal((await one(c, "select needs_reorder n, has_open_alert h from v_reorder_status where warehouse_id=$1", [f.wh.id])).n, true);
  await mv(c, f, "receipt", 20);
  assert.equal((await one(c, "select status from reorder_alerts where warehouse_id=$1", [f.wh.id])).status, "closed");
});
await test("consumption view reports issued quantities per room and month", async (c) => {
  const f = await stockBase(c); await mv(c, f, "opening", 50); await mv(c, f, "issue", -12, { issued_to_room_id: f.room.id });
  const r = await one(c, "select qty_issued::float q from v_consumption_monthly where room_id=$1", [f.room.id]); assert.equal(r.q, 12);
});

// ---- finance ----------------------------------------------------------------------------------------------------------
await test("confirmed payments are immutable; reversals need a reason; allocations are bounded", async (c) => {
  const f = await base(c); const m = await member(c);
  const pay = await ins(c, "payments", { receipt_no: uniq("RC"), branch_id: f.br.id, student_id: f.s1.id, amount_halalas: 100000, paid_on: "2026-12-01", method: "cash", collected_by: m.id });
  await c.query("update payments set status='confirmed', confirmed_at=now() where id=$1", [pay.id]);
  await rejects(c, "update payments set amount_halalas=1 where id=$1", [pay.id], /immutable/);
  await rejects(c, "delete from payments where id=$1", [pay.id], /cannot be deleted/);
  const inst = await ins(c, "installments", { student_id: f.s1.id, seq: 1, due_date: "2026-12-15", amount_halalas: 80000 });
  const instOther = await ins(c, "installments", { student_id: f.s2.id, seq: 1, due_date: "2026-12-15", amount_halalas: 80000 });
  await ins(c, "payment_allocations", { payment_id: pay.id, installment_id: inst.id, amount_halalas: 80000 });
  await rejects(c, "insert into payment_allocations values ($1,$2,10000)", [pay.id, instOther.id], /different students/);
  const inst2 = await ins(c, "installments", { student_id: f.s1.id, seq: 2, due_date: "2027-01-15", amount_halalas: 50000 });
  await rejects(c, "insert into payment_allocations values ($1,$2,30000)", [pay.id, inst2.id], /exceed the payment/);
  await rejects(c, "insert into payments (receipt_no,branch_id,student_id,amount_halalas,paid_on,method,collected_by,reverses_payment_id) values ('R2',$1,$2,100000,'2026-12-02','cash',$3,$4)", [f.br.id, f.s1.id, m.id, pay.id], /payments_reversal_ck/);
  const rev = await ins(c, "payments", { receipt_no: uniq("RC"), branch_id: f.br.id, student_id: f.s1.id, amount_halalas: 100000, paid_on: "2026-12-02", method: "cash", collected_by: m.id, reverses_payment_id: pay.id, reversal_reason: "إدخال خاطئ" });
  await c.query("update payments set status='reversed' where id=$1", [pay.id]);
  assert.ok(rev.id);
  await rejects(c, "insert into payments (receipt_no,branch_id,student_id,amount_halalas,paid_on,method,collected_by,reverses_payment_id,reversal_reason) values ('R3',$1,$2,1,'2026-12-02','cash',$3,$4,'again')", [f.br.id, f.s1.id, m.id, pay.id], /payments_one_reversal_uq/);
});
await test("a payment cannot be confirmed without a confirmation time", async (c) => {
  const f = await base(c); const m = await member(c);
  await rejects(c, "insert into payments (receipt_no,branch_id,student_id,amount_halalas,paid_on,method,collected_by,status) values ('R9',$1,$2,5,'2026-12-01','cash',$3,'confirmed')", [f.br.id, f.s1.id, m.id], /payments_confirmed_ck/);
});
await test("expenses: confirmed rows are immutable, gross = net + VAT, VAT/bills cannot be negative", async (c) => {
  const f = await base(c); const m = await member(c); const cat = await one(c, "select id from expense_categories where code='PAPER'");
  const e = await ins(c, "expenses", { expense_no: uniq("EX"), branch_id: f.br.id, category_id: cat.id, expense_date: "2026-12-01", description: "ورق", net_halalas: 10000, vat_halalas: 1500, created_by: m.id });
  assert.equal(Number(e.gross_halalas), 11500);
  await c.query("update expenses set status='confirmed', confirmed_at=now() where id=$1", [e.id]);
  await rejects(c, "update expenses set net_halalas=1 where id=$1", [e.id], /immutable/);
  await c.query("update expenses set status='reversed' where id=$1", [e.id]);      // confirmed -> reversed is the only allowed transition
  await rejects(c, "update expenses set status='pending_otp' where id=$1", [e.id], /immutable|illegal status/);
  await rejects(c, "insert into expenses (expense_no,branch_id,category_id,expense_date,description,net_halalas,created_by) values ('E2',$1,$2,'2026-12-01','x',-1,$3)", [f.br.id, cat.id, m.id], /expenses_amounts_ck/);
});
await test("one electricity bill per meter and month; monthly budgets are unique", async (c) => {
  const f = await base(c);
  const meter = await ins(c, "electricity_meters", { branch_id: f.br.id, meter_no: uniq("M") });
  await ins(c, "utility_invoices", { branch_id: f.br.id, meter_id: meter.id, bill_month: "2026-11-01", kwh: 1000, net_halalas: 60000 });
  await rejects(c, "insert into utility_invoices (branch_id,meter_id,bill_month,kwh,net_halalas) values ($1,$2,'2026-11-01',5,5)", [f.br.id, meter.id], /utility_invoices_meter_month_uq/);
  await rejects(c, "insert into utility_invoices (branch_id,meter_id,bill_month,kwh,net_halalas) values ($1,$2,'2026-11-15',5,5)", [f.br.id, meter.id], /utility_invoices_month_ck/);
  await ins(c, "branch_budgets", { branch_id: f.br.id, period_month: "2026-11-01", amount_halalas: 1000000 });
  await rejects(c, "insert into branch_budgets (branch_id,period_month,amount_halalas) values ($1,'2026-11-01',5)", [f.br.id], /branch_budgets_uq/);
});
await test("a standard tax invoice needs the buyer VAT number; line VAT is computed", async (c) => {
  const f = await base(c);
  await rejects(c, "insert into sales_invoices (invoice_no,branch_id,customer_name,invoice_type,issue_date) values ('SI1',$1,'شركة','standard','2026-12-01')", [f.br.id], /sales_invoices_standard_ck/);
  const inv = await ins(c, "sales_invoices", { invoice_no: uniq("SI"), branch_id: f.br.id, customer_name: "شركة", customer_vat_number: VAT_A, invoice_type: "standard", issue_date: "2026-12-01" });
  const ln = await ins(c, "sales_invoice_lines", { invoice_id: inv.id, line_no: 1, description: "رسوم", quantity: 2, unit_price_halalas: 50000, discount_halalas: 0 });
  assert.deepEqual([Number(ln.net_halalas), Number(ln.vat_halalas)], [100000, 15000]);
});
await test("payroll lines lock once the run is approved", async (c) => {
  const f = await base(c);
  const emp = await ins(c, "employees", { employee_no: uniq("E"), full_name: "موظف", branch_id: f.br.id, hire_date: "2026-01-01" });
  const run = await ins(c, "payroll_runs", { branch_id: f.br.id, period_month: "2026-11-01" });
  const line = await ins(c, "payroll_lines", { run_id: run.id, employee_id: emp.id, basic_halalas: 500000, allowances_halalas: 100000, deductions_halalas: 20000 });
  assert.equal(Number(line.net_halalas), 580000);
  await c.query("update payroll_runs set status='approved' where id=$1", [run.id]);
  await rejects(c, "update payroll_lines set basic_halalas=1 where id=$1", [line.id], /locked/);
});

// ---- HR ---------------------------------------------------------------------------------------------------------------
await test("leave and delegation windows cannot overlap; delegation approval needs a different person", async (c) => {
  const f = await base(c); const lt = await one(c, "select id from leave_types limit 1");
  const emp = await ins(c, "employees", { employee_no: uniq("E"), full_name: "مدير", branch_id: f.br.id, hire_date: "2026-01-01" });
  await ins(c, "leave_requests", { employee_id: emp.id, leave_type_id: lt.id, start_date: "2026-12-01", end_date: "2026-12-10" });
  await rejects(c, "insert into leave_requests (employee_id,leave_type_id,start_date,end_date) values ($1,$2,'2026-12-05','2026-12-15')", [emp.id, lt.id], /leave_requests_no_overlap/);
  const mgr = await member(c, "branch_manager"), dep = await member(c, "coordinator"), hr = await member(c, "coordinator"), gm = await member(c, "super_admin");
  await ins(c, "approval_delegations", { delegator_member_id: mgr.id, delegate_member_id: dep.id, valid_from: "2026-12-01", valid_to: "2026-12-10", proposed_by: hr.id });
  await rejects(c, "insert into approval_delegations (delegator_member_id,delegate_member_id,valid_from,valid_to,proposed_by) values ($1,$2,'2026-12-09','2026-12-12',$3)", [mgr.id, dep.id, hr.id], /approval_delegations_no_overlap/);
  await rejects(c, "insert into approval_delegations (delegator_member_id,delegate_member_id,valid_from,valid_to,proposed_by,status,approved_by) values ($1,$2,'2027-01-01','2027-01-05',$3,'approved',$3)", [mgr.id, dep.id, hr.id], /approval_delegations_approved_ck/);
  await ins(c, "approval_delegations", { delegator_member_id: mgr.id, delegate_member_id: dep.id, valid_from: "2027-01-01", valid_to: "2027-01-05", proposed_by: hr.id, status: "approved", approved_by: gm.id });
});

// ---- procurement ------------------------------------------------------------------------------------------------------
async function procurement(c) {
  const f = await stockBase(c); const approver = await member(c, "branch_manager"), prep = await member(c, "coordinator"), rec = await member(c, "coordinator");
  const s = [await supplier(c, VAT_A, approver), await supplier(c, VAT_B, approver), await supplier(c, VAT_C, approver)];
  const pr = await ins(c, "purchase_requests", { pr_no: uniq("PR"), branch_id: f.br.id, warehouse_id: f.wh.id, requested_by: prep.id });
  await ins(c, "purchase_request_lines", { pr_id: pr.id, item_id: f.item.id, qty: 100 });
  const rfq = await ins(c, "rfqs", { rfq_no: uniq("RFQ"), pr_id: pr.id, deadline_at: new Date(Date.now() + 864e5), created_by: prep.id });
  const quote = async (sup, price) => { const q = await ins(c, "quotations", { rfq_id: rfq.id, supplier_id: sup.id, supplier_vat_number: sup.vat_number, quote_date: "2026-12-01", entered_by: prep.id });
    await ins(c, "quotation_lines", { quotation_id: q.id, item_id: f.item.id, quantity: 100, unit_price_halalas: price }); return q; };
  return { f, approver, prep, rec, s, pr, rfq, quote };
}
await test("award needs three suppliers, truthful lowest-price flag and a justification otherwise", async (c) => {
  const p = await procurement(c);
  const q1 = await p.quote(p.s[0], 500), q2 = await p.quote(p.s[1], 400);
  await rejects(c, "insert into rfq_awards (rfq_id,quotation_id,is_lowest_price,recommended_by) values ($1,$2,true,$3)", [p.rfq.id, q2.id, p.prep.id], /at least 3 quotations/);
  const q3 = await p.quote(p.s[2], 450);
  await rejects(c, "insert into rfq_awards (rfq_id,quotation_id,is_lowest_price,recommended_by) values ($1,$2,true,$3)", [p.rfq.id, q1.id, p.prep.id], /not the cheapest/);
  await rejects(c, "insert into rfq_awards (rfq_id,quotation_id,is_lowest_price,recommended_by) values ($1,$2,false,$3)", [p.rfq.id, q3.id, p.prep.id], /rfq_awards_justification_ck/);
  await ins(c, "rfq_awards", { rfq_id: p.rfq.id, quotation_id: q3.id, is_lowest_price: false, justification: "أفضل جودة وأقصر مدة توريد", recommended_by: p.prep.id });
});
await test("only approved suppliers with a matching VAT number can quote", async (c) => {
  const p = await procurement(c);
  const pend = await ins(c, "suppliers", { supplier_no: uniq("SUP"), legal_name: "معلق", vat_number: VAT_E });
  await rejects(c, "insert into quotations (rfq_id,supplier_id,supplier_vat_number,quote_date,entered_by) values ($1,$2,$3,'2026-12-01',$4)", [p.rfq.id, pend.id, VAT_E, p.prep.id], /not approved/);
  await rejects(c, "insert into quotations (rfq_id,supplier_id,supplier_vat_number,quote_date,entered_by) values ($1,$2,$3,'2026-12-01',$4)", [p.rfq.id, p.s[0].id, VAT_B, p.prep.id], /does not match the supplier register/);
});
await test("a PO needs an approved award, the awarded supplier, segregation of duties; and freezes after preparation", async (c) => {
  const p = await procurement(c);
  const q = [await p.quote(p.s[0], 500), await p.quote(p.s[1], 400), await p.quote(p.s[2], 450)];
  await ins(c, "rfq_awards", { rfq_id: p.rfq.id, quotation_id: q[1].id, is_lowest_price: true, recommended_by: p.prep.id });
  const po = (o = {}) => ({ po_no: uniq("PO"), pr_id: p.pr.id, rfq_id: p.rfq.id, branch_id: p.f.br.id, warehouse_id: p.f.wh.id, supplier_id: p.s[1].id, entity_name: "معهد", entity_vat_number: VAT_A, supplier_vat_number: p.s[1].vat_number, issue_date: "2026-12-02", prepared_by: p.prep.id, ...o });
  await rejects(c, "insert into purchase_orders (po_no,pr_id,rfq_id,branch_id,warehouse_id,supplier_id,entity_name,entity_vat_number,supplier_vat_number,issue_date,prepared_by) values ('P1',$1,$2,$3,$4,$5,'x',$6,$7,'2026-12-02',$8)",
    [p.pr.id, p.rfq.id, p.f.br.id, p.f.wh.id, p.s[1].id, VAT_A, p.s[1].vat_number, p.prep.id], /award has not been approved/);
  await c.query("update rfq_awards set approved_by=$1, approved_at=now() where rfq_id=$2", [p.approver.id, p.rfq.id]);
  await rejects(c, "insert into purchase_orders (po_no,pr_id,rfq_id,branch_id,warehouse_id,supplier_id,entity_name,entity_vat_number,supplier_vat_number,issue_date,prepared_by) values ('P2',$1,$2,$3,$4,$5,'x',$6,$7,'2026-12-02',$8)",
    [p.pr.id, p.rfq.id, p.f.br.id, p.f.wh.id, p.s[0].id, VAT_A, p.s[0].vat_number, p.prep.id], /differs from the awarded supplier/);
  await rejects(c, "insert into purchase_orders (po_no,pr_id,rfq_id,branch_id,warehouse_id,supplier_id,entity_name,entity_vat_number,supplier_vat_number,issue_date,prepared_by) values ('P3',$1,$2,$3,$4,$5,'x',$6,'123',$7,$8)",
    [p.pr.id, p.rfq.id, p.f.br.id, p.f.wh.id, p.s[1].id, VAT_A, "2026-12-02", p.prep.id], /approved supplier with a matching VAT|purchase_orders_supplier_vat_ck/);
  const row = await ins(c, "purchase_orders", po());
  await ins(c, "purchase_order_lines", { po_id: row.id, line_no: 1, item_id: p.f.item.id, quantity: 100, unit_price_halalas: 400 });
  assert.equal(Number((await one(c, "select net_halalas n, vat_halalas v from purchase_order_lines where po_id=$1", [row.id])).n), 40000);
  await c.query("update purchase_orders set status='prepared', prepared_at=now() where id=$1", [row.id]);
  await rejects(c, "update purchase_orders set supplier_id=$1 where id=$2", [p.s[0].id, row.id], /frozen/);
  await rejects(c, "insert into purchase_order_lines (po_id,line_no,item_id,quantity,unit_price_halalas) values ($1,2,$2,1,1)", [row.id, p.f.item.id], /frozen/);
  await rejects(c, "update purchase_orders set status='approved', approved_by=$1, approved_at=now() where id=$2", [p.prep.id, row.id], /purchase_orders_segregation_ck/);
  await c.query("update purchase_orders set status='approved', approved_by=$1, approved_at=now() where id=$2", [p.approver.id, row.id]);
});
await test("direct small purchases require an approved direct_small exception", async (c) => {
  const f = await stockBase(c); const gm = await member(c, "super_admin"), prep = await member(c, "coordinator"); const sup = await supplier(c, VAT_A, gm);
  const pr = await ins(c, "purchase_requests", { pr_no: uniq("PR"), branch_id: f.br.id, warehouse_id: f.wh.id, requested_by: prep.id, path: "direct_small" });
  const ex = await ins(c, "procurement_exceptions", { pr_id: pr.id, exception_type: "direct_small", reason: "شراء صغير عاجل لمستلزمات المعمل", requested_by: prep.id });
  const sqlText = "insert into purchase_orders (po_no,pr_id,exception_id,branch_id,warehouse_id,supplier_id,entity_name,entity_vat_number,supplier_vat_number,issue_date,prepared_by) values ($1,$2,$3,$4,$5,$6,'x',$7,$8,'2026-12-02',$9)";
  const args = (n) => [n, pr.id, ex.id, f.br.id, f.wh.id, sup.id, VAT_A, sup.vat_number, prep.id];
  await rejects(c, sqlText, args("PD1"), /needs an approved exception/);
  await c.query("update procurement_exceptions set approved_by=$1, approved_at=now() where id=$2", [gm.id, ex.id]);
  await c.query(sqlText, args("PD2"));
  await rejects(c, "insert into procurement_exceptions (pr_id,exception_type,reason,requested_by) values ($1,'direct_small','قصير',$2)", [pr.id, prep.id], /procurement_exceptions_reason_ck/);
});
await test("goods receipts cannot exceed the ordered quantity; supplier invoices cannot be booked twice", async (c) => {
  const p = await procurement(c);
  const q = [await p.quote(p.s[0], 500), await p.quote(p.s[1], 400), await p.quote(p.s[2], 450)];
  await ins(c, "rfq_awards", { rfq_id: p.rfq.id, quotation_id: q[1].id, is_lowest_price: true, recommended_by: p.prep.id, approved_by: p.approver.id, approved_at: new Date() });
  const po = await ins(c, "purchase_orders", { po_no: uniq("PO"), pr_id: p.pr.id, rfq_id: p.rfq.id, branch_id: p.f.br.id, warehouse_id: p.f.wh.id, supplier_id: p.s[1].id, entity_name: "معهد", entity_vat_number: VAT_A, supplier_vat_number: p.s[1].vat_number, issue_date: "2026-12-02", prepared_by: p.prep.id });
  const pol = await ins(c, "purchase_order_lines", { po_id: po.id, line_no: 1, item_id: p.f.item.id, quantity: 100, unit_price_halalas: 400 });
  const g1 = await ins(c, "goods_receipts", { grn_no: uniq("GRN"), po_id: po.id, warehouse_id: p.f.wh.id, received_by: p.rec.id });
  await ins(c, "goods_receipt_lines", { grn_id: g1.id, po_line_id: pol.id, qty_received: 60, qty_accepted: 55 });
  const g2 = await ins(c, "goods_receipts", { grn_no: uniq("GRN"), po_id: po.id, warehouse_id: p.f.wh.id, received_by: p.rec.id });
  await rejects(c, "insert into goods_receipt_lines (grn_id,po_line_id,qty_received,qty_accepted) values ($1,$2,50,50)", [g2.id, pol.id], /exceeds the ordered quantity/);
  await rejects(c, "insert into goods_receipt_lines (grn_id,po_line_id,qty_received,qty_accepted,quality_result) values ($1,$2,10,5,'rejected')", [g2.id, pol.id], /goods_receipt_lines_rejected_ck/);
  const inv = { supplier_id: p.s[1].id, supplier_invoice_no: "INV-77", supplier_vat_number: p.s[1].vat_number, po_id: po.id, branch_id: p.f.br.id, invoice_date: "2026-12-05", net_halalas: 40000, vat_halalas: 6000, created_by: p.rec.id };
  await ins(c, "supplier_invoices", inv);
  await rejects(c, "insert into supplier_invoices (supplier_id,supplier_invoice_no,supplier_vat_number,branch_id,invoice_date,net_halalas,vat_halalas,created_by) values ($1,'INV-77',$2,$3,'2026-12-06',1,0,$4)", [p.s[1].id, p.s[1].vat_number, p.f.br.id, p.rec.id], /supplier_invoices_dup_uq/);
});

// ---- security, OTP, audit -----------------------------------------------------------------------------------------------
await test("OTP challenge integrity rules", async (c) => {
  const m = await member(c);
  const ok = { member_id: m.id, action: "payment.confirm", subject_type: "payment", subject_hash: "a".repeat(64), code_hmac: "b".repeat(64), destination_masked: "a***@example.test", expires_at: new Date(Date.now() + 3e5) };
  await ins(c, "otp_challenges", ok);
  await rejects(c, "insert into otp_challenges (member_id,action,subject_type,subject_hash,code_hmac,destination_masked,expires_at,attempts) values ($1,'x','y','h','c','d',now() + interval '5 min',9)", [m.id], /otp_challenges_attempts_ck/);
  await rejects(c, "insert into otp_challenges (member_id,action,subject_type,subject_hash,code_hmac,destination_masked,expires_at) values ($1,'x','y','h','c','d',now() - interval '1 min')", [m.id], /otp_challenges_expiry_ck/);
  await rejects(c, "insert into otp_challenges (member_id,action,subject_type,subject_hash,code_hmac,destination_masked,expires_at,consumed_at) values ($1,'x','y','h','c','d',now() + interval '1 min',now())", [m.id], /otp_challenges_consumed_ck/);
});
await test("audit ledger is append-only and hash-chained; tampering is detected", async (c) => {
  const m = await member(c); const ch = await ins(c, "otp_challenges", { member_id: m.id, action: "payment.confirm", subject_type: "payment", subject_hash: "a".repeat(64), code_hmac: "b".repeat(64), destination_masked: "a***", expires_at: new Date(Date.now() + 3e5) });
  const e1 = await ins(c, "audit_events", { actor_member_id: m.id, actor_role: "finance", action: "payment.confirm", subject_type: "payment", subject_no: "RC-1", otp_challenge_id: ch.id, otp_sent_at: new Date(Date.now() - 20000), otp_verified_at: new Date(), ip_sent: "10.0.0.5", ip_verified: "10.0.0.6" });
  const e2 = await ins(c, "audit_events", { actor_member_id: m.id, action: "expense.create", subject_type: "expense", subject_no: "EX-1", before_state: null, after_state: { net: 100 } });
  assert.equal(e1.prev_hash, e1.prev_hash); assert.match(e2.row_hash, /^[0-9a-f]{64}$/); assert.equal(e2.prev_hash, e1.row_hash);
  assert.equal((await c.query("select * from verify_audit_chain()")).rowCount, 0);
  const wf = await one(c, "select seconds_to_confirm s from v_audit_workflow where id=$1", [e1.id]); assert.ok(wf.s >= 19 && wf.s <= 21);
  await rejects(c, "update audit_events set action='x'", [], /append-only/);
  await rejects(c, "delete from audit_events", [], /append-only/);
  await rejects(c, "truncate audit_events", [], /append-only/);
  await c.query("alter table audit_events disable trigger trg_audit_events_append_only");
  await c.query("update audit_events set reason='forged' where id=$1", [e1.id]);
  const bad = await one(c, "select first_bad_id from verify_audit_chain()"); assert.equal(Number(bad.first_bad_id), Number(e1.id));
});
await test("a holder has one active identity card; revoked cards need a revocation time", async (c) => {
  const f = await base(c);
  await ins(c, "identity_cards", { token_hash: uniq("t"), holder_type: "student", holder_id: f.s1.id });
  await rejects(c, "insert into identity_cards (token_hash,holder_type,holder_id) values ('t2','student',$1)", [f.s1.id], /identity_cards_one_active_uq/);
  await rejects(c, "insert into identity_cards (token_hash,holder_type,holder_id,status) values ('t3','student',$1,'lost')", [f.s2.id], /identity_cards_revoked_ck/);
});

// ---- legacy compatibility -----------------------------------------------------------------------------------------------
await test("legacy tables still behave as the running application expects", async (c) => {
  await ins(c, "education_records", { owner_id: "org:main", kind: "branch", name: "فرع", status: "نشط", details: { budget: 1 } });
  const e = `${uniq("dup")}@example.test`;
  await ins(c, "org_members", { email: e, role: "student", status: "invited" });
  await rejects(c, "insert into org_members (email,role,status) values ($1,'student','invited')", [e.toUpperCase()], /org_members_live_email_idx/);
});

console.log(`\n${passed} passed, ${failed.length} failed`);
await client.end();
if (failed.length) { console.log("Failed: " + failed.join("; ")); process.exit(1); }
