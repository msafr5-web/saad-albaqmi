import { pgTable, unique, text, boolean, integer, date, timestamp, uniqueIndex, index, check, primaryKey, numeric, jsonb, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { pk, fkCol, halalas, qty, rate, createdAt, updatedAt, memberFk } from "./_helpers";
import { branches } from "./core";
import { items, itemCategories, warehouses, reorderAlerts } from "./inventory";

// ---------- Suppliers -----------------------------------------------------------------------------------------------
/**
 * Approved supplier register. A supplier may only be 'approved' with a well-formed Saudi VAT number
 * (15 digits, starts and ends with 3). Whether the number is genuinely registered must be checked manually
 * against the tax authority's lookup; the database only enforces the format.
 */
export const suppliers = pgTable("suppliers", {
  id: pk(),
  supplierNo: text("supplier_no").notNull(),
  legalName: text("legal_name").notNull(),
  vatNumber: text("vat_number"),
  commercialRegNo: text("commercial_reg_no"),
  address: text("address"),
  city: text("city"),
  email: text("email"),
  phone: text("phone"),
  iban: text("iban"),
  status: text("status").notNull().default("pending"),
  approvedBy: memberFk("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rating: numeric("rating", { precision: 3, scale: 2, mode: "number" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("suppliers_no_uq").on(t.supplierNo),
  uniqueIndex("suppliers_vat_uq").on(t.vatNumber).where(sql`${t.vatNumber} is not null`),
  check("suppliers_status_ck", sql`${t.status} in ('pending','approved','suspended','blocked')`),
  check("suppliers_vat_format_ck", sql`${t.vatNumber} is null or ${t.vatNumber} ~ '^3[0-9]{13}3$'`),
  check("suppliers_approved_ck", sql`${t.status} <> 'approved' or (${t.vatNumber} is not null and ${t.approvedBy} is not null)`),
  check("suppliers_rating_ck", sql`${t.rating} is null or ${t.rating} between 0 and 5`),
  check("suppliers_iban_ck", sql`${t.iban} is null or ${t.iban} ~ '^SA[0-9]{22}$'`),
]);

/** Which categories a supplier is specialised in (used to suggest RFQ recipients). */
export const supplierCategories = pgTable("supplier_categories", {
  supplierId: fkCol("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
  categoryId: fkCol("category_id").notNull().references(() => itemCategories.id),
}, (t) => [primaryKey({ columns: [t.supplierId, t.categoryId] })]);

// ---------- Purchase requests ---------------------------------------------------------------------------------------
export const purchaseRequests = pgTable("purchase_requests", {
  id: pk(),
  prNo: text("pr_no").notNull(),
  branchId: fkCol("branch_id").notNull().references(() => branches.id),
  warehouseId: fkCol("warehouse_id").notNull().references(() => warehouses.id),
  path: text("path").notNull().default("standard"),                      // standard = RFQ with 3 quotes; direct_small = General Manager path
  source: text("source").notNull().default("manual"),
  alertId: fkCol("alert_id").references(() => reorderAlerts.id),
  reason: text("reason"),
  status: text("status").notNull().default("draft"),
  requestedBy: memberFk("requested_by").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("purchase_requests_no_uq").on(t.prNo),
  index("purchase_requests_branch_status_idx").on(t.branchId, t.status),
  check("purchase_requests_path_ck", sql`${t.path} in ('standard','direct_small')`),
  check("purchase_requests_source_ck", sql`${t.source} in ('alert','manual')`),
  check("purchase_requests_status_ck", sql`${t.status} in ('draft','submitted','rfq','awarded','po_issued','closed','cancelled')`),
]);

export const purchaseRequestLines = pgTable("purchase_request_lines", {
  id: pk(),
  prId: fkCol("pr_id").notNull().references(() => purchaseRequests.id, { onDelete: "cascade" }),
  itemId: fkCol("item_id").notNull().references(() => items.id),
  qty: qty("qty").notNull(),
  notes: text("notes"),
}, (t) => [uniqueIndex("purchase_request_lines_uq").on(t.prId, t.itemId), check("purchase_request_lines_qty_ck", sql`${t.qty} > 0`)]);

// ---------- RFQ, quotes, comparison ---------------------------------------------------------------------------------
export const rfqs = pgTable("rfqs", {
  id: pk(),
  rfqNo: text("rfq_no").notNull(),
  prId: fkCol("pr_id").notNull().references(() => purchaseRequests.id),
  status: text("status").notNull().default("open"),
  deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
  createdBy: memberFk("created_by").notNull(),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("rfqs_no_uq").on(t.rfqNo),
  index("rfqs_pr_idx").on(t.prId),
  check("rfqs_status_ck", sql`${t.status} in ('open','evaluating','awarded','cancelled')`),
]);

export const rfqSuppliers = pgTable("rfq_suppliers", {
  rfqId: fkCol("rfq_id").notNull().references(() => rfqs.id, { onDelete: "cascade" }),
  supplierId: fkCol("supplier_id").notNull().references(() => suppliers.id),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  declinedAt: timestamp("declined_at", { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.rfqId, t.supplierId] })]);

export const quotations = pgTable("quotations", {
  id: pk(),
  rfqId: fkCol("rfq_id").notNull().references(() => rfqs.id),
  supplierId: fkCol("supplier_id").notNull().references(() => suppliers.id),
  supplierVatNumber: text("supplier_vat_number").notNull(),
  quoteRef: text("quote_ref"),
  quoteDate: date("quote_date", { mode: "string" }).notNull(),
  validUntil: date("valid_until", { mode: "string" }),
  deliveryDays: integer("delivery_days"),
  paymentTerms: text("payment_terms"),
  qualityNotes: text("quality_notes"),
  enteredBy: memberFk("entered_by").notNull(),                           // the authorised procurement employee
  status: text("status").notNull().default("submitted"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("quotations_rfq_supplier_uq").on(t.rfqId, t.supplierId),
  check("quotations_vat_ck", sql`${t.supplierVatNumber} ~ '^3[0-9]{13}3$'`),
  check("quotations_status_ck", sql`${t.status} in ('submitted','withdrawn','disqualified')`),
  check("quotations_delivery_ck", sql`${t.deliveryDays} is null or ${t.deliveryDays} >= 0`),
]);

export const quotationLines = pgTable("quotation_lines", {
  id: pk(),
  quotationId: fkCol("quotation_id").notNull().references(() => quotations.id, { onDelete: "cascade" }),
  itemId: fkCol("item_id").notNull().references(() => items.id),
  quantity: qty("quantity").notNull(),
  unitPriceHalalas: halalas("unit_price_halalas").notNull(),             // excluding VAT
  vatRate: rate("vat_rate").notNull().default(15),
  netHalalas: halalas("net_halalas").generatedAlwaysAs(sql`round(quantity * unit_price_halalas)::bigint`),
  vatHalalas: halalas("vat_halalas").generatedAlwaysAs(sql`round(round(quantity * unit_price_halalas) * vat_rate / 100)::bigint`),
}, (t) => [
  uniqueIndex("quotation_lines_uq").on(t.quotationId, t.itemId),
  check("quotation_lines_amounts_ck", sql`${t.quantity} > 0 and ${t.unitPriceHalalas} >= 0 and ${t.vatRate} between 0 and 100`),
]);

/** Technical + commercial scoring per quotation, one row per evaluator. */
export const quotationEvaluations = pgTable("quotation_evaluations", {
  id: pk(),
  quotationId: fkCol("quotation_id").notNull().references(() => quotations.id, { onDelete: "cascade" }),
  evaluatedBy: memberFk("evaluated_by").notNull(),
  technicalScore: integer("technical_score").notNull(),
  qualityScore: integer("quality_score").notNull(),
  commercialScore: integer("commercial_score").notNull(),
  notes: text("notes"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("quotation_evaluations_uq").on(t.quotationId, t.evaluatedBy),
  check("quotation_evaluations_scores_ck", sql`${t.technicalScore} between 0 and 100 and ${t.qualityScore} between 0 and 100 and ${t.commercialScore} between 0 and 100`),
]);

/**
 * Exceptions to the "three quotes always" rule (sole supplier, suppliers did not reply before the deadline) and the
 * small direct-purchase path. Every exception carries a written reason and a senior approver.
 */
export const procurementExceptions = pgTable("procurement_exceptions", {
  id: pk(),
  prId: fkCol("pr_id").notNull().references(() => purchaseRequests.id),
  exceptionType: text("exception_type").notNull(),
  reason: text("reason").notNull(),
  requestedBy: memberFk("requested_by").notNull(),
  approvedBy: memberFk("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  check("procurement_exceptions_type_ck", sql`${t.exceptionType} in ('single_source','late_responses','direct_small','emergency')`),
  check("procurement_exceptions_reason_ck", sql`length(trim(${t.reason})) >= 10`),
  check("procurement_exceptions_approver_ck", sql`${t.approvedBy} is null or ${t.approvedBy} <> ${t.requestedBy}`),
]);

/** The supplier chosen for an RFQ. Choosing anything but the lowest price requires a written justification. */
export const rfqAwards = pgTable("rfq_awards", {
  rfqId: fkCol("rfq_id").primaryKey().references(() => rfqs.id),
  quotationId: fkCol("quotation_id").notNull().references(() => quotations.id),
  isLowestPrice: boolean("is_lowest_price").notNull(),
  justification: text("justification"),
  exceptionId: fkCol("exception_id").references(() => procurementExceptions.id),
  recommendedBy: memberFk("recommended_by").notNull(),
  approvedBy: memberFk("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  check("rfq_awards_justification_ck", sql`${t.isLowestPrice} or length(trim(coalesce(${t.justification}, ''))) >= 10`),
  check("rfq_awards_approver_ck", sql`${t.approvedBy} is null or ${t.approvedBy} <> ${t.recommendedBy}`),
]);

// ---------- Purchase orders -----------------------------------------------------------------------------------------
/**
 * Purchase order issued in the entity's name. It is prepared by the procurement specialist (OTP), approved by the
 * branch manager (OTP) or the delegate, and only then sent. Segregation of duties is enforced by CHECK constraints and
 * triggers: approver <> preparer, no PO without a supplier VAT number, standard path needs an award (or exception).
 */
export const purchaseOrders = pgTable("purchase_orders", {
  id: pk(),
  poNo: text("po_no").notNull(),
  version: integer("version").notNull().default(1),
  supersedesPoId: fkCol("supersedes_po_id").references((): AnyPgColumn => purchaseOrders.id),
  prId: fkCol("pr_id").notNull().references(() => purchaseRequests.id),
  rfqId: fkCol("rfq_id").references(() => rfqs.id),
  exceptionId: fkCol("exception_id").references(() => procurementExceptions.id),
  branchId: fkCol("branch_id").notNull().references(() => branches.id),
  warehouseId: fkCol("warehouse_id").notNull().references(() => warehouses.id),
  supplierId: fkCol("supplier_id").notNull().references(() => suppliers.id),
  entityName: text("entity_name").notNull(),
  entityVatNumber: text("entity_vat_number").notNull(),
  supplierVatNumber: text("supplier_vat_number").notNull(),
  issueDate: date("issue_date", { mode: "string" }).notNull(),
  deliveryDate: date("delivery_date", { mode: "string" }),
  terms: text("terms"),
  status: text("status").notNull().default("draft"),
  netHalalas: halalas("net_halalas").notNull().default(0),
  vatHalalas: halalas("vat_halalas").notNull().default(0),
  grossHalalas: halalas("gross_halalas").generatedAlwaysAs(sql`net_halalas + vat_halalas`),
  preparedBy: memberFk("prepared_by").notNull(),
  preparedAt: timestamp("prepared_at", { withTimezone: true }),
  approvedBy: memberFk("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedViaDelegationId: fkCol("approved_via_delegation_id"),          // FK to approval_delegations added in migration 0003
  sentAt: timestamp("sent_at", { withTimezone: true }),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  documentHash: text("document_hash"),                                   // sha256 of the issued PDF/content; OTP is bound to it
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("purchase_orders_no_version_uq").on(t.poNo, t.version),
  index("purchase_orders_supplier_idx").on(t.supplierId),
  index("purchase_orders_branch_status_idx").on(t.branchId, t.status),
  check("purchase_orders_status_ck", sql`${t.status} in ('draft','prepared','approved','sent','acknowledged','partially_received','received','closed','cancelled')`),
  check("purchase_orders_supplier_vat_ck", sql`${t.supplierVatNumber} ~ '^3[0-9]{13}3$'`),
  check("purchase_orders_entity_vat_ck", sql`${t.entityVatNumber} ~ '^3[0-9]{13}3$'`),
  check("purchase_orders_amounts_ck", sql`${t.netHalalas} >= 0 and ${t.vatHalalas} >= 0`),
  check("purchase_orders_segregation_ck", sql`${t.approvedBy} is null or ${t.approvedBy} <> ${t.preparedBy}`),
  check("purchase_orders_approval_ck", sql`${t.status} not in ('approved','sent','acknowledged','partially_received','received','closed') or (${t.approvedBy} is not null and ${t.approvedAt} is not null)`),
  check("purchase_orders_source_ck", sql`${t.rfqId} is not null or ${t.exceptionId} is not null`),
  check("purchase_orders_version_ck", sql`${t.version} >= 1 and (${t.version} = 1) = (${t.supersedesPoId} is null)`),
]);

export const purchaseOrderLines = pgTable("purchase_order_lines", {
  id: pk(),
  poId: fkCol("po_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  lineNo: integer("line_no").notNull(),
  itemId: fkCol("item_id").notNull().references(() => items.id),
  description: text("description"),
  quantity: qty("quantity").notNull(),
  unitPriceHalalas: halalas("unit_price_halalas").notNull(),
  vatRate: rate("vat_rate").notNull().default(15),
  netHalalas: halalas("net_halalas").generatedAlwaysAs(sql`round(quantity * unit_price_halalas)::bigint`),
  vatHalalas: halalas("vat_halalas").generatedAlwaysAs(sql`round(round(quantity * unit_price_halalas) * vat_rate / 100)::bigint`),
}, (t) => [
  uniqueIndex("purchase_order_lines_no_uq").on(t.poId, t.lineNo),
  check("purchase_order_lines_amounts_ck", sql`${t.quantity} > 0 and ${t.unitPriceHalalas} >= 0 and ${t.vatRate} between 0 and 100`),
]);

// ---------- Receiving, invoices, three-way match --------------------------------------------------------------------
export const goodsReceipts = pgTable("goods_receipts", {
  id: pk(),
  grnNo: text("grn_no").notNull(),
  poId: fkCol("po_id").notNull().references(() => purchaseOrders.id),
  warehouseId: fkCol("warehouse_id").notNull().references(() => warehouses.id),
  status: text("status").notNull().default("draft"),
  receivedBy: memberFk("received_by").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  deliveryNoteNo: text("delivery_note_no"),
  notes: text("notes"),
}, (t) => [
  uniqueIndex("goods_receipts_no_uq").on(t.grnNo),
  index("goods_receipts_po_idx").on(t.poId),
  check("goods_receipts_status_ck", sql`${t.status} in ('draft','confirmed','cancelled')`),
]);

export const goodsReceiptLines = pgTable("goods_receipt_lines", {
  id: pk(),
  grnId: fkCol("grn_id").notNull().references(() => goodsReceipts.id, { onDelete: "cascade" }),
  poLineId: fkCol("po_line_id").notNull().references(() => purchaseOrderLines.id),
  qtyReceived: qty("qty_received").notNull(),
  qtyAccepted: qty("qty_accepted").notNull(),
  qtyRejected: qty("qty_rejected").generatedAlwaysAs(sql`qty_received - qty_accepted`),
  qualityResult: text("quality_result").notNull().default("accepted"),
  qualityNotes: text("quality_notes"),
}, (t) => [
  uniqueIndex("goods_receipt_lines_uq").on(t.grnId, t.poLineId),
  check("goods_receipt_lines_qty_ck", sql`${t.qtyReceived} > 0 and ${t.qtyAccepted} >= 0 and ${t.qtyAccepted} <= ${t.qtyReceived}`),
  check("goods_receipt_lines_quality_ck", sql`${t.qualityResult} in ('accepted','accepted_with_notes','rejected')`),
  check("goods_receipt_lines_rejected_ck", sql`${t.qualityResult} <> 'rejected' or ${t.qtyAccepted} = 0`),
]);

export const supplierInvoices = pgTable("supplier_invoices", {
  id: pk(),
  supplierId: fkCol("supplier_id").notNull().references(() => suppliers.id),
  supplierInvoiceNo: text("supplier_invoice_no").notNull(),
  supplierVatNumber: text("supplier_vat_number").notNull(),
  poId: fkCol("po_id").references(() => purchaseOrders.id),
  branchId: fkCol("branch_id").notNull().references(() => branches.id),
  invoiceDate: date("invoice_date", { mode: "string" }).notNull(),
  netHalalas: halalas("net_halalas").notNull(),
  vatHalalas: halalas("vat_halalas").notNull(),
  grossHalalas: halalas("gross_halalas").generatedAlwaysAs(sql`net_halalas + vat_halalas`),
  status: text("status").notNull().default("received"),
  matchResult: jsonb("match_result").$type<Record<string, unknown>>(),
  matchedAt: timestamp("matched_at", { withTimezone: true }),
  approvedBy: memberFk("approved_by"),
  createdBy: memberFk("created_by").notNull(),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("supplier_invoices_dup_uq").on(t.supplierId, t.supplierInvoiceNo),   // the same bill can never be booked twice
  index("supplier_invoices_po_idx").on(t.poId),
  check("supplier_invoices_vat_ck", sql`${t.supplierVatNumber} ~ '^3[0-9]{13}3$'`),
  check("supplier_invoices_amounts_ck", sql`${t.netHalalas} >= 0 and ${t.vatHalalas} >= 0`),
  check("supplier_invoices_status_ck", sql`${t.status} in ('received','matched','mismatch','approved','paid','disputed')`),
  check("supplier_invoices_approved_ck", sql`${t.status} not in ('approved','paid') or ${t.approvedBy} is not null`),
]);

export const supplierInvoiceLines = pgTable("supplier_invoice_lines", {
  id: pk(),
  invoiceId: fkCol("invoice_id").notNull().references(() => supplierInvoices.id, { onDelete: "cascade" }),
  poLineId: fkCol("po_line_id").references(() => purchaseOrderLines.id),
  itemId: fkCol("item_id").references(() => items.id),
  description: text("description").notNull(),
  quantity: qty("quantity").notNull(),
  unitPriceHalalas: halalas("unit_price_halalas").notNull(),
  vatRate: rate("vat_rate").notNull().default(15),
  netHalalas: halalas("net_halalas").generatedAlwaysAs(sql`round(quantity * unit_price_halalas)::bigint`),
  vatHalalas: halalas("vat_halalas").generatedAlwaysAs(sql`round(round(quantity * unit_price_halalas) * vat_rate / 100)::bigint`),
  classification: text("classification").notNull().default("expense"),    // expense (petty/operating), stock (consumable), asset
}, (t) => [
  check("supplier_invoice_lines_amounts_ck", sql`${t.quantity} > 0 and ${t.unitPriceHalalas} >= 0 and ${t.vatRate} between 0 and 100`),
  check("supplier_invoice_lines_class_ck", sql`${t.classification} in ('expense','stock','asset')`),
]);

/** Configurable three-way-match tolerance; the most specific row (category) wins, NULL category = default. */
export const matchTolerances = pgTable("match_tolerances", {
  id: pk(),
  categoryId: fkCol("category_id").references(() => itemCategories.id),
  pricePercent: rate("price_percent").notNull().default(0),
  qtyPercent: rate("qty_percent").notNull().default(0),
  validFrom: date("valid_from", { mode: "string" }).notNull(),
  setBy: memberFk("set_by"),
}, (t) => [
  unique("match_tolerances_uq").on(t.categoryId, t.validFrom).nullsNotDistinct(),
  check("match_tolerances_ck", sql`${t.pricePercent} between 0 and 100 and ${t.qtyPercent} between 0 and 100`),
]);

export const supplierPayments = pgTable("supplier_payments", {
  id: pk(),
  supplierInvoiceId: fkCol("supplier_invoice_id").notNull().references(() => supplierInvoices.id),
  amountHalalas: halalas("amount_halalas").notNull(),
  paidOn: date("paid_on", { mode: "string" }).notNull(),
  method: text("method").notNull(),
  reference: text("reference"),
  status: text("status").notNull().default("pending_otp"),
  paidBy: memberFk("paid_by").notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
}, (t) => [
  check("supplier_payments_amount_ck", sql`${t.amountHalalas} > 0`),
  check("supplier_payments_method_ck", sql`${t.method} in ('bank_transfer','cheque','cash')`),
  check("supplier_payments_status_ck", sql`${t.status} in ('pending_otp','confirmed','reversed')`),
]);

// ---------- Purchasing limits (set by the General Manager) -----------------------------------------------------------
/** Weekly or monthly purchase ceilings per branch (branch_id NULL = every branch). Set by the General Manager. */
export const purchaseLimits = pgTable("purchase_limits", {
  id: pk(),
  branchId: fkCol("branch_id").references(() => branches.id),
  period: text("period").notNull(),
  maxAmountHalalas: halalas("max_amount_halalas").notNull(),
  validFrom: date("valid_from", { mode: "string" }).notNull(),
  validTo: date("valid_to", { mode: "string" }),
  setBy: memberFk("set_by").notNull(),
}, (t) => [
  check("purchase_limits_period_ck", sql`${t.period} in ('weekly','monthly')`),
  check("purchase_limits_amount_ck", sql`${t.maxAmountHalalas} > 0`),
]);

/** Conditions for the small direct-purchase path; thresholds are placeholders until the General Manager sets them. */
export const directPurchasePolicies = pgTable("direct_purchase_policies", {
  id: pk(),
  maxAmountHalalas: halalas("max_amount_halalas").notNull(),
  maxQty: qty("max_qty"),
  monthlyCapHalalas: halalas("monthly_cap_halalas"),
  antiSplitWindowDays: integer("anti_split_window_days").notNull().default(30),
  conditions: text("conditions"),
  validFrom: date("valid_from", { mode: "string" }).notNull(),
  setBy: memberFk("set_by").notNull(),
}, (t) => [check("direct_purchase_policies_ck", sql`${t.maxAmountHalalas} > 0 and ${t.antiSplitWindowDays} between 1 and 365`)]);

