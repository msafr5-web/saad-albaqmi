import { pgTable, unique, text, boolean, integer, date, timestamp, uniqueIndex, index, check, primaryKey, numeric, uuid, jsonb, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { pk, fkCol, halalas, qty, rate, createdAt, memberFk } from "./_helpers";
import { branches } from "./core";
import { students, diplomas, subjects } from "./academic";
import { electricityMeters } from "./academic";

/** VAT rate catalogue (15% standard in KSA). Documents snapshot the rate they used; this table never rewrites history. */
export const taxRates = pgTable("tax_rates", {
  id: pk(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  rate: rate("rate").notNull(),
  category: text("category").notNull().default("standard"),
  validFrom: date("valid_from", { mode: "string" }).notNull(),
  validTo: date("valid_to", { mode: "string" }),
}, (t) => [
  uniqueIndex("tax_rates_code_from_uq").on(t.code, t.validFrom),
  check("tax_rates_rate_ck", sql`${t.rate} between 0 and 100`),
  check("tax_rates_category_ck", sql`${t.category} in ('standard','zero_rated','exempt')`),
  check("tax_rates_dates_ck", sql`${t.validTo} is null or ${t.validTo} >= ${t.validFrom}`),
]);

// ---------- Sales (student fees) ------------------------------------------------------------------------------------
/**
 * Sales tax invoice. Trial period: amounts and VAT are displayed legally but not transmitted to ZATCA
 * (zatca_status = 'not_submitted'). The uuid/icv/previous hash columns are reserved for the later e-invoicing phase.
 */
export const salesInvoices = pgTable("sales_invoices", {
  id: pk(),
  invoiceNo: text("invoice_no").notNull(),
  invoiceUuid: uuid("invoice_uuid").notNull().defaultRandom(),
  branchId: fkCol("branch_id").notNull().references(() => branches.id),
  studentId: fkCol("student_id").references(() => students.id),
  customerName: text("customer_name").notNull(),
  customerVatNumber: text("customer_vat_number"),                       // required for business buyers (standard tax invoice)
  invoiceType: text("invoice_type").notNull().default("simplified"),
  issueDate: date("issue_date", { mode: "string" }).notNull(),
  status: text("status").notNull().default("draft"),
  netHalalas: halalas("net_halalas").notNull().default(0),
  vatHalalas: halalas("vat_halalas").notNull().default(0),
  grossHalalas: halalas("gross_halalas").generatedAlwaysAs(sql`net_halalas + vat_halalas`),
  zatcaStatus: text("zatca_status").notNull().default("not_submitted"),
  zatcaHash: text("zatca_hash"),
  createdBy: memberFk("created_by"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("sales_invoices_no_uq").on(t.invoiceNo),
  uniqueIndex("sales_invoices_uuid_uq").on(t.invoiceUuid),
  index("sales_invoices_student_idx").on(t.studentId),
  index("sales_invoices_branch_date_idx").on(t.branchId, t.issueDate),
  check("sales_invoices_type_ck", sql`${t.invoiceType} in ('standard','simplified','credit_note')`),
  check("sales_invoices_status_ck", sql`${t.status} in ('draft','issued','cancelled')`),
  check("sales_invoices_amounts_ck", sql`${t.invoiceType} = 'credit_note' or (${t.netHalalas} >= 0 and ${t.vatHalalas} >= 0)`),
  check("sales_invoices_vat_ck", sql`${t.customerVatNumber} is null or ${t.customerVatNumber} ~ '^3[0-9]{13}3$'`),
  check("sales_invoices_standard_ck", sql`${t.invoiceType} <> 'standard' or ${t.customerVatNumber} is not null`),
  check("sales_invoices_zatca_ck", sql`${t.zatcaStatus} in ('not_submitted','reported','cleared','rejected')`),
]);

export const salesInvoiceLines = pgTable("sales_invoice_lines", {
  id: pk(),
  invoiceId: fkCol("invoice_id").notNull().references(() => salesInvoices.id, { onDelete: "cascade" }),
  lineNo: integer("line_no").notNull(),
  description: text("description").notNull(),
  diplomaId: fkCol("diploma_id").references(() => diplomas.id),
  subjectId: fkCol("subject_id").references(() => subjects.id),
  quantity: qty("quantity").notNull().default(1),
  unitPriceHalalas: halalas("unit_price_halalas").notNull(),            // excluding VAT
  discountHalalas: halalas("discount_halalas").notNull().default(0),
  vatRate: rate("vat_rate").notNull().default(15),
  netHalalas: halalas("net_halalas").generatedAlwaysAs(sql`round(quantity * unit_price_halalas)::bigint - discount_halalas`),
  vatHalalas: halalas("vat_halalas").generatedAlwaysAs(sql`round((round(quantity * unit_price_halalas)::bigint - discount_halalas) * vat_rate / 100)::bigint`),
}, (t) => [
  uniqueIndex("sales_invoice_lines_no_uq").on(t.invoiceId, t.lineNo),
  check("sales_invoice_lines_amounts_ck", sql`${t.quantity} > 0 and ${t.unitPriceHalalas} >= 0 and ${t.discountHalalas} >= 0 and ${t.vatRate} between 0 and 100`),
]);

// ---------- Installments and receipts -------------------------------------------------------------------------------
export const installments = pgTable("installments", {
  id: pk(),
  studentId: fkCol("student_id").notNull().references(() => students.id),
  salesInvoiceId: fkCol("sales_invoice_id").references(() => salesInvoices.id),
  seq: integer("seq").notNull(),
  dueDate: date("due_date", { mode: "string" }).notNull(),
  amountHalalas: halalas("amount_halalas").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("installments_student_seq_uq").on(t.studentId, t.seq),
  index("installments_due_idx").on(t.dueDate).where(sql`${t.status} in ('pending','partial')`),
  check("installments_amount_ck", sql`${t.amountHalalas} > 0`),
  check("installments_status_ck", sql`${t.status} in ('pending','partial','paid','cancelled')`),
]);

/**
 * Money received from a student. A payment is created as 'pending_otp' and becomes 'confirmed' only when the collector
 * verifies the OTP (security.otp_challenges). Confirmed rows are immutable; corrections are reversal rows.
 */
export const payments = pgTable("payments", {
  id: pk(),
  receiptNo: text("receipt_no").notNull(),
  branchId: fkCol("branch_id").notNull().references(() => branches.id),
  studentId: fkCol("student_id").notNull().references(() => students.id),
  amountHalalas: halalas("amount_halalas").notNull(),
  paidOn: date("paid_on", { mode: "string" }).notNull(),
  method: text("method").notNull(),
  reference: text("reference"),
  status: text("status").notNull().default("pending_otp"),
  collectedBy: memberFk("collected_by").notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  reversesPaymentId: fkCol("reverses_payment_id").references((): AnyPgColumn => payments.id),
  reversalReason: text("reversal_reason"),
  receiptEmailedAt: timestamp("receipt_emailed_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("payments_receipt_no_uq").on(t.receiptNo),
  index("payments_student_idx").on(t.studentId, t.paidOn),
  index("payments_branch_date_idx").on(t.branchId, t.paidOn),
  uniqueIndex("payments_one_reversal_uq").on(t.reversesPaymentId).where(sql`${t.reversesPaymentId} is not null`),
  check("payments_amount_ck", sql`${t.amountHalalas} > 0`),
  check("payments_method_ck", sql`${t.method} in ('cash','bank_transfer','card','pos')`),
  check("payments_status_ck", sql`${t.status} in ('pending_otp','confirmed','reversed','rejected')`),
  check("payments_confirmed_ck", sql`${t.status} <> 'confirmed' or ${t.confirmedAt} is not null`),
  check("payments_reversal_ck", sql`${t.reversesPaymentId} is null or ${t.reversalReason} is not null`),
]);

export const paymentAllocations = pgTable("payment_allocations", {
  paymentId: fkCol("payment_id").notNull().references(() => payments.id),
  installmentId: fkCol("installment_id").notNull().references(() => installments.id),
  amountHalalas: halalas("amount_halalas").notNull(),
}, (t) => [primaryKey({ columns: [t.paymentId, t.installmentId] }), check("payment_allocations_amount_ck", sql`${t.amountHalalas} > 0`)]);

// ---------- Expenses, utilities and budgets -------------------------------------------------------------------------
export const expenseCategories = pgTable("expense_categories", {
  id: pk(),
  parentId: fkCol("parent_id").references((): AnyPgColumn => expenseCategories.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  isPetty: boolean("is_petty").notNull().default(false),               // counts toward petty-cash (nathriyat) reports
}, (t) => [uniqueIndex("expense_categories_code_uq").on(t.code)]);

/** Operating expense. Revenue is in `payments`; both are confirmed by OTP. Source documents link back via source_*. */
export const expenses = pgTable("expenses", {
  id: pk(),
  expenseNo: text("expense_no").notNull(),
  branchId: fkCol("branch_id").notNull().references(() => branches.id),
  categoryId: fkCol("category_id").notNull().references(() => expenseCategories.id),
  expenseDate: date("expense_date", { mode: "string" }).notNull(),
  description: text("description").notNull(),
  netHalalas: halalas("net_halalas").notNull(),
  vatHalalas: halalas("vat_halalas").notNull().default(0),
  grossHalalas: halalas("gross_halalas").generatedAlwaysAs(sql`net_halalas + vat_halalas`),
  source: text("source").notNull().default("manual"),
  supplierInvoiceId: fkCol("supplier_invoice_id"),                      // FK added in procurement.ts
  status: text("status").notNull().default("pending_otp"),
  createdBy: memberFk("created_by").notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  reversesExpenseId: fkCol("reverses_expense_id").references((): AnyPgColumn => expenses.id),
  reversalReason: text("reversal_reason"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("expenses_no_uq").on(t.expenseNo),
  index("expenses_branch_date_idx").on(t.branchId, t.expenseDate),
  index("expenses_category_idx").on(t.categoryId, t.expenseDate),
  check("expenses_amounts_ck", sql`${t.netHalalas} >= 0 and ${t.vatHalalas} >= 0`),
  check("expenses_source_ck", sql`${t.source} in ('manual','supplier_invoice','payroll','utility')`),
  check("expenses_status_ck", sql`${t.status} in ('pending_otp','confirmed','reversed','rejected')`),
  check("expenses_confirmed_ck", sql`${t.status} <> 'confirmed' or ${t.confirmedAt} is not null`),
]);

/** Electricity bills, one per meter per month (prevents the duplicate-bill problem found in the review). */
export const utilityInvoices = pgTable("utility_invoices", {
  id: pk(),
  branchId: fkCol("branch_id").notNull().references(() => branches.id),
  meterId: fkCol("meter_id").notNull().references(() => electricityMeters.id),
  billMonth: date("bill_month", { mode: "string" }).notNull(),
  kwh: numeric("kwh", { precision: 14, scale: 2, mode: "number" }).notNull(),
  netHalalas: halalas("net_halalas").notNull(),
  vatHalalas: halalas("vat_halalas").notNull().default(0),
  billNo: text("bill_no"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("utility_invoices_meter_month_uq").on(t.meterId, t.billMonth),
  check("utility_invoices_month_ck", sql`extract(day from ${t.billMonth}) = 1`),
  check("utility_invoices_amounts_ck", sql`${t.kwh} >= 0 and ${t.netHalalas} >= 0 and ${t.vatHalalas} >= 0`),
]);

/** Monthly budget per branch, optionally per expense category (NULL category = branch total). */
export const branchBudgets = pgTable("branch_budgets", {
  id: pk(),
  branchId: fkCol("branch_id").notNull().references(() => branches.id),
  periodMonth: date("period_month", { mode: "string" }).notNull(),
  categoryId: fkCol("category_id").references(() => expenseCategories.id),
  amountHalalas: halalas("amount_halalas").notNull(),
  warnAtPercent: integer("warn_at_percent").notNull().default(80),
  approvedBy: memberFk("approved_by"),
  createdAt: createdAt(),
}, (t) => [
  unique("branch_budgets_uq").on(t.branchId, t.periodMonth, t.categoryId).nullsNotDistinct(),
  check("branch_budgets_month_ck", sql`extract(day from ${t.periodMonth}) = 1`),
  check("branch_budgets_amount_ck", sql`${t.amountHalalas} >= 0 and ${t.warnAtPercent} between 1 and 100`),
]);

/** Per-cost-run snapshots that the cost engine may persist (frozen policy version + result), replacing recompute-on-read for reports. */
export const costReportSnapshots = pgTable("cost_report_snapshots", {
  id: pk(),
  periodFrom: date("period_from", { mode: "string" }).notNull(),
  periodTo: date("period_to", { mode: "string" }).notNull(),
  policyVersion: integer("policy_version").notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull(),
  createdBy: memberFk("created_by"),
  createdAt: createdAt(),
}, (t) => [index("cost_report_snapshots_period_idx").on(t.periodFrom, t.periodTo)]);
