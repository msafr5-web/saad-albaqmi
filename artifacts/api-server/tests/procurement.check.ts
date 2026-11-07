import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, branches, itemCategories, orgMembers, units, warehouses, items, notifications, pool } from "@workspace/db";
import { addQuotation, approveAward, approvePurchaseOrder, approveSupplier, createPurchaseRequest, createRfq, createSupplier, evaluateQuotation, getComparison, listPurchaseOrders, listPurchaseRequests, preparePurchaseOrder, recommendAward } from "../src/lib/procurement";
import { postMovement, setStockLevel } from "../src/lib/inventory";
import { DomainError } from "../src/lib/education-validation";
import type { Member } from "../src/lib/education-access";

/** Integration test for the procurement cycle on a MIGRATED scratch/CI database (ALLOW_DB_TESTS=1). */
if (process.env.ALLOW_DB_TESTS !== "1") { console.log("skipped: set ALLOW_DB_TESTS=1 (scratch/CI database only)"); process.exit(0); }
delete process.env.OTP_FINANCE_REQUIRED;

const stamp = Date.now();
const fails = async (p: Promise<unknown>, status: number, label: string) => {
  try { await p; } catch (e) { assert.ok(e instanceof DomainError, `${label}: not a DomainError (${(e as Error).message})`); assert.equal(e.status, status, `${label}: expected ${status}, got ${e.status} (${e.message})`); return e as DomainError; }
  assert.fail(`${label}: expected failure ${status}`);
};
const mk = async (n: string, role: string, branchId: number | null): Promise<Member> => {
  const [r] = await db.insert(orgMembers).values({ email: `po-${n}-${stamp}@example.test`, role, status: "active", branchId, clerkUserId: `u_${n}_${stamp}` }).returning();
  return { id: r!.id, clerkUserId: r!.clerkUserId!, email: r!.email, role: role as Member["role"], branchId, linkedRecordId: null };
};
const vatOf = (n: number) => `3${String(stamp).slice(-11)}${String(n).padStart(2, "0")}3`;   // 15 digits, starts and ends with 3

async function main() {
  const [brA] = await db.insert(branches).values({ code: `PA${stamp}`, name: "فرع أ", city: "الرياض", vatNumber: "300000000000003" }).returning();
  const [brB] = await db.insert(branches).values({ code: `PB${stamp}`, name: "فرع ب", city: "جدة" }).returning();
  const [whA] = await db.insert(warehouses).values({ branchId: brA!.id, code: `PW${stamp}`, name: "مستودع أ" }).returning();
  const [cat] = await db.select().from(itemCategories).where(eq(itemCategories.code, "STAT")); const [unit] = await db.select().from(units).limit(1);
  const mkItem = async (n: string) => (await db.insert(items).values({ itemCode: `T-${n}-${stamp}`, name: n, categoryId: cat!.id, unitId: unit!.id }).returning())[0]!;
  const paper = await mkItem("ورق"), pens = await mkItem("أقلام");

  const keeper = await mk("keeper", "warehouse_keeper", brA!.id), buyer = await mk("buyer", "procurement_officer", null), deputy = await mk("deputy", "procurement_officer", null);
  const mgr = await mk("mgr", "branch_manager", brA!.id), mgrB = await mk("mgrB", "branch_manager", brB!.id), hr = await mk("hr", "coordinator", null), gm = await mk("gm", "super_admin", null), coord = await mk("coord", "coordinator", brA!.id);

  // stock: paper is below its minimum (alert), pens are well stocked
  await postMovement(keeper, { warehouseId: whA!.id, itemId: paper.id, type: "opening", qty: 3 }, {});
  await setStockLevel(mgr, { warehouseId: whA!.id, itemId: paper.id, minQty: 5 });
  await postMovement(keeper, { warehouseId: whA!.id, itemId: pens.id, type: "opening", qty: 50 }, {});
  await setStockLevel(mgr, { warehouseId: whA!.id, itemId: pens.id, minQty: 5 });
  const alert = (await pool.query("select id::int from reorder_alerts where warehouse_id=$1 and item_id=$2 and status='open'", [whA!.id, paper.id])).rows[0];
  assert.ok(alert, "alert opened for the item below its minimum");

  // suppliers: format, roles, approval, duplicates
  await fails(createSupplier(buyer, { legalName: "س", vatNumber: "12345" }), 400, "bad VAT");
  await fails(createSupplier(coord, { legalName: "س", vatNumber: "300000000000003" }), 403, "coordinator cannot add suppliers");
  const sups = [];
  for (let n = 1; n <= 4; n++) sups.push(await createSupplier(buyer, { legalName: `مورد ${n} ${stamp}`, vatNumber: vatOf(n) }));
  assert.equal(sups[0]!.status, "pending");
  await fails(createSupplier(buyer, { legalName: "مكرر", vatNumber: sups[0]!.vatNumber }), 409, "duplicate VAT");
  await fails(approveSupplier(buyer, sups[0]!.id), 403, "buyer cannot approve suppliers");
  for (const s of sups.slice(0, 3)) await approveSupplier(mgr, s.id);          // supplier 4 stays pending

  // purchase request: refuses stocked items, links the alert
  await fails(createPurchaseRequest(keeper, { warehouseId: whA!.id, lines: [{ itemId: pens.id, qty: 10 }] }), 409, "well-stocked item");
  await fails(createPurchaseRequest(coord, { warehouseId: whA!.id, lines: [{ itemId: paper.id, qty: 10 }] }), 403, "coordinator cannot request");
  await fails(createPurchaseRequest(keeper, { warehouseId: whA!.id, lines: [] }), 400, "empty request");
  const pr = await createPurchaseRequest(keeper, { warehouseId: whA!.id, alertId: alert.id, reason: "نفد الورق", lines: [{ itemId: paper.id, qty: 100 }] });
  assert.match(pr.prNo, /^PR-\d{4}-\d{6}$/);
  assert.equal((await pool.query("select status from reorder_alerts where id=$1", [alert.id])).rows[0].status, "in_progress");
  assert.ok((await listPurchaseRequests(buyer)).some((r) => (r as { id: number }).id === pr.id)); assert.ok(!(await listPurchaseRequests(mgrB)).some((r) => (r as { id: number }).id === pr.id), "other branch cannot see it");

  // RFQ: needs 3 approved suppliers, buyers only
  const deadline = new Date(Date.now() + 864e5).toISOString();
  await fails(createRfq(keeper, pr.id, { supplierIds: sups.slice(0, 3).map((s) => s.id), deadlineAt: deadline }), 403, "keeper cannot issue RFQs");
  await fails(createRfq(buyer, pr.id, { supplierIds: sups.slice(0, 2).map((s) => s.id), deadlineAt: deadline }), 400, "two suppliers");
  await fails(createRfq(buyer, pr.id, { supplierIds: sups.map((s) => s.id), deadlineAt: deadline }), 400, "unapproved supplier");
  const rfq = await createRfq(buyer, pr.id, { supplierIds: sups.slice(0, 3).map((s) => s.id), deadlineAt: deadline });
  assert.equal((await pool.query("select status from purchase_requests where id=$1", [pr.id])).rows[0].status, "rfq");

  // quotations: invited only, every line priced, award refused until three exist
  const quote = (supplier: { id: number }, price: number) => addQuotation(buyer, rfq.id, { supplierId: supplier.id, quoteDate: "2026-12-01", deliveryDays: 5, lines: [{ itemId: paper.id, unitPriceHalalas: price }] });
  await fails(quote(sups[3]!, 400), 409, "not invited");
  await fails(addQuotation(buyer, rfq.id, { supplierId: sups[0]!.id, quoteDate: "2026-12-01", lines: [] }), 400, "unpriced lines");
  const q1 = await quote(sups[0]!, 500), q2 = await quote(sups[1]!, 400);
  await fails(recommendAward(buyer, rfq.id, { quotationId: q2.id }), 409, "only two quotations");
  const q3 = await quote(sups[2]!, 450);
  await fails(quote(sups[2]!, 460), 409, "one quote per supplier");
  await evaluateQuotation(mgr, q2.id, { technicalScore: 80, qualityScore: 70, commercialScore: 90 });
  const cmp = await getComparison(buyer, rfq.id);
  assert.equal(cmp.quotations.length, 3); assert.equal(cmp.quotations.filter((q) => q.isLowest).length, 1); assert.equal(cmp.quotations[0]!.net_halalas, 40000);
  assert.deepEqual([cmp.quotations[0]!.technical, cmp.quotations[0]!.commercial], [80, 90]);

  // award: not the cheapest needs a written justification; approval by the branch manager only
  await fails(recommendAward(buyer, rfq.id, { quotationId: q3.id }), 409, "non-lowest without justification");
  await recommendAward(buyer, rfq.id, { quotationId: q2.id });                               // cheapest: no justification needed
  await fails(approveAward(buyer, rfq.id, {}), 403, "buyer cannot approve the award");
  await fails(approveAward(mgrB, rfq.id, {}), 404, "another branch manager");
  await fails(preparePurchaseOrder(buyer, rfq.id, {}, {}), 409, "no PO before the award is approved");
  await approveAward(mgr, rfq.id, {});
  await fails(approveAward(mgr, rfq.id, {}), 409, "award already approved");

  // purchase order: prepared by the buyer (frozen), approved by someone else
  const po = await preparePurchaseOrder(buyer, rfq.id, { deliveryDate: "2026-12-20", terms: "دفع 30 يومًا" }, {});
  assert.match(po.poNo, /^PO-\d{4}-\d{6}$/); assert.equal(po.status, "prepared");
  assert.deepEqual([Number(po.netHalalas), Number(po.vatHalalas), Number(po.grossHalalas)], [40000, 6000, 46000]);
  assert.equal(po.supplierVatNumber, sups[1]!.vatNumber); assert.equal(po.entityVatNumber, "300000000000003");
  await fails(preparePurchaseOrder(buyer, rfq.id, {}, {}), 409, "one PO per award");
  await fails(approvePurchaseOrder(buyer, po.id, {}), 403, "preparer cannot approve");
  await fails(approvePurchaseOrder(deputy, po.id, {}), 403, "no delegation yet");
  // a delegation outside today's window does not help; an approved one in the window does
  await pool.query("insert into approval_delegations (delegator_member_id, delegate_member_id, valid_from, valid_to, proposed_by, status, approved_by) values ($1,$2,'2020-01-01','2020-01-10',$3,'approved',$4)", [mgr.id, deputy.id, hr.id, gm.id]);
  await fails(approvePurchaseOrder(deputy, po.id, {}), 403, "expired delegation");
  const dl = (await pool.query("insert into approval_delegations (delegator_member_id, delegate_member_id, valid_from, valid_to, proposed_by, status, approved_by) values ($1,$2,current_date - 1,current_date + 3,$3,'approved',$4) returning id::int", [mgr.id, deputy.id, hr.id, gm.id])).rows[0].id;
  const approved = await approvePurchaseOrder(deputy, po.id, {});
  assert.equal(approved.status, "approved"); assert.equal(Number(approved.approvedViaDelegationId), dl); assert.match(approved.documentHash!, /^[0-9a-f]{64}$/);
  await fails(approvePurchaseOrder(mgr, po.id, {}), 409, "already approved");

  // the database keeps the approved order frozen even for direct writes
  await assert.rejects(pool.query("update purchase_orders set supplier_id = $1 where id = $2", [sups[0]!.id, po.id]), /frozen/);
  assert.equal((await pool.query("select status from purchase_requests where id=$1", [pr.id])).rows[0].status, "po_issued");

  // visibility and audit
  assert.ok((await listPurchaseOrders(buyer)).some((r) => (r as { id: number }).id === po.id)); assert.equal((await listPurchaseOrders(mgrB)).length >= 0, true);
  assert.ok(!(await listPurchaseOrders(mgrB)).some((r) => (r as { id: number }).id === po.id), "other branch cannot see the order");
  const trail = (await pool.query("select action from audit_events where subject_no = $1 order by id", [po.poNo])).rows.map((r) => r.action);
  assert.deepEqual(trail, ["po.prepare", "po.approve"]);
  assert.equal((await pool.query("select * from verify_audit_chain()")).rowCount, 0);

  // OTP gate on the money-bearing steps
  process.env.OTP_FINANCE_REQUIRED = "true";
  const pr2 = await createPurchaseRequest(keeper, { warehouseId: whA!.id, lines: [{ itemId: paper.id, qty: 20 }] });
  const rfq2 = await createRfq(buyer, pr2.id, { supplierIds: sups.slice(0, 3).map((s) => s.id), deadlineAt: deadline });
  for (const s of sups.slice(0, 3)) await addQuotation(buyer, rfq2.id, { supplierId: s.id, quoteDate: "2026-12-02", lines: [{ itemId: paper.id, unitPriceHalalas: 300 }] });
  const c2 = (await getComparison(buyer, rfq2.id)).quotations[0]!;
  await recommendAward(buyer, rfq2.id, { quotationId: c2.quotation_id, justification: "أفضل مدة توريد وجودة موثقة" });
  const o = await fails(approveAward(mgr, rfq2.id, {}), 428, "OTP required to approve an award") as DomainError & { otpRequired?: boolean };
  assert.equal(o.otpRequired, true);
  delete process.env.OTP_FINANCE_REQUIRED;

  await db.delete(notifications).where(eq(notifications.memberId, keeper.id));
  console.log("procurement.check passed");
}
main().then(() => pool.end(), (e) => { console.error(e); pool.end().finally(() => process.exit(1)); });
