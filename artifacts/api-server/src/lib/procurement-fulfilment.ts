import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  db, purchaseOrders, purchaseOrderLines, goodsReceipts, goodsReceiptLines, supplierInvoices, supplierInvoiceLines, supplierPayments,
  stockMovements, expenses, suppliers, items, itemCategories, branches, orgMembers,
} from "@workspace/db";
import type { Member } from "./education-access";
import { DomainError } from "./education-validation";
import { consumeChallenge, otpEnabled } from "./otp";
import { recordAudit } from "./audit";

/**
 * After the purchase order is approved: send it, receive goods (quality check + stock posting), book the supplier invoice
 * with a three-way match (order / receipt / invoice) inside configurable tolerances, approve it (variances need the branch
 * manager and a written reason), record the expense on the branch, and pay the supplier. Every money step is OTP-gated when
 * OTP_FINANCE_REQUIRED=true and audited. The database keeps over-receipt, duplicate invoices and negative stock impossible.
 */
const STOCK_ROLES: string[] = ["super_admin", "branch_manager", "warehouse_keeper"];
const INVOICE_ROLES: string[] = ["super_admin", "finance", "procurement_officer"];
const PAY_ROLES: string[] = ["super_admin", "finance"];
const ORG_WIDE: string[] = ["finance", "procurement_officer"];
const inScope = (m: Member, branchId: number) => m.role === "super_admin" || m.branchId === branchId || (ORG_WIDE.includes(m.role) && m.branchId == null);
const deny = (msg = "ليست لديك صلاحية لهذه العملية"): never => { throw new DomainError(msg, 403); };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Ctx = { challengeId?: string; userAgent?: string | null };
const pgCode = (e: unknown) => ((e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code);
const pgMessage = (e: unknown) => String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message ?? "");
function friendly(e: unknown): never {
  if (e instanceof DomainError) throw e;
  const msg = pgMessage(e), code = pgCode(e);
  if (/supplier_invoices_dup_uq/.test(msg)) throw new DomainError("رقم فاتورة المورد مسجل سابقًا", 409);
  if (/exceeds the ordered quantity/.test(msg)) throw new DomainError("الكمية المقبولة تتجاوز الكمية المطلوبة في أمر الشراء", 409);
  if (/goods_receipt_lines_rejected_ck/.test(msg)) throw new DomainError("السطر المرفوض لا تُقبل منه أي كمية", 409);
  if (/insufficient stock/.test(msg)) throw new DomainError("الرصيد غير كافٍ", 409);
  if (code === "23514" || code === "23505" || code === "23503") throw new DomainError("خالفت العملية قاعدة من قواعد المشتريات", 409);
  throw e;
}
const evidence = (o: Awaited<ReturnType<typeof consumeChallenge>> | null) => (o ? { challengeId: o.challengeId, sentAt: o.sentAt, verifiedAt: o.verifiedAt, sentIp: o.sentIp, verifiedIp: o.verifiedIp } : null);
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const sar = (h: number) => (h / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function loadPo(tx: Tx, m: Member, id: number) {
  const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id));
  if (!po || !inScope(m, po.branchId)) throw new DomainError("أمر الشراء غير موجود", 404);
  return po;
}

// ---------- Detail, print, send ------------------------------------------------------------------------------------
export async function orderDetail(m: Member, id: number) {
  const po = await loadPo(db as unknown as Tx, m, id);
  const lines = (await db.execute(sql`
    select l.id::int as id, l.line_no, l.item_id::int as item_id, i.item_code, i.name, u.name as unit, l.quantity::float8 as qty, l.unit_price_halalas::float8 as unit_price_halalas, l.vat_rate::float8 as vat_rate,
           l.net_halalas::float8 as net_halalas, l.vat_halalas::float8 as vat_halalas,
           coalesce((select sum(g.qty_accepted) from goods_receipt_lines g join goods_receipts r on r.id = g.grn_id where g.po_line_id = l.id and r.status = 'confirmed'), 0)::float8 as received,
           coalesce((select sum(si.quantity) from supplier_invoice_lines si join supplier_invoices v on v.id = si.invoice_id where si.po_line_id = l.id and v.status in ('matched','approved','paid')), 0)::float8 as invoiced
      from purchase_order_lines l join items i on i.id = l.item_id join units u on u.id = i.unit_id where l.po_id = ${id} order by l.line_no`)).rows;
  const receipts = (await db.execute(sql`select id::int as id, grn_no, received_at, delivery_note_no from goods_receipts where po_id = ${id} and status = 'confirmed' order by id`)).rows;
  const invoices = (await db.execute(sql`select id::int as id, supplier_invoice_no, invoice_date, status, net_halalas::float8 as net_halalas, vat_halalas::float8 as vat_halalas, gross_halalas::float8 as gross_halalas, match_result,
      coalesce((select sum(amount_halalas) from supplier_payments p where p.supplier_invoice_id = v.id and p.status = 'confirmed'), 0)::float8 as paid_halalas from supplier_invoices v where po_id = ${id} order by id`)).rows;
  return { po, lines, receipts, invoices };
}

/** Printable purchase order (RTL, print stylesheet). The user saves it as PDF from the browser; no IP addresses or device data appear on it. */
export async function renderPoHtml(m: Member, id: number): Promise<string> {
  const d = await orderDetail(m, id);
  const [sup] = await db.select().from(suppliers).where(eq(suppliers.id, d.po.supplierId));
  const people = new Map((await db.select({ id: orgMembers.id, email: orgMembers.email }).from(orgMembers).where(inArray(orgMembers.id, [d.po.preparedBy, d.po.approvedBy ?? d.po.preparedBy]))).map((p) => [p.id, p.email]));
  const when = (v: Date | string | null) => (v ? new Date(v).toLocaleString("ar-SA", { dateStyle: "medium", timeStyle: "short" }) : "—");
  const rows = (d.lines as { line_no: number; item_code: string; name: string; unit: string; qty: number; unit_price_halalas: number; net_halalas: number; vat_halalas: number }[])
    .map((l) => `<tr><td>${l.line_no}</td><td dir="ltr">${esc(l.item_code)}</td><td>${esc(l.name)}</td><td>${esc(l.unit)}</td><td>${l.qty}</td><td>${sar(l.unit_price_halalas)}</td><td>${sar(l.net_halalas)}</td><td>${sar(l.vat_halalas)}</td><td>${sar(l.net_halalas + l.vat_halalas)}</td></tr>`).join("");
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>أمر شراء ${esc(d.po.poNo)}</title><style>
body{font-family:Tahoma,Arial,sans-serif;margin:0;padding:24px;color:#0e100f;font-size:13px}h1{font-size:22px;margin:0 0 4px}.muted{color:#5a5f5c}
.head{display:flex;justify-content:space-between;border-bottom:3px solid #0e100f;padding-bottom:12px;margin-bottom:16px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
.box{border:1px solid #d6d3cc;border-radius:8px;padding:10px 12px}.box b{display:block;margin-bottom:4px}table{width:100%;border-collapse:collapse;margin:12px 0}th,td{border:1px solid #d6d3cc;padding:6px 8px;text-align:right}th{background:#f4f3f0}
.tot{width:320px;margin-right:auto}.tot td{border:0;border-bottom:1px solid #eee}.sign{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:24px}.stamp{border:1px dashed #5a5f5c;border-radius:8px;padding:10px}
@media print{body{padding:0}.noprint{display:none}}</style></head><body>
<div class="noprint" style="margin-bottom:12px"><button onclick="window.print()">طباعة / حفظ PDF</button></div>
<div class="head"><div><h1>أمر شراء</h1><div class="muted">${esc(d.po.entityName)}</div><div class="muted">الرقم الضريبي للجهة: <span dir="ltr">${esc(d.po.entityVatNumber)}</span></div></div>
<div style="text-align:left"><div style="font-size:18px;font-weight:700" dir="ltr">${esc(d.po.poNo)}</div><div class="muted">التاريخ: ${esc(d.po.issueDate)}</div><div class="muted">التسليم المطلوب: ${esc(d.po.deliveryDate ?? "—")}</div></div></div>
<div class="grid"><div class="box"><b>المورد</b>${esc(sup?.legalName)}<br>الرقم الضريبي: <span dir="ltr">${esc(d.po.supplierVatNumber)}</span><br>${esc(sup?.city ?? "")}</div>
<div class="box"><b>التسليم إلى</b>${esc(d.po.entityName)}<br>مستودع الفرع<br>شروط الدفع: ${esc(d.po.terms ?? "—")}</div></div>
<table><thead><tr><th>#</th><th>الكود</th><th>البند</th><th>الوحدة</th><th>الكمية</th><th>سعر الوحدة</th><th>قبل الضريبة</th><th>الضريبة</th><th>الإجمالي</th></tr></thead><tbody>${rows}</tbody></table>
<table class="tot"><tr><td>الإجمالي قبل الضريبة</td><td>${sar(Number(d.po.netHalalas))} ر.س</td></tr><tr><td>ضريبة القيمة المضافة</td><td>${sar(Number(d.po.vatHalalas))} ر.س</td></tr><tr><td><b>الإجمالي شامل الضريبة</b></td><td><b>${sar(Number(d.po.grossHalalas))} ر.س</b></td></tr></table>
<div class="sign"><div class="stamp"><b>أعدّه</b>${esc(people.get(d.po.preparedBy))}<br><span class="muted">${when(d.po.preparedAt)}</span></div><div class="stamp"><b>اعتمده</b>${d.po.approvedBy ? esc(people.get(d.po.approvedBy)) : "—"}<br><span class="muted">${when(d.po.approvedAt)}</span></div></div>
<p class="muted" style="margin-top:20px;font-size:11px">يُرجى ذكر رقم أمر الشراء في فاتورتكم الضريبية. بصمة المستند: <span dir="ltr">${esc((d.po.documentHash ?? "").slice(0, 16))}</span></p></body></html>`;
}

export async function sendPurchaseOrder(m: Member, id: number, ctx: Ctx) {
  if (!["super_admin", "procurement_officer"].includes(m.role)) deny("إرسال أمر الشراء لمختص المشتريات");
  const po = await loadPo(db as unknown as Tx, m, id);
  if (po.status !== "approved") throw new DomainError("أرسل أمر الشراء بعد اعتماده فقط", 409);
  const [sup] = await db.select().from(suppliers).where(eq(suppliers.id, po.supplierId));
  if (!sup?.email) throw new DomainError("أضف بريد المورد قبل الإرسال", 409);
  const key = process.env.RESEND_API_KEY, from = process.env.RESEND_FROM_EMAIL;
  if (!key || !from) throw new DomainError("خدمة البريد غير مهيأة (RESEND_API_KEY / RESEND_FROM_EMAIL)", 503);
  const html = await renderPoHtml(m, id);
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [sup.email], subject: `أمر شراء ${po.poNo} — ${po.entityName}`, html }), signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!r || !r.ok) throw new DomainError("تعذر إرسال البريد إلى المورد", 503);
  return db.transaction(async (tx) => {
    const [row] = await tx.update(purchaseOrders).set({ status: "sent", sentAt: new Date() }).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.status, "approved"))).returning();
    if (!row) throw new DomainError("تغيّرت حالة الأمر", 409);
    await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, branchId: po.branchId, action: "po.send", subjectType: "purchase_order", subjectId: id, subjectNo: po.poNo, after: { to: sup.email }, userAgent: ctx.userAgent });
    return row;
  });
}

// ---------- Goods receipt ----------------------------------------------------------------------------------------------
type ReceiptLine = { poLineId?: unknown; qtyReceived?: unknown; qtyAccepted?: unknown; qualityResult?: unknown; qualityNotes?: unknown };
export async function receiveGoods(m: Member, poId: number, input: { deliveryNoteNo?: unknown; notes?: unknown; lines?: unknown }, ctx: Ctx) {
  if (!STOCK_ROLES.includes(m.role)) deny("الاستلام لأمين المستودع ومدير الفرع");
  const lines = Array.isArray(input.lines) ? (input.lines as ReceiptLine[]) : [];
  if (!lines.length) throw new DomainError("أدخل كميات الاستلام");
  const clean = lines.map((l) => {
    const qr = Number(l.qtyReceived), qa = Number(l.qtyAccepted), id = Number(l.poLineId);
    const q = typeof l.qualityResult === "string" ? l.qualityResult : "accepted";
    if (!Number.isInteger(id) || !Number.isFinite(qr) || qr <= 0 || !Number.isFinite(qa) || qa < 0 || qa > qr) throw new DomainError("كميات الاستلام غير صحيحة");
    if (!["accepted", "accepted_with_notes", "rejected"].includes(q)) throw new DomainError("نتيجة الفحص غير صحيحة");
    if (q === "rejected" && qa !== 0) throw new DomainError("السطر المرفوض لا تُقبل منه كمية");
    if (q === "accepted_with_notes" && !(typeof l.qualityNotes === "string" && l.qualityNotes.trim())) throw new DomainError("اكتب ملاحظات الجودة");
    return { poLineId: id, qtyReceived: qr, qtyAccepted: qa, qualityResult: q, qualityNotes: typeof l.qualityNotes === "string" ? l.qualityNotes.trim().slice(0, 400) || null : null };
  });
  if (new Set(clean.map((c) => c.poLineId)).size !== clean.length) throw new DomainError("سطر مكرر في الاستلام");
  try {
    return await db.transaction(async (tx) => {
      const po = await loadPo(tx, m, poId);
      if (!["sent", "acknowledged", "partially_received"].includes(po.status)) throw new DomainError("لا يُستلم الأمر قبل إرساله للمورد", 409);
      const pol = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, poId));
      if (clean.some((c) => !pol.some((p) => p.id === c.poLineId))) throw new DomainError("سطر لا يتبع أمر الشراء");
      const subject = { poId, lines: clean, deliveryNoteNo: input.deliveryNoteNo ?? null };
      const otp = otpEnabled() ? await consumeChallenge(tx, { challengeId: ctx.challengeId, memberId: m.id, action: "procurement.grn.confirm", subject }) : null;
      const no = (await tx.execute(sql`select next_doc_no('GRN') as n`)).rows[0] as { n: string };
      const [grn] = await tx.insert(goodsReceipts).values({ grnNo: no.n, poId, warehouseId: po.warehouseId, status: "draft", receivedBy: m.id, deliveryNoteNo: typeof input.deliveryNoteNo === "string" ? input.deliveryNoteNo.trim().slice(0, 60) || null : null, notes: typeof input.notes === "string" ? input.notes.trim().slice(0, 400) || null : null }).returning();
      await tx.insert(goodsReceiptLines).values(clean.map((c) => ({ grnId: grn!.id, ...c })));
      for (const c of clean.filter((x) => x.qtyAccepted > 0)) {
        const line = pol.find((p) => p.id === c.poLineId)!;
        const [item] = await tx.select().from(items).where(eq(items.id, line.itemId));
        if (item?.itemType !== "consumable") continue;                       // assets/services are not stocked
        const mv = (await tx.execute(sql`select next_doc_no('MV') as n`)).rows[0] as { n: string };
        await tx.insert(stockMovements).values({ movementNo: mv.n, warehouseId: po.warehouseId, itemId: line.itemId, movementType: "receipt", qtyDelta: c.qtyAccepted, unitCostHalalas: line.unitPriceHalalas, refType: "goods_receipt", refId: grn!.id, createdBy: m.id, otpChallengeId: otp?.challengeId ?? null, purpose: `استلام ${grn!.grnNo}` });
      }
      await tx.update(goodsReceipts).set({ status: "confirmed" }).where(eq(goodsReceipts.id, grn!.id));
      const left = (await tx.execute(sql`select count(*)::int as n from purchase_order_lines l
         where l.po_id = ${poId} and l.quantity > coalesce((select sum(g.qty_accepted) from goods_receipt_lines g join goods_receipts r on r.id = g.grn_id where g.po_line_id = l.id and r.status = 'confirmed'), 0)`)).rows[0] as { n: number };
      const status = left.n === 0 ? "received" : "partially_received";
      await tx.update(purchaseOrders).set({ status }).where(eq(purchaseOrders.id, poId));
      await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, branchId: po.branchId, action: "grn.confirm", subjectType: "goods_receipt", subjectId: grn!.id, subjectNo: grn!.grnNo, after: { ...subject, poStatus: status }, otp: evidence(otp), userAgent: ctx.userAgent, contentHash: otp?.subjectHash });
      return { receipt: grn!, poStatus: status };
    });
  } catch (e) { return friendly(e); }
}

// ---------- Supplier invoice and three-way match -------------------------------------------------------------------------
async function tolerance(tx: Tx, categoryId: number | null) {
  const r = (await tx.execute(sql`select price_percent::float8 as p, qty_percent::float8 as q from match_tolerances
      where valid_from <= current_date and (category_id = ${categoryId} or category_id is null) order by (category_id is null), valid_from desc limit 1`)).rows[0] as { p: number; q: number } | undefined;
  return r ?? { p: 0, q: 0 };
}
const EXPENSE_BY_CATEGORY: Record<string, string> = { STAT: "STATIONERY", CLEAN: "CLEAN_SUPPLIES", MAINT: "MAINT", LAB: "EQUIP", IT: "EQUIP", BOOK: "EQUIP" };

export async function createSupplierInvoice(m: Member, poId: number, input: { supplierInvoiceNo?: unknown; invoiceDate?: unknown; lines?: unknown }) {
  if (!INVOICE_ROLES.includes(m.role)) deny("تسجيل فاتورة المورد للمالية ومختص المشتريات");
  const no = typeof input.supplierInvoiceNo === "string" ? input.supplierInvoiceNo.trim() : "";
  if (!no || no.length > 60) throw new DomainError("رقم فاتورة المورد مطلوب");
  const invoiceDate = typeof input.invoiceDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.invoiceDate) ? input.invoiceDate : "";
  if (!invoiceDate) throw new DomainError("تاريخ الفاتورة غير صحيح");
  const lines = Array.isArray(input.lines) ? (input.lines as { poLineId?: unknown; quantity?: unknown; unitPriceHalalas?: unknown }[]) : [];
  if (!lines.length) throw new DomainError("أدخل بنود الفاتورة");
  try {
    return await db.transaction(async (tx) => {
      const po = await loadPo(tx, m, poId);
      if (!["sent", "acknowledged", "partially_received", "received"].includes(po.status)) throw new DomainError("لا تُسجَّل فاتورة قبل إرسال الأمر", 409);
      const pol = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, poId));
      const results: { poLineId: number; ok: boolean; reasons: string[] }[] = [];
      const clean = [];
      for (const l of lines) {
        const line = pol.find((p) => p.id === Number(l.poLineId));
        const qty = Number(l.quantity), price = Number(l.unitPriceHalalas);
        if (!line || !Number.isFinite(qty) || qty <= 0 || !Number.isInteger(price) || price < 0) throw new DomainError("بنود الفاتورة غير صحيحة");
        const [item] = await tx.select().from(items).where(eq(items.id, line.itemId));
        const [cat] = item ? await tx.select().from(itemCategories).where(eq(itemCategories.id, item.categoryId)) : [];
        const tol = await tolerance(tx, item?.categoryId ?? null);
        const received = Number((await tx.execute(sql`select coalesce(sum(g.qty_accepted),0)::float8 as q from goods_receipt_lines g join goods_receipts r on r.id = g.grn_id where g.po_line_id = ${line.id} and r.status = 'confirmed'`)).rows[0]!.q);
        const billed = Number((await tx.execute(sql`select coalesce(sum(s.quantity),0)::float8 as q from supplier_invoice_lines s join supplier_invoices v on v.id = s.invoice_id where s.po_line_id = ${line.id} and v.status in ('matched','approved','paid')`)).rows[0]!.q);
        const reasons: string[] = [];
        if (qty + billed > received * (1 + tol.q / 100) + 1e-9) reasons.push(`الكمية المفوترة (${qty + billed}) أكبر من المستلمة المقبولة (${received})`);
        if (price > Number(line.unitPriceHalalas) * (1 + tol.p / 100) + 1e-9) reasons.push(`سعر الوحدة (${price / 100}) أعلى من سعر الأمر (${Number(line.unitPriceHalalas) / 100})`);
        results.push({ poLineId: line.id, ok: reasons.length === 0, reasons });
        clean.push({ poLineId: line.id, itemId: line.itemId, description: item?.name ?? "بند", quantity: qty, unitPriceHalalas: price, vatRate: Number(line.vatRate), classification: item?.itemType === "consumable" ? "stock" : "expense", tol, cat: cat?.code ?? null });
      }
      const status = results.every((r) => r.ok) ? "matched" : "mismatch";
      const [inv] = await tx.insert(supplierInvoices).values({
        supplierId: po.supplierId, supplierInvoiceNo: no, supplierVatNumber: po.supplierVatNumber, poId, branchId: po.branchId, invoiceDate, netHalalas: 0, vatHalalas: 0, status,
        matchResult: { tolerance: clean[0]?.tol, lines: results }, matchedAt: new Date(), createdBy: m.id,
      }).returning();
      await tx.insert(supplierInvoiceLines).values(clean.map(({ tol: _t, cat: _c, ...c }) => ({ invoiceId: inv!.id, ...c })));
      const tot = (await tx.execute(sql`select sum(net_halalas)::float8 as n, sum(vat_halalas)::float8 as v from supplier_invoice_lines where invoice_id = ${inv!.id}`)).rows[0] as { n: number; v: number };
      const [row] = await tx.update(supplierInvoices).set({ netHalalas: tot.n, vatHalalas: tot.v }).where(eq(supplierInvoices.id, inv!.id)).returning();
      await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, branchId: po.branchId, action: "invoice.create", subjectType: "supplier_invoice", subjectId: inv!.id, subjectNo: no, after: { status, net: tot.n, vat: tot.v, match: results } });
      return row!;
    });
  } catch (e) { return friendly(e); }
}

export async function approveSupplierInvoice(m: Member, id: number, input: { reason?: unknown }, ctx: Ctx) {
  if (!["super_admin", "finance", "branch_manager"].includes(m.role)) deny("اعتماد الفاتورة للمالية ومدير الفرع");
  try {
    return await db.transaction(async (tx) => {
      const [inv] = await tx.select().from(supplierInvoices).where(eq(supplierInvoices.id, id));
      if (!inv || !inScope(m, inv.branchId) && !(m.role === "branch_manager" && m.branchId === inv.branchId)) throw new DomainError("الفاتورة غير موجودة", 404);
      if (!["matched", "mismatch"].includes(inv.status)) throw new DomainError("الفاتورة ليست بانتظار الاعتماد", 409);
      if (inv.createdBy === m.id) throw new DomainError("لا يعتمد الشخص فاتورة سجّلها بنفسه", 403);
      const reason = typeof input.reason === "string" ? input.reason.trim() : "";
      if (inv.status === "mismatch") {
        if (!["super_admin", "branch_manager"].includes(m.role)) throw new DomainError("اعتماد فاتورة بفروقات لمدير الفرع", 403);
        if (reason.length < 10) throw new DomainError("اكتب سبب قبول الفروقات (10 أحرف على الأقل)");
      }
      const subject = { invoiceId: id, no: inv.supplierInvoiceNo, net: inv.netHalalas, vat: inv.vatHalalas, status: inv.status, reason: reason || null };
      const otp = otpEnabled() ? await consumeChallenge(tx, { challengeId: ctx.challengeId, memberId: m.id, action: "procurement.invoice.approve", subject }) : null;
      const [row] = await tx.update(supplierInvoices).set({ status: "approved", approvedBy: m.id }).where(eq(supplierInvoices.id, id)).returning();
      // The branch bears the cost when the invoice is approved: one confirmed expense per invoice (never booked twice).
      const lineCat = (await tx.execute(sql`select c.code from supplier_invoice_lines l join items i on i.id = l.item_id join item_categories c on c.id = i.category_id where l.invoice_id = ${id} order by l.net_halalas desc limit 1`)).rows[0] as { code: string } | undefined;
      const [expCat] = (await tx.execute(sql`select id::int as id from expense_categories where code = ${EXPENSE_BY_CATEGORY[lineCat?.code ?? ""] ?? "OTHER"}`)).rows as { id: number }[];
      const eno = (await tx.execute(sql`select next_doc_no('EXP') as n`)).rows[0] as { n: string };
      const [br] = await tx.select().from(branches).where(eq(branches.id, inv.branchId));
      await tx.insert(expenses).values({ expenseNo: eno.n, branchId: inv.branchId, categoryId: expCat!.id, expenseDate: inv.invoiceDate, description: `فاتورة مورد ${inv.supplierInvoiceNo}${br ? ` — ${br.name}` : ""}`,
        netHalalas: inv.netHalalas, vatHalalas: inv.vatHalalas, source: "supplier_invoice", supplierInvoiceId: inv.id, status: "confirmed", confirmedAt: new Date(), createdBy: m.id });
      await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, branchId: inv.branchId, action: "invoice.approve", subjectType: "supplier_invoice", subjectId: id, subjectNo: inv.supplierInvoiceNo, after: subject, reason: reason || null, otp: evidence(otp), userAgent: ctx.userAgent, contentHash: otp?.subjectHash });
      return row!;
    });
  } catch (e) { return friendly(e); }
}

export async function paySupplierInvoice(m: Member, id: number, input: { amountHalalas?: unknown; method?: unknown; reference?: unknown }, ctx: Ctx) {
  if (!PAY_ROLES.includes(m.role)) deny("سداد الموردين للمالية");
  const amount = Number(input.amountHalalas);
  if (!Number.isInteger(amount) || amount <= 0) throw new DomainError("المبلغ غير صحيح");
  const method = typeof input.method === "string" ? input.method : "";
  if (!["bank_transfer", "cheque", "cash"].includes(method)) throw new DomainError("طريقة السداد غير صحيحة");
  try {
    return await db.transaction(async (tx) => {
      const [inv] = await tx.select().from(supplierInvoices).where(eq(supplierInvoices.id, id));
      if (!inv || !inScope(m, inv.branchId)) throw new DomainError("الفاتورة غير موجودة", 404);
      if (inv.status !== "approved") throw new DomainError("تُسدَّد الفاتورة بعد اعتمادها", 409);
      if (inv.approvedBy === m.id) throw new DomainError("لا يسدّد الشخص فاتورة اعتمدها بنفسه", 403);
      const paid = Number((await tx.execute(sql`select coalesce(sum(amount_halalas),0)::float8 as p from supplier_payments where supplier_invoice_id = ${id} and status = 'confirmed'`)).rows[0]!.p);
      if (paid + amount > Number(inv.grossHalalas)) throw new DomainError("المبلغ يتجاوز المتبقي على الفاتورة", 409);
      const subject = { invoiceId: id, amountHalalas: amount, method, reference: input.reference ?? null };
      const otp = otpEnabled() ? await consumeChallenge(tx, { challengeId: ctx.challengeId, memberId: m.id, action: "procurement.payment", subject }) : null;
      const [pay] = await tx.insert(supplierPayments).values({ supplierInvoiceId: id, amountHalalas: amount, paidOn: new Date().toISOString().slice(0, 10), method, reference: typeof input.reference === "string" ? input.reference.trim().slice(0, 80) || null : null, status: "confirmed", paidBy: m.id, confirmedAt: new Date() }).returning();
      const full = paid + amount === Number(inv.grossHalalas);
      if (full) await tx.update(supplierInvoices).set({ status: "paid" }).where(eq(supplierInvoices.id, id));
      await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, branchId: inv.branchId, action: "supplier.pay", subjectType: "supplier_invoice", subjectId: id, subjectNo: inv.supplierInvoiceNo, after: { ...subject, fullyPaid: full }, otp: evidence(otp), userAgent: ctx.userAgent, contentHash: otp?.subjectHash });
      return { payment: pay!, fullyPaid: full };
    });
  } catch (e) { return friendly(e); }
}

export async function listSupplierInvoices(m: Member) {
  const rows = (await db.execute(sql`select v.id::int as id, v.supplier_invoice_no, v.status, v.invoice_date, v.net_halalas::float8 as net_halalas, v.vat_halalas::float8 as vat_halalas, v.gross_halalas::float8 as gross_halalas,
      v.branch_id::int as branch_id, s.legal_name as supplier, p.po_no, v.match_result,
      coalesce((select sum(amount_halalas) from supplier_payments x where x.supplier_invoice_id = v.id and x.status = 'confirmed'), 0)::float8 as paid_halalas
      from supplier_invoices v join suppliers s on s.id = v.supplier_id left join purchase_orders p on p.id = v.po_id order by v.id desc limit 200`)).rows as { branch_id: number }[];
  return rows.filter((r) => inScope(m, r.branch_id) || (m.role === "branch_manager" && m.branchId === r.branch_id));
}
