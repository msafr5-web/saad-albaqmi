import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, branches, itemCategories, orgMembers, units, warehouses, items, pool } from "@workspace/db";
import { addQuotation, approveAward, approvePurchaseOrder, approveSupplier, createPurchaseRequest, createRfq, createSupplier, getComparison, preparePurchaseOrder, recommendAward } from "../src/lib/procurement";
import { approveSupplierInvoice, createSupplierInvoice, orderDetail, paySupplierInvoice, receiveGoods, renderPoHtml, sendPurchaseOrder } from "../src/lib/procurement-fulfilment";
import { postMovement, setStockLevel } from "../src/lib/inventory";
import { DomainError } from "../src/lib/education-validation";
import type { Member } from "../src/lib/education-access";

/** Integration test: send, receive (quality + stock), invoice with three-way match, approval, expense, payment. ALLOW_DB_TESTS=1 only. */
if (process.env.ALLOW_DB_TESTS !== "1") { console.log("skipped: set ALLOW_DB_TESTS=1 (scratch/CI database only)"); process.exit(0); }
delete process.env.OTP_FINANCE_REQUIRED;
process.env.RESEND_API_KEY = "test"; process.env.RESEND_FROM_EMAIL = "test@example.test";
const sentMail: { to: string; html: string; subject: string }[] = [];
globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => { const b = JSON.parse(init!.body!); sentMail.push({ to: b.to[0], html: b.html, subject: b.subject }); return new Response("{}", { status: 200 }); }) as typeof fetch;

const stamp = Date.now();
const fails = async (p: Promise<unknown>, status: number, label: string) => {
  try { await p; } catch (e) { assert.ok(e instanceof DomainError, `${label}: not a DomainError (${(e as Error).message})`); assert.equal(e.status, status, `${label}: expected ${status}, got ${e.status} (${e.message})`); return e as DomainError; }
  assert.fail(`${label}: expected failure ${status}`);
};
const mk = async (n: string, role: string, branchId: number | null): Promise<Member> => {
  const [r] = await db.insert(orgMembers).values({ email: `fu-${n}-${stamp}@example.test`, role, status: "active", branchId, clerkUserId: `u_${n}_${stamp}` }).returning();
  return { id: r!.id, clerkUserId: r!.clerkUserId!, email: r!.email, role: role as Member["role"], branchId, linkedRecordId: null };
};
const vatOf = (n: number) => `3${String(stamp).slice(-11)}${String(n).padStart(2, "0")}3`;

async function main() {
  const [br] = await db.insert(branches).values({ code: `FU${stamp}`, name: "فرع التنفيذ", city: "الرياض", vatNumber: "300000000000003" }).returning();
  const [wh] = await db.insert(warehouses).values({ branchId: br!.id, code: `FW${stamp}`, name: "مستودع" }).returning();
  const [cat] = await db.select().from(itemCategories).where(eq(itemCategories.code, "STAT")); const [unit] = await db.select().from(units).limit(1);
  const [paper] = await db.insert(items).values({ itemCode: `F-P-${stamp}`, name: "ورق", categoryId: cat!.id, unitId: unit!.id }).returning();
  const keeper = await mk("keeper", "warehouse_keeper", br!.id), buyer = await mk("buyer", "procurement_officer", null), mgr = await mk("mgr", "branch_manager", br!.id), mgrB = await mk("mgrB", "branch_manager", null);
  const fin1 = await mk("fin1", "finance", null), fin2 = await mk("fin2", "finance", null), gm = await mk("gm", "super_admin", null);
  void mgrB;

  // approved order (same cycle as procurement.check, condensed)
  await postMovement(keeper, { warehouseId: wh!.id, itemId: paper!.id, type: "opening", qty: 2 }, {}); await setStockLevel(mgr, { warehouseId: wh!.id, itemId: paper!.id, minQty: 5 });
  const sups = [];
  for (let n = 1; n <= 3; n++) { const s = await createSupplier(buyer, { legalName: `مورد ${n} ${stamp}`, vatNumber: vatOf(n), email: `s${n}-${stamp}@example.test` }); await approveSupplier(mgr, s.id); sups.push(s); }
  const pr = await createPurchaseRequest(keeper, { warehouseId: wh!.id, lines: [{ itemId: paper!.id, qty: 100 }] });
  const rfq = await createRfq(buyer, pr.id, { supplierIds: sups.map((s) => s.id), deadlineAt: new Date(Date.now() + 864e5).toISOString() });
  for (const [i, s] of sups.entries()) await addQuotation(buyer, rfq.id, { supplierId: s.id, quoteDate: "2026-12-01", lines: [{ itemId: paper!.id, unitPriceHalalas: 400 + i * 50 }] });
  await recommendAward(buyer, rfq.id, { quotationId: (await getComparison(buyer, rfq.id)).quotations[0]!.quotation_id });
  await approveAward(mgr, rfq.id, {});
  const po = await preparePurchaseOrder(buyer, rfq.id, { deliveryDate: "2026-12-20" }, {});
  await approvePurchaseOrder(mgr, po.id, {});

  // print view: legal fields present, no IP/device data
  const html = await renderPoHtml(buyer, po.id);
  assert.ok(html.includes(po.poNo) && html.includes(po.supplierVatNumber) && html.includes("300000000000003") && html.includes("460.00"), "printable order has number, both VAT numbers and totals");
  assert.ok(!/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(html.replace(/\d+\.\d\d/g, "")), "no IP address on the printable order");

  // sending: buyers only, needs the supplier's email, goes out through the mail provider
  await fails(sendPurchaseOrder(keeper, po.id, {}), 403, "keeper cannot send");
  const sent = await sendPurchaseOrder(buyer, po.id, {});
  assert.equal(sent.status, "sent"); assert.equal(sentMail.at(-1)!.to, `s1-${stamp}@example.test`); assert.ok(sentMail.at(-1)!.subject.includes(po.poNo));
  await fails(sendPurchaseOrder(buyer, po.id, {}), 409, "cannot send twice");

  // goods receipt: quality check, partial acceptance, stock posting, over-receipt refused
  const line = (await orderDetail(buyer, po.id)).lines[0] as { id: number; qty: number };
  await fails(receiveGoods(buyer, po.id, { lines: [{ poLineId: line.id, qtyReceived: 10, qtyAccepted: 10 }] }, {}), 403, "buyer does not receive goods");
  await fails(receiveGoods(keeper, po.id, { lines: [{ poLineId: line.id, qtyReceived: 10, qtyAccepted: 10, qualityResult: "accepted_with_notes" }] }, {}), 400, "quality notes required");
  const g1 = await receiveGoods(keeper, po.id, { deliveryNoteNo: "DN-1", lines: [{ poLineId: line.id, qtyReceived: 60, qtyAccepted: 55, qualityResult: "accepted_with_notes", qualityNotes: "5 رزم تالفة" }] }, {});
  assert.equal(g1.poStatus, "partially_received"); assert.match(g1.receipt.grnNo, /^GRN-\d{4}-\d{6}$/);
  assert.equal(Number((await pool.query("select qty_on_hand q from v_stock_balances where warehouse_id=$1 and item_id=$2", [wh!.id, paper!.id])).rows[0].q), 2 + 55, "only the accepted quantity enters stock");
  await fails(receiveGoods(keeper, po.id, { lines: [{ poLineId: line.id, qtyReceived: 50, qtyAccepted: 50 }] }, {}), 409, "over-receipt");
  assert.equal((await pool.query("select status from reorder_alerts where warehouse_id=$1 and item_id=$2 order by id desc limit 1", [wh!.id, paper!.id])).rows[0].status, "closed", "alert closed when stock recovered");

  // three-way match: billing more than received or above the order price is a mismatch
  const inv = (no: string, qty: number, price: number) => createSupplierInvoice(fin1, po.id, { supplierInvoiceNo: no, invoiceDate: "2026-12-10", lines: [{ poLineId: line.id, quantity: qty, unitPriceHalalas: price }] });
  await fails(createSupplierInvoice(keeper, po.id, { supplierInvoiceNo: "X", invoiceDate: "2026-12-10", lines: [] }), 403, "keeper cannot book invoices");
  const bad = await inv("INV-BAD", 55, 450);
  assert.equal(bad.status, "mismatch"); assert.ok(JSON.stringify(bad.matchResult).includes("أعلى من سعر الأمر"));
  const tooMany = await inv("INV-QTY", 60, 400); assert.equal(tooMany.status, "mismatch");
  await fails(inv("INV-BAD", 1, 400), 409, "same supplier invoice number twice");
  const ok = await inv("INV-OK", 50, 400);
  assert.equal(ok.status, "matched"); assert.deepEqual([Number(ok.netHalalas), Number(ok.vatHalalas), Number(ok.grossHalalas)], [20000, 3000, 23000]);

  // approval: not by the creator; variances need the branch manager and a written reason; approval books the expense once
  await fails(approveSupplierInvoice(fin1, ok.id, {}, {}), 403, "creator cannot approve");
  await fails(approveSupplierInvoice(fin2, bad.id, {}, {}), 403, "variance needs the branch manager");
  await fails(approveSupplierInvoice(mgr, bad.id, { reason: "قصير" }, {}), 400, "variance needs a real reason");
  const approvedBad = await approveSupplierInvoice(mgr, bad.id, { reason: "اتفاق مع المورد على فرق السعر بسبب ارتفاع المواد" }, {});
  assert.equal(approvedBad.status, "approved");
  const approved = await approveSupplierInvoice(fin2, ok.id, {}, {});
  assert.equal(approved.status, "approved");
  const exp = (await pool.query("select net_halalas::int n, vat_halalas::int v, status, source, branch_id::int b from expenses where supplier_invoice_id=$1", [ok.id])).rows;
  assert.deepEqual([exp.length, exp[0].n, exp[0].v, exp[0].status, exp[0].source, exp[0].b], [1, 20000, 3000, "confirmed", "supplier_invoice", br!.id]);
  await fails(approveSupplierInvoice(fin2, ok.id, {}, {}), 409, "cannot approve twice");

  // payment: finance only, not by the approver, never above the balance; full payment closes the invoice
  await fails(paySupplierInvoice(keeper, ok.id, { amountHalalas: 23000, method: "bank_transfer" }, {}), 403, "keeper cannot pay");
  await fails(paySupplierInvoice(fin2, ok.id, { amountHalalas: 23000, method: "bank_transfer" }, {}), 403, "approver cannot pay");
  await fails(paySupplierInvoice(gm, ok.id, { amountHalalas: 99999, method: "bank_transfer" }, {}), 409, "above the balance");
  const p1 = await paySupplierInvoice(gm, ok.id, { amountHalalas: 10000, method: "bank_transfer", reference: "TRX-1" }, {}); assert.equal(p1.fullyPaid, false);
  const p2 = await paySupplierInvoice(gm, ok.id, { amountHalalas: 13000, method: "bank_transfer" }, {}); assert.equal(p2.fullyPaid, true);
  assert.equal((await pool.query("select status from supplier_invoices where id=$1", [ok.id])).rows[0].status, "paid");

  // the expense reaches the budget view (actual spending of the month)
  await pool.query("insert into branch_budgets (branch_id, period_month, amount_halalas) values ($1, date_trunc('month', '2026-12-10'::date), 1000000)", [br!.id]);
  const bud = (await pool.query("select actual_halalas::int a, budget_halalas::int b from v_branch_budget_status where branch_id=$1 and category_id is null", [br!.id])).rows[0];
  assert.ok(bud.a >= 20000 + Math.round(0) && bud.b === 1000000, "budget view counts the confirmed expenses");
  assert.equal((await pool.query("select * from verify_audit_chain()")).rowCount, 0);

  // a second order remains fully receivable until the quantity is complete
  const g2 = await receiveGoods(keeper, po.id, { lines: [{ poLineId: line.id, qtyReceived: 45, qtyAccepted: 45 }] }, {});
  assert.equal(g2.poStatus, "received");
  console.log("fulfilment.check passed");
}
main().then(() => pool.end(), (e) => { console.error(e); pool.end().finally(() => process.exit(1)); });
