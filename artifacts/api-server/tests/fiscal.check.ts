import assert from "node:assert/strict";
import { db, branches, orgMembers, pool } from "@workspace/db";
import { budgetStatus, createSalesInvoice, issueSalesInvoice, setBudget, vatReport, weeklyExpenses } from "../src/lib/fiscal";
import { DomainError } from "../src/lib/education-validation";
import type { Member } from "../src/lib/education-access";

/** Budgets, alerts, weekly expenses, sales invoices and the VAT report on a MIGRATED scratch/CI database (ALLOW_DB_TESTS=1). */
if (process.env.ALLOW_DB_TESTS !== "1") { console.log("skipped: set ALLOW_DB_TESTS=1 (scratch/CI database only)"); process.exit(0); }
delete process.env.OTP_FINANCE_REQUIRED;
const stamp = Date.now();
const fails = async (p: Promise<unknown>, status: number, label: string) => {
  try { await p; } catch (e) { assert.ok(e instanceof DomainError, `${label}: not a DomainError (${(e as Error).message})`); assert.equal(e.status, status, `${label}: expected ${status}, got ${e.status} (${e.message})`); return e as DomainError; }
  assert.fail(`${label}: expected failure ${status}`);
};
const mk = async (n: string, role: string, branchId: number | null): Promise<Member> => {
  const [r] = await db.insert(orgMembers).values({ email: `fi-${n}-${stamp}@example.test`, role, status: "active", branchId, clerkUserId: `u_${n}_${stamp}` }).returning();
  return { id: r!.id, clerkUserId: r!.clerkUserId!, email: r!.email, role: role as Member["role"], branchId, linkedRecordId: null };
};
const notes = async (m: Member, type: string) => Number((await pool.query("select count(*)::int n from notifications where member_id=$1 and subject_type=$2", [m.id, type])).rows[0].n);

async function main() {
  const [brA] = await db.insert(branches).values({ code: `FA${stamp}`, name: "فرع أ", city: "الرياض" }).returning();
  const [brB] = await db.insert(branches).values({ code: `FB${stamp}`, name: "فرع ب", city: "جدة" }).returning();
  const fin = await mk("fin", "finance", null), finA = await mk("finA", "finance", brA!.id), gm = await mk("gm", "super_admin", null), mgrA = await mk("mgrA", "branch_manager", brA!.id), mgrB = await mk("mgrB", "branch_manager", brB!.id), coord = await mk("coord", "coordinator", brA!.id);
  const cat = (await pool.query("select id::int from expense_categories where code='PAPER'")).rows[0].id as number;
  const expense = (net: number, vat: number, date: string, branchId = brA!.id) => pool.query("insert into expenses (expense_no,branch_id,category_id,expense_date,description,net_halalas,vat_halalas,status,confirmed_at,created_by) values ($1,$2,$3,$4,'x',$5,$6,'confirmed',now(),$7)", [`EX-${Math.random()}`, branchId, cat, date, net, vat, gm.id]);

  // budgets: finance/GM set them; format and role checks; setting twice updates the same row
  await fails(setBudget(coord, { branchId: brA!.id, month: "2026-12", amountHalalas: 1 }), 403, "coordinator cannot set budgets");
  await fails(setBudget(fin, { branchId: brA!.id, month: "2026-13", amountHalalas: 1 }), 400, "bad month");
  await fails(setBudget(fin, { branchId: brA!.id, month: "2026-12", amountHalalas: 1, warnAtPercent: 0 }), 400, "bad warning percent");
  const b1 = await setBudget(fin, { branchId: brA!.id, month: "2026-12", amountHalalas: 100000, warnAtPercent: 80 });
  const b2 = await setBudget(fin, { branchId: brA!.id, month: "2026-12", amountHalalas: 120000, warnAtPercent: 80 });
  assert.equal(b1.id, b2.id, "one budget per branch and month"); assert.equal(Number(b2.amountHalalas), 120000);
  let st = (await budgetStatus(fin, "2026-12")).find((r) => r.branch_id === brA!.id)!; assert.deepEqual([st.budget_halalas, st.actual_halalas, st.level], [120000, 0, "ok"]);

  // alerts: crossing the warning threshold notifies once; crossing 100% notifies once more
  await expense(100000, 15000, "2026-12-03");                         // 100000 of 120000 = 83% -> warn
  await setBudget(fin, { branchId: brA!.id, month: "2026-12", amountHalalas: 120000 });
  for (const who of [fin, gm, mgrA]) assert.equal(await notes(who, "budget_warn"), 1, "warning sent to finance, GM and the branch manager");
  assert.equal(await notes(mgrB, "budget_warn"), 0, "other branch manager is not notified");
  await setBudget(fin, { branchId: brA!.id, month: "2026-12", amountHalalas: 120000 }); assert.equal(await notes(fin, "budget_warn"), 1, "no duplicate warning");
  await expense(30000, 4500, "2026-12-04");                           // 130000 > 120000 -> over
  await setBudget(fin, { branchId: brA!.id, month: "2026-12", amountHalalas: 120000 });
  assert.equal(await notes(fin, "budget_over"), 1); assert.equal(await notes(mgrA, "budget_over"), 1);
  st = (await budgetStatus(mgrA, "2026-12")).find((r) => r.branch_id === brA!.id)!; assert.deepEqual([st.actual_halalas, st.available_halalas, st.level], [130000, -10000, "over"]);
  assert.equal((await budgetStatus(mgrB, "2026-12")).filter((r) => r.branch_id === brA!.id).length, 0, "other branch cannot see it");
  await fails(budgetStatus(coord, "2026-12"), 403, "coordinator cannot read budgets");

  // weekly expenses: grouped by ISO week and category, scoped by branch
  await expense(5000, 750, "2026-12-10");
  const wk = await weeklyExpenses(fin, { branchId: brA!.id, from: "2026-12-01", to: "2026-12-31" }) as { week_start: string; net_halalas: number; category: string; is_petty: boolean }[];
  assert.ok(wk.length >= 2 && wk.every((w) => /^\d{4}-\d{2}-\d{2}$/.test(w.week_start))); assert.equal(wk.reduce((a, w) => a + w.net_halalas, 0), 135000); assert.ok(wk.every((w) => w.is_petty));
  await fails(weeklyExpenses(mgrB, { branchId: brA!.id, from: "2026-12-01", to: "2026-12-31" }), 403, "other branch");
  await fails(weeklyExpenses(fin, { from: "bad", to: "2026-12-31" }), 400, "bad date");

  // sales invoices: exclusive vs inclusive pricing give the same legal breakdown; standard invoices need the buyer's VAT number
  const base = { branchId: brA!.id, customerName: "شركة التقنية", issueDate: "2026-12-05" };
  const ex = await createSalesInvoice(fin, { ...base, lines: [{ description: "رسوم دبلوم", quantity: 2, unitPriceHalalas: 10000 }] });
  assert.deepEqual([Number(ex.netHalalas), Number(ex.vatHalalas), Number(ex.grossHalalas)], [20000, 3000, 23000]);
  const inc = await createSalesInvoice(fin, { ...base, pricesIncludeVat: true, lines: [{ description: "رسوم دبلوم", quantity: 1, unitPriceHalalas: 11500 }] });
  assert.deepEqual([Number(inc.netHalalas), Number(inc.vatHalalas), Number(inc.grossHalalas)], [10000, 1500, 11500]);
  await fails(createSalesInvoice(coord, { ...base, lines: [{ description: "x", quantity: 1, unitPriceHalalas: 1 }] }), 403, "coordinator cannot invoice");
  await fails(createSalesInvoice(fin, { ...base, invoiceType: "standard", lines: [{ description: "x", quantity: 1, unitPriceHalalas: 100 }] }), 409, "standard needs buyer VAT");
  await fails(createSalesInvoice(fin, { ...base, customerVatNumber: "123", lines: [{ description: "x", quantity: 1, unitPriceHalalas: 100 }] }), 409, "bad buyer VAT");
  await fails(createSalesInvoice(fin, { ...base, lines: [] }), 400, "no lines");
  const std = await createSalesInvoice(fin, { ...base, invoiceType: "standard", customerVatNumber: "300000000000003", lines: [{ description: "رسوم", quantity: 1, unitPriceHalalas: 50000 }] });
  assert.equal(Number(std.vatHalalas), 7500);
  assert.match(ex.invoiceNo, /^INV-\d{4}-\d{6}$/);
  for (const i of [ex, inc, std]) await issueSalesInvoice(fin, i.id, {});
  await fails(issueSalesInvoice(fin, ex.id, {}), 409, "cannot issue twice");

  // VAT report: output VAT from issued sales, input VAT from approved supplier invoices, net position
  const sup = (await pool.query("insert into suppliers (supplier_no,legal_name,vat_number,status,approved_by) values ($1,'مورد','3' || lpad($2::text, 13, '0') || '3','approved',$3) returning id::int", [`S-${stamp}`, String(stamp).slice(-12), gm.id])).rows[0].id;
  await pool.query("insert into supplier_invoices (supplier_id,supplier_invoice_no,supplier_vat_number,branch_id,invoice_date,net_halalas,vat_halalas,status,approved_by,created_by) values ($1,'V-1',(select vat_number from suppliers where id=$1),$2,'2026-12-06',40000,6000,'approved',$3,$3)", [sup, brA!.id, gm.id]);
  const rep = await vatReport(finA, { from: "2026-12", to: "2026-12" });   // finance scoped to this branch: other suites share the database
  assert.equal(rep.totals.outputVat, 3000 + 1500 + 7500); assert.equal(rep.totals.inputVat, 6000); assert.equal(rep.totals.netVatPayable, 12000 - 6000);
  assert.equal(rep.mode, "display_only");
  assert.equal((await vatReport(mgrB, { from: "2026-12", to: "2026-12" })).sales.length, 0, "other branch sees none");
  assert.equal((await pool.query("select * from verify_audit_chain()")).rowCount, 0);
  console.log("fiscal.check passed");
}
main().then(() => pool.end(), (e) => { console.error(e); pool.end().finally(() => process.exit(1)); });
