import crypto from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db, branches, items, suppliers, purchaseRequests, purchaseRequestLines, rfqs, rfqSuppliers, quotations, quotationLines,
  quotationEvaluations, rfqAwards, purchaseOrders, purchaseOrderLines, reorderAlerts, warehouses,
} from "@workspace/db";
import type { Member } from "./education-access";
import { DomainError } from "./education-validation";
import { consumeChallenge, otpEnabled } from "./otp";
import { recordAudit } from "./audit";
import { budgetAlerts } from "./fiscal";

/**
 * Procurement cycle, standard path: purchase request -> RFQ -> 3+ quotations -> evaluation -> award (justified when not the
 * cheapest) -> branch manager / delegate approval -> purchase order prepared (OTP) -> approved (OTP) -> sent.
 * The database enforces the hard rules (3 suppliers, approved supplier with VAT number, segregation of duties, frozen PO);
 * this layer adds authorization, delegation, OTP, audit and friendly errors.
 * Not built yet: small direct-purchase path, PO PDF/email, goods receipt, supplier invoice and three-way match.
 */
const BUY_ROLES: string[] = ["super_admin", "procurement_officer"];
const REQUEST_ROLES: string[] = ["super_admin", "branch_manager", "warehouse_keeper", "procurement_officer"];
const READ_ROLES: string[] = [...REQUEST_ROLES, "finance"];
const ORG_WIDE: string[] = ["finance", "procurement_officer"];

const inScope = (m: Member, branchId: number) => m.role === "super_admin" || m.branchId === branchId || (ORG_WIDE.includes(m.role) && m.branchId == null);
const deny = (msg = "ليست لديك صلاحية لهذه العملية"): never => { throw new DomainError(msg, 403); };
export const canReadProcurement = (m: Member) => READ_ROLES.includes(m.role);

const pgCode = (e: unknown) => ((e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code);
const pgMessage = (e: unknown) => String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message ?? "");
const FRIENDLY: [RegExp, string][] = [
  [/at least \d+ quotations/, "يلزم ثلاثة عروض أسعار على الأقل من موردين مختلفين قبل الترسية"],
  [/not the cheapest/, "الاختيار ليس الأقل سعرًا؛ اكتب مبررًا"],
  [/rfq_awards_justification_ck/, "اكتب مبررًا واضحًا (10 أحرف على الأقل) عند اختيار غير الأقل سعرًا"],
  [/is not approved/, "المورد غير معتمد"],
  [/does not match the supplier register/, "الرقم الضريبي في العرض لا يطابق سجل المورد"],
  [/award has not been approved/, "لم تُعتمد الترسية بعد"],
  [/differs from the awarded supplier/, "المورد في أمر الشراء يختلف عن المورد المرسّى عليه"],
  [/segregation_ck|approver_ck/, "لا يجوز أن يعتمد الشخص ما أعدّه بنفسه"],
  [/purchase_orders_supplier_vat_ck|approved supplier with a matching VAT/, "أمر الشراء يلزمه مورد معتمد برقم ضريبي صحيح"],
  [/frozen/, "أمر الشراء مجمّد بعد التجهيز؛ أنشئ نسخة جديدة"],
  [/suppliers_vat_uq/, "الرقم الضريبي مسجل لمورد آخر"],
  [/suppliers_vat_format_ck/, "الرقم الضريبي غير صحيح (15 رقمًا يبدأ وينتهي بالرقم 3)"],
];
function friendly(e: unknown): never {
  if (e instanceof DomainError) throw e;
  const code = pgCode(e), msg = pgMessage(e);
  if (code === "23514" || code === "23505" || code === "23503" || code === "P0001" || code === "23P01") {
    for (const [re, ar] of FRIENDLY) if (re.test(msg)) throw new DomainError(ar, 409);
    throw new DomainError("خالفت العملية قاعدة من قواعد المشتريات", 409);
  }
  throw e;
}
const money = (v: unknown, what: string) => { if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 1e12) throw new DomainError(`${what} غير صحيح`); return v as number; };
const int = (v: unknown, what: string) => { if (!Number.isInteger(v) || (v as number) <= 0) throw new DomainError(`${what} غير صحيح`); return v as number; };
const iso = (v: unknown, what: string) => { if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new DomainError(`${what} غير صحيح`); return v; };
const hash = (v: unknown) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ---------- Suppliers ---------------------------------------------------------------------------------------------
export async function listSuppliers(m: Member) {
  if (!canReadProcurement(m)) deny();
  return db.select().from(suppliers).orderBy(asc(suppliers.legalName));
}
export async function createSupplier(m: Member, i: Record<string, unknown>) {
  if (!BUY_ROLES.includes(m.role)) deny("إضافة الموردين لمختص المشتريات والإدارة العليا");
  const legalName = typeof i.legalName === "string" ? i.legalName.trim() : "";
  if (!legalName || legalName.length > 200) throw new DomainError("اسم المورد مطلوب");
  const vat = typeof i.vatNumber === "string" ? i.vatNumber.trim() : "";
  if (!/^3\d{13}3$/.test(vat)) throw new DomainError("الرقم الضريبي غير صحيح (15 رقمًا يبدأ وينتهي بالرقم 3)");
  try {
    return await db.transaction(async (tx) => {
      const no = (await tx.execute(sql`select next_doc_no('SUP') as n`)).rows[0] as { n: string };
      const [row] = await tx.insert(suppliers).values({
        supplierNo: no.n, legalName, vatNumber: vat, commercialRegNo: typeof i.commercialRegNo === "string" ? i.commercialRegNo.trim().slice(0, 40) || null : null,
        email: typeof i.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.email) ? i.email.trim().toLowerCase() : null,
        phone: typeof i.phone === "string" ? i.phone.trim().slice(0, 30) || null : null, city: typeof i.city === "string" ? i.city.trim().slice(0, 80) || null : null,
      }).returning();
      await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, action: "supplier.create", subjectType: "supplier", subjectId: row!.id, subjectNo: row!.supplierNo, after: { legalName, vat } });
      return row!;
    });
  } catch (e) { return friendly(e); }
}
/** A supplier is approved by someone other than the creator's role chain: administrators and branch managers only. */
export async function approveSupplier(m: Member, id: number) {
  if (!["super_admin", "branch_manager"].includes(m.role)) deny("اعتماد الموردين للإدارة العليا ومديري الفروع");
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.update(suppliers).set({ status: "approved", approvedBy: m.id, approvedAt: new Date() }).where(and(eq(suppliers.id, id), eq(suppliers.status, "pending"))).returning();
      if (!row) throw new DomainError("المورد غير موجود أو معتمد سابقًا", 404);
      await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, action: "supplier.approve", subjectType: "supplier", subjectId: row.id, subjectNo: row.supplierNo });
      return row;
    });
  } catch (e) { return friendly(e); }
}

// ---------- Purchase requests -------------------------------------------------------------------------------------
export async function createPurchaseRequest(m: Member, i: { warehouseId?: unknown; reason?: unknown; alertId?: unknown; lines?: unknown }) {
  if (!REQUEST_ROLES.includes(m.role)) deny("لا يمكنك إنشاء طلب شراء");
  const warehouseId = int(i.warehouseId, "المستودع");
  const lines = Array.isArray(i.lines) ? (i.lines as { itemId?: unknown; qty?: unknown }[]) : [];
  if (!lines.length || lines.length > 100) throw new DomainError("أضف صنفًا واحدًا على الأقل");
  const seen = new Set<number>();
  const clean = lines.map((l) => {
    const itemId = int(l.itemId, "الصنف"); if (seen.has(itemId)) throw new DomainError("الصنف مكرر في الطلب"); seen.add(itemId);
    if (typeof l.qty !== "number" || !Number.isFinite(l.qty) || l.qty <= 0 || l.qty > 1e9) throw new DomainError("الكمية غير صحيحة");
    return { itemId, qty: l.qty };
  });
  try {
    return await db.transaction(async (tx) => {
      const [w] = await tx.select().from(warehouses).where(eq(warehouses.id, warehouseId));
      if (!w || !inScope(m, w.branchId)) throw new DomainError("المستودع غير موجود", 404);
      const found = await tx.select({ id: items.id }).from(items).where(and(inArray(items.id, clean.map((c) => c.itemId)), eq(items.isActive, true)));
      if (found.length !== clean.length) throw new DomainError("أحد الأصناف غير موجود");
      let alertId: number | null = null;
      if (i.alertId != null) {
        alertId = int(i.alertId, "التنبيه");
        const [a] = await tx.select().from(reorderAlerts).where(and(eq(reorderAlerts.id, alertId), eq(reorderAlerts.warehouseId, warehouseId)));
        if (!a || !["open", "in_progress"].includes(a.status)) throw new DomainError("التنبيه غير مفتوح");
      }
      // Business rule: do not buy what a warehouse already holds above its minimum.
      const stocked = (await tx.execute(sql`select i.name, b.qty_on_hand::float8 as q, sl.min_qty::float8 as mn from items i
          join v_stock_balances b on b.item_id = i.id and b.warehouse_id = ${warehouseId}
          join stock_levels sl on sl.item_id = i.id and sl.warehouse_id = ${warehouseId}
         where i.id in (${sql.join(clean.map((c) => sql`${c.itemId}`), sql`, `)}) and b.qty_on_hand > sl.min_qty`)).rows as { name: string; q: number; mn: number }[];
      if (stocked.length) throw new DomainError(`المخزون كافٍ ولا حاجة للشراء: ${stocked.map((s) => `${s.name} (${s.q} > الحد الأدنى ${s.mn})`).join("، ")}`, 409);
      const no = (await tx.execute(sql`select next_doc_no('PR') as n`)).rows[0] as { n: string };
      const [pr] = await tx.insert(purchaseRequests).values({
        prNo: no.n, branchId: w.branchId, warehouseId, source: alertId ? "alert" : "manual", alertId, requestedBy: m.id,
        reason: typeof i.reason === "string" ? i.reason.trim().slice(0, 500) || null : null, status: "submitted",
      }).returning();
      await tx.insert(purchaseRequestLines).values(clean.map((c) => ({ prId: pr!.id, itemId: c.itemId, qty: c.qty })));
      if (alertId) await tx.update(reorderAlerts).set({ status: "in_progress", purchaseRequestId: pr!.id }).where(eq(reorderAlerts.id, alertId));
      await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, branchId: w.branchId, action: "pr.create", subjectType: "purchase_request", subjectId: pr!.id, subjectNo: pr!.prNo, after: { lines: clean } });
      return pr!;
    });
  } catch (e) { return friendly(e); }
}

export async function listPurchaseRequests(m: Member) {
  if (!canReadProcurement(m)) deny();
  const rows = (await db.execute(sql`
    select p.id::int as id, p.pr_no, p.status, p.path, p.source, p.reason, p.created_at, p.branch_id::int as branch_id, b.name as branch, w.name as warehouse,
           (select count(*)::int from purchase_request_lines l where l.pr_id = p.id) as line_count,
           (select r.id::int from rfqs r where r.pr_id = p.id and r.status <> 'cancelled' order by r.id desc limit 1) as rfq_id
      from purchase_requests p join branches b on b.id = p.branch_id join warehouses w on w.id = p.warehouse_id order by p.id desc limit 200`)).rows as { branch_id: number }[];
  return rows.filter((r) => inScope(m, r.branch_id));
}

// ---------- RFQ and quotations ------------------------------------------------------------------------------------
async function loadPr(tx: Tx, m: Member, id: number) {
  const [pr] = await tx.select().from(purchaseRequests).where(eq(purchaseRequests.id, id));
  if (!pr || !inScope(m, pr.branchId)) throw new DomainError("طلب الشراء غير موجود", 404);
  return pr;
}
export async function createRfq(m: Member, prId: number, i: { supplierIds?: unknown; deadlineAt?: unknown }) {
  if (!BUY_ROLES.includes(m.role)) deny("طلب عروض الأسعار لمختص المشتريات");
  const ids = Array.isArray(i.supplierIds) ? [...new Set((i.supplierIds as unknown[]).map((x) => int(x, "المورد")))] : [];
  if (ids.length < 3) throw new DomainError("اختر ثلاثة موردين على الأقل");
  const deadline = new Date(String(i.deadlineAt));
  if (Number.isNaN(deadline.getTime()) || deadline.getTime() <= Date.now()) throw new DomainError("الموعد النهائي يجب أن يكون في المستقبل");
  try {
    return await db.transaction(async (tx) => {
      const pr = await loadPr(tx, m, prId);
      if (pr.status !== "submitted") throw new DomainError("لا يمكن طلب عروض لهذا الطلب في حالته الحالية", 409);
      const sup = await tx.select().from(suppliers).where(inArray(suppliers.id, ids));
      if (sup.length !== ids.length || sup.some((s) => s.status !== "approved")) throw new DomainError("كل الموردين يجب أن يكونوا معتمدين");
      const no = (await tx.execute(sql`select next_doc_no('RFQ') as n`)).rows[0] as { n: string };
      const [rfq] = await tx.insert(rfqs).values({ rfqNo: no.n, prId, deadlineAt: deadline, createdBy: m.id }).returning();
      await tx.insert(rfqSuppliers).values(ids.map((supplierId) => ({ rfqId: rfq!.id, supplierId, sentAt: new Date() })));
      await tx.update(purchaseRequests).set({ status: "rfq" }).where(eq(purchaseRequests.id, prId));
      await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, branchId: pr.branchId, action: "rfq.create", subjectType: "rfq", subjectId: rfq!.id, subjectNo: rfq!.rfqNo, after: { supplierIds: ids } });
      return rfq!;
    });
  } catch (e) { return friendly(e); }
}

/** The authorised procurement employee enters each supplier's quote; quantities come from the purchase request. */
export async function addQuotation(m: Member, rfqId: number, i: { supplierId?: unknown; quoteRef?: unknown; quoteDate?: unknown; validUntil?: unknown; deliveryDays?: unknown; paymentTerms?: unknown; qualityNotes?: unknown; lines?: unknown }) {
  if (!BUY_ROLES.includes(m.role)) deny("إدخال العروض لمختص المشتريات");
  const supplierId = int(i.supplierId, "المورد");
  const lines = Array.isArray(i.lines) ? (i.lines as { itemId?: unknown; unitPriceHalalas?: unknown; vatRate?: unknown }[]) : [];
  try {
    return await db.transaction(async (tx) => {
      const [rfq] = await tx.select().from(rfqs).where(eq(rfqs.id, rfqId));
      if (!rfq) throw new DomainError("طلب عرض السعر غير موجود", 404);
      await loadPr(tx, m, rfq.prId);
      if (rfq.status !== "open") throw new DomainError("طلب عرض السعر مغلق", 409);
      const [invited] = await tx.select().from(rfqSuppliers).where(and(eq(rfqSuppliers.rfqId, rfqId), eq(rfqSuppliers.supplierId, supplierId)));
      if (!invited) throw new DomainError("المورد غير مدعو لهذا الطلب", 409);
      const [sup] = await tx.select().from(suppliers).where(eq(suppliers.id, supplierId));
      const prLines = await tx.select().from(purchaseRequestLines).where(eq(purchaseRequestLines.prId, rfq.prId));
      const byItem = new Map(lines.map((l) => [Number(l.itemId), l]));
      if (prLines.some((p) => !byItem.has(p.itemId)) || byItem.size !== prLines.length) throw new DomainError("يجب تسعير كل أصناف الطلب دون زيادة");
      const [q] = await tx.insert(quotations).values({
        rfqId, supplierId, supplierVatNumber: sup!.vatNumber ?? "", quoteRef: typeof i.quoteRef === "string" ? i.quoteRef.trim().slice(0, 60) || null : null,
        quoteDate: iso(i.quoteDate, "تاريخ العرض"), validUntil: i.validUntil ? iso(i.validUntil, "تاريخ الصلاحية") : null,
        deliveryDays: i.deliveryDays == null ? null : Number.isInteger(i.deliveryDays) && (i.deliveryDays as number) >= 0 ? (i.deliveryDays as number) : (() => { throw new DomainError("مدة التوريد غير صحيحة"); })(),
        paymentTerms: typeof i.paymentTerms === "string" ? i.paymentTerms.trim().slice(0, 200) || null : null,
        qualityNotes: typeof i.qualityNotes === "string" ? i.qualityNotes.trim().slice(0, 500) || null : null, enteredBy: m.id,
      }).returning();
      await tx.insert(quotationLines).values(prLines.map((p) => {
        const l = byItem.get(p.itemId)!;
        const vat = l.vatRate == null ? 15 : Number(l.vatRate);
        if (!Number.isFinite(vat) || vat < 0 || vat > 100) throw new DomainError("نسبة الضريبة غير صحيحة");
        return { quotationId: q!.id, itemId: p.itemId, quantity: p.qty, unitPriceHalalas: money(l.unitPriceHalalas, "سعر الوحدة"), vatRate: vat };
      }));
      await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, action: "quotation.add", subjectType: "quotation", subjectId: q!.id, subjectNo: `${rfq.rfqNo}/${sup!.supplierNo}`, after: { supplierId } });
      return q!;
    });
  } catch (e) { return friendly(e); }
}

export async function getComparison(m: Member, rfqId: number) {
  if (!canReadProcurement(m)) deny();
  const [rfq] = await db.select().from(rfqs).where(eq(rfqs.id, rfqId));
  if (!rfq) throw new DomainError("طلب عرض السعر غير موجود", 404);
  const [pr] = await db.select().from(purchaseRequests).where(eq(purchaseRequests.id, rfq.prId));
  if (!pr || !inScope(m, pr.branchId)) throw new DomainError("طلب عرض السعر غير موجود", 404);
  const rows = (await db.execute(sql`
    select q.id::int as quotation_id, q.supplier_id::int as supplier_id, s.legal_name, s.supplier_no, q.quote_ref, q.delivery_days, q.payment_terms, q.quality_notes, q.status,
           coalesce(sum(l.net_halalas),0)::float8 as net_halalas, coalesce(sum(l.vat_halalas),0)::float8 as vat_halalas,
           (select round(avg(e.technical_score))::int from quotation_evaluations e where e.quotation_id = q.id) as technical,
           (select round(avg(e.quality_score))::int from quotation_evaluations e where e.quotation_id = q.id) as quality,
           (select round(avg(e.commercial_score))::int from quotation_evaluations e where e.quotation_id = q.id) as commercial
      from quotations q join suppliers s on s.id = q.supplier_id left join quotation_lines l on l.quotation_id = q.id
     where q.rfq_id = ${rfqId} and q.status = 'submitted' group by q.id, s.legal_name, s.supplier_no order by 10, q.id`)).rows as { net_halalas: number }[];
  const lowest = rows.length ? Math.min(...rows.map((r) => r.net_halalas)) : null;
  const [award] = await db.select().from(rfqAwards).where(eq(rfqAwards.rfqId, rfqId));
  const invited = (await db.execute(sql`select s.id::int as id, s.legal_name, (rs.sent_at is not null) as sent from rfq_suppliers rs join suppliers s on s.id = rs.supplier_id where rs.rfq_id = ${rfqId} order by s.legal_name`)).rows;
  return { rfq, branchId: pr.branchId, invited, quotations: rows.map((r) => ({ ...r, isLowest: r.net_halalas === lowest })), award: award ?? null, minQuotes: 3 };
}

export async function evaluateQuotation(m: Member, quotationId: number, i: { technicalScore?: unknown; qualityScore?: unknown; commercialScore?: unknown; notes?: unknown }) {
  if (!["super_admin", "branch_manager", "procurement_officer"].includes(m.role)) deny("التقييم للجنة المقارنة");
  const score = (v: unknown, what: string) => { if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 100) throw new DomainError(`${what}: رقم من 0 إلى 100`); return v as number; };
  try {
    return await db.transaction(async (tx) => {
      const [q] = await tx.select().from(quotations).where(eq(quotations.id, quotationId));
      if (!q) throw new DomainError("العرض غير موجود", 404);
      const [rfq] = await tx.select().from(rfqs).where(eq(rfqs.id, q.rfqId));
      await loadPr(tx, m, rfq!.prId);
      const values = { technicalScore: score(i.technicalScore, "الدرجة الفنية"), qualityScore: score(i.qualityScore, "درجة الجودة"), commercialScore: score(i.commercialScore, "الدرجة المالية"), notes: typeof i.notes === "string" ? i.notes.trim().slice(0, 500) || null : null };
      const [row] = await tx.insert(quotationEvaluations).values({ quotationId, evaluatedBy: m.id, ...values })
        .onConflictDoUpdate({ target: [quotationEvaluations.quotationId, quotationEvaluations.evaluatedBy], set: values }).returning();
      await tx.update(rfqs).set({ status: "evaluating" }).where(and(eq(rfqs.id, rfq!.id), eq(rfqs.status, "open")));
      return row!;
    });
  } catch (e) { return friendly(e); }
}

// ---------- Award and approval ------------------------------------------------------------------------------------
/** The branch manager approves; when away, an approved delegation (proposed by HR, approved by the GM) lets the delegate act. */
async function approvalAuthority(tx: Tx, m: Member, branchId: number): Promise<{ ok: boolean; delegationId: number | null }> {
  if (m.role === "super_admin") return { ok: true, delegationId: null };
  if (m.role === "branch_manager" && m.branchId === branchId) return { ok: true, delegationId: null };
  const d = (await tx.execute(sql`select ad.id::int as id from approval_delegations ad join org_members dm on dm.id = ad.delegator_member_id
      where ad.delegate_member_id = ${m.id} and ad.status = 'approved' and ad.scope in ('purchase_approval','all')
        and current_date between ad.valid_from and ad.valid_to and dm.role = 'branch_manager' and dm.branch_id = ${branchId} and dm.status = 'active' limit 1`)).rows[0] as { id: number } | undefined;
  return d ? { ok: true, delegationId: d.id } : { ok: false, delegationId: null };
}

export async function recommendAward(m: Member, rfqId: number, i: { quotationId?: unknown; justification?: unknown }) {
  if (!BUY_ROLES.includes(m.role)) deny("التوصية بالترسية لمختص المشتريات");
  const quotationId = int(i.quotationId, "العرض");
  try {
    return await db.transaction(async (tx) => {
      const [rfq] = await tx.select().from(rfqs).where(eq(rfqs.id, rfqId));
      if (!rfq) throw new DomainError("طلب عرض السعر غير موجود", 404);
      await loadPr(tx, m, rfq.prId);
      const totals = (await tx.execute(sql`select q.id::int as id, sum(l.net_halalas)::float8 as net from quotations q join quotation_lines l on l.quotation_id = q.id where q.rfq_id = ${rfqId} and q.status = 'submitted' group by q.id`)).rows as { id: number; net: number }[];
      const chosen = totals.find((t) => t.id === quotationId);
      if (!chosen) throw new DomainError("العرض غير موجود ضمن هذا الطلب");
      const lowest = Math.min(...totals.map((t) => t.net));
      const [row] = await tx.insert(rfqAwards).values({
        rfqId, quotationId, isLowestPrice: chosen.net === lowest, justification: typeof i.justification === "string" ? i.justification.trim().slice(0, 600) || null : null, recommendedBy: m.id,
      }).returning();
      await tx.update(rfqs).set({ status: "evaluating" }).where(eq(rfqs.id, rfqId));
      return row!;
    });
  } catch (e) { return friendly(e); }
}

export async function approveAward(m: Member, rfqId: number, ctx: { challengeId?: string; userAgent?: string | null }) {
  try {
    return await db.transaction(async (tx) => {
      const [rfq] = await tx.select().from(rfqs).where(eq(rfqs.id, rfqId));
      if (!rfq) throw new DomainError("طلب عرض السعر غير موجود", 404);
      const pr = await loadPr(tx, m, rfq.prId);
      const auth = await approvalAuthority(tx, m, pr.branchId);
      if (!auth.ok) deny("اعتماد الترسية لمدير الفرع أو من فوّضته الإدارة");
      const [award] = await tx.select().from(rfqAwards).where(eq(rfqAwards.rfqId, rfqId));
      if (!award) throw new DomainError("لا توجد توصية بالترسية", 409);
      if (award.approvedBy) throw new DomainError("الترسية معتمدة سابقًا", 409);
      const subject = { rfqId, quotationId: award.quotationId, isLowestPrice: award.isLowestPrice, justification: award.justification };
      const otp = otpEnabled() ? await consumeChallenge(tx, { challengeId: ctx.challengeId, memberId: m.id, action: "procurement.award.approve", subject }) : null;
      const [row] = await tx.update(rfqAwards).set({ approvedBy: m.id, approvedAt: new Date() }).where(eq(rfqAwards.rfqId, rfqId)).returning();
      await tx.update(rfqs).set({ status: "awarded" }).where(eq(rfqs.id, rfqId));
      await tx.update(purchaseRequests).set({ status: "awarded" }).where(eq(purchaseRequests.id, pr.id));
      await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, branchId: pr.branchId, action: "award.approve", subjectType: "rfq", subjectId: rfqId, subjectNo: rfq.rfqNo, after: { ...subject, viaDelegation: auth.delegationId },
        reason: award.justification, otp: otp ? { challengeId: otp.challengeId, sentAt: otp.sentAt, verifiedAt: otp.verifiedAt, sentIp: otp.sentIp, verifiedIp: otp.verifiedIp } : null, userAgent: ctx.userAgent, contentHash: otp?.subjectHash });
      return row!;
    });
  } catch (e) { return friendly(e); }
}

// ---------- Purchase orders ---------------------------------------------------------------------------------------
/** Prepared by the procurement specialist, confirmed with an OTP; from this moment the order is frozen (database trigger). */
export async function preparePurchaseOrder(m: Member, rfqId: number, i: { deliveryDate?: unknown; terms?: unknown }, ctx: { challengeId?: string; userAgent?: string | null }) {
  if (!BUY_ROLES.includes(m.role)) deny("إعداد أمر الشراء لمختص المشتريات");
  try {
    return await db.transaction(async (tx) => {
      const [rfq] = await tx.select().from(rfqs).where(eq(rfqs.id, rfqId));
      if (!rfq) throw new DomainError("طلب عرض السعر غير موجود", 404);
      const pr = await loadPr(tx, m, rfq.prId);
      const [award] = await tx.select().from(rfqAwards).where(eq(rfqAwards.rfqId, rfqId));
      if (!award?.approvedBy) throw new DomainError("لا يمكن إصدار أمر شراء قبل اعتماد الترسية", 409);
      const [dup] = await tx.select({ id: purchaseOrders.id }).from(purchaseOrders).where(and(eq(purchaseOrders.rfqId, rfqId), inArray(purchaseOrders.status, ["draft", "prepared", "approved", "sent", "acknowledged", "partially_received", "received"])));
      if (dup) throw new DomainError("صدر أمر شراء لهذه الترسية سابقًا", 409);
      const [q] = await tx.select().from(quotations).where(eq(quotations.id, award.quotationId));
      const [sup] = await tx.select().from(suppliers).where(eq(suppliers.id, q!.supplierId));
      const [br] = await tx.select().from(branches).where(eq(branches.id, pr.branchId));
      const entityVat = br?.vatNumber ?? (await tx.execute(sql`select value from org_settings where key = 'entity.vat_number'`)).rows[0]?.value as string | undefined;
      const entityName = (await tx.execute(sql`select value from org_settings where key = 'entity.name'`)).rows[0]?.value as string | undefined ?? br?.name ?? "";
      if (!entityVat) throw new DomainError("أدخل الرقم الضريبي للجهة (الفرع أو إعداد entity.vat_number) قبل إصدار أمر الشراء", 409);
      const qLines = await tx.select().from(quotationLines).where(eq(quotationLines.quotationId, q!.id));
      const subject = { rfqId, quotationId: q!.id, supplierId: sup!.id, netHalalas: qLines.reduce((a, l) => a + Number(l.netHalalas), 0), deliveryDate: i.deliveryDate ?? null };
      const otp = otpEnabled() ? await consumeChallenge(tx, { challengeId: ctx.challengeId, memberId: m.id, action: "procurement.po.prepare", subject }) : null;
      const no = (await tx.execute(sql`select next_doc_no('PO') as n`)).rows[0] as { n: string };
      const [po] = await tx.insert(purchaseOrders).values({
        poNo: no.n, prId: pr.id, rfqId, branchId: pr.branchId, warehouseId: pr.warehouseId, supplierId: sup!.id, entityName, entityVatNumber: entityVat,
        supplierVatNumber: sup!.vatNumber!, issueDate: new Date().toISOString().slice(0, 10), deliveryDate: i.deliveryDate ? iso(i.deliveryDate, "تاريخ التسليم") : null,
        terms: typeof i.terms === "string" ? i.terms.trim().slice(0, 1000) || q!.paymentTerms : q!.paymentTerms, preparedBy: m.id,
      }).returning();
      await tx.insert(purchaseOrderLines).values(qLines.map((l, idx) => ({ poId: po!.id, lineNo: idx + 1, itemId: l.itemId, quantity: l.quantity, unitPriceHalalas: l.unitPriceHalalas, vatRate: l.vatRate })));
      const tot = (await tx.execute(sql`select sum(net_halalas)::float8 as n, sum(vat_halalas)::float8 as v from purchase_order_lines where po_id = ${po!.id}`)).rows[0] as { n: number; v: number };
      const [prepared] = await tx.update(purchaseOrders).set({ netHalalas: tot.n, vatHalalas: tot.v, status: "prepared", preparedAt: new Date() }).where(eq(purchaseOrders.id, po!.id)).returning();
      await tx.update(purchaseRequests).set({ status: "po_issued" }).where(eq(purchaseRequests.id, pr.id));
      await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, branchId: pr.branchId, action: "po.prepare", subjectType: "purchase_order", subjectId: po!.id, subjectNo: po!.poNo, after: { ...subject, netHalalas: tot.n, vatHalalas: tot.v },
        otp: otp ? { challengeId: otp.challengeId, sentAt: otp.sentAt, verifiedAt: otp.verifiedAt, sentIp: otp.sentIp, verifiedIp: otp.verifiedIp } : null, userAgent: ctx.userAgent, contentHash: otp?.subjectHash });
      return prepared!;
    });
  } catch (e) { return friendly(e); }
}

export async function approvePurchaseOrder(m: Member, poId: number, ctx: { challengeId?: string; userAgent?: string | null }) {
  try {
    return await db.transaction(async (tx) => {
      const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId));
      if (!po || !inScope(m, po.branchId)) throw new DomainError("أمر الشراء غير موجود", 404);
      if (po.status !== "prepared") throw new DomainError("أمر الشراء ليس بانتظار الاعتماد", 409);
      const auth = await approvalAuthority(tx, m, po.branchId);
      if (!auth.ok) deny("اعتماد أمر الشراء لمدير الفرع أو من فوّضته الإدارة");
      const lines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, po.id)).orderBy(asc(purchaseOrderLines.lineNo));
      const documentHash = hash({ poNo: po.poNo, version: po.version, supplier: po.supplierVatNumber, entity: po.entityVatNumber, net: po.netHalalas, vat: po.vatHalalas, lines: lines.map((l) => [l.itemId, l.quantity, l.unitPriceHalalas, l.vatRate]) });
      const subject = { poId: po.id, poNo: po.poNo, netHalalas: po.netHalalas, vatHalalas: po.vatHalalas, documentHash };
      const otp = otpEnabled() ? await consumeChallenge(tx, { challengeId: ctx.challengeId, memberId: m.id, action: "procurement.po.approve", subject }) : null;
      const [row] = await tx.update(purchaseOrders).set({ status: "approved", approvedBy: m.id, approvedAt: new Date(), approvedViaDelegationId: auth.delegationId, documentHash }).where(eq(purchaseOrders.id, po.id)).returning();
      await budgetAlerts(tx, po.branchId, `${String(po.issueDate).slice(0, 7)}-01`);   // approved orders are commitments against the monthly budget
      await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, branchId: po.branchId, action: "po.approve", subjectType: "purchase_order", subjectId: po.id, subjectNo: po.poNo, after: { ...subject, viaDelegation: auth.delegationId },
        otp: otp ? { challengeId: otp.challengeId, sentAt: otp.sentAt, verifiedAt: otp.verifiedAt, sentIp: otp.sentIp, verifiedIp: otp.verifiedIp } : null, userAgent: ctx.userAgent, contentHash: otp?.subjectHash ?? documentHash });
      return row!;
    });
  } catch (e) { return friendly(e); }
}

export async function listPurchaseOrders(m: Member) {
  if (!canReadProcurement(m)) deny();
  const rows = (await db.execute(sql`
    select p.id::int as id, p.po_no, p.status, p.issue_date, p.net_halalas::float8 as net_halalas, p.vat_halalas::float8 as vat_halalas, p.gross_halalas::float8 as gross_halalas,
           p.branch_id::int as branch_id, s.legal_name as supplier, p.approved_via_delegation_id is not null as via_delegation, p.document_hash
      from purchase_orders p join suppliers s on s.id = p.supplier_id order by p.id desc limit 200`)).rows as { branch_id: number }[];
  return rows.filter((r) => inScope(m, r.branch_id));
}

export async function purchaseRequestDetail(m: Member, id: number) {
  if (!canReadProcurement(m)) deny();
  const [pr] = await db.select().from(purchaseRequests).where(eq(purchaseRequests.id, id));
  if (!pr || !inScope(m, pr.branchId)) throw new DomainError("طلب الشراء غير موجود", 404);
  const lines = (await db.execute(sql`select l.item_id::int as item_id, i.item_code, i.name, u.name as unit, l.qty::float8 as qty from purchase_request_lines l join items i on i.id = l.item_id join units u on u.id = i.unit_id where l.pr_id = ${id} order by i.item_code`)).rows;
  const rfq = (await db.select().from(rfqs).where(eq(rfqs.prId, id)).orderBy(desc(rfqs.id)).limit(1))[0] ?? null;
  return { request: pr, lines, rfq };
}
