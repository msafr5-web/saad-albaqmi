import { and, asc, eq, sql } from "drizzle-orm";
import { db, branchBudgets, salesInvoices, salesInvoiceLines } from "@workspace/db";
import type { Member } from "./education-access";
import { DomainError } from "./education-validation";
import { consumeChallenge, otpEnabled } from "./otp";
import { recordAudit } from "./audit";

/**
 * Monthly budgets with alerts, weekly expense view, sales invoices with VAT (inclusive/exclusive pricing) and the VAT report.
 * Trial period: VAT is DISPLAYED in legal form (net, VAT, gross; seller/buyer VAT numbers); nothing is sent to the tax authority.
 */
const BUDGET_WRITE: string[] = ["super_admin", "finance"];
const READ: string[] = ["super_admin", "finance", "branch_manager"];
const INVOICE_WRITE: string[] = ["super_admin", "finance"];
const ORG_WIDE: string[] = ["finance"];
const inScope = (m: Member, branchId: number) => m.role === "super_admin" || m.branchId === branchId || (ORG_WIDE.includes(m.role) && m.branchId == null);
const deny = (msg = "ليست لديك صلاحية لهذه العملية"): never => { throw new DomainError(msg, 403); };
export const canReadFiscal = (m: Member) => READ.includes(m.role);
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const pgMessage = (e: unknown) => String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message ?? "");
function friendly(e: unknown): never {
  if (e instanceof DomainError) throw e;
  const msg = pgMessage(e);
  if (/sales_invoices_standard_ck/.test(msg)) throw new DomainError("الفاتورة الضريبية القياسية تتطلب الرقم الضريبي للمشتري", 409);
  if (/sales_invoices_vat_ck/.test(msg)) throw new DomainError("الرقم الضريبي للمشتري غير صحيح (15 رقمًا يبدأ وينتهي بالرقم 3)", 409);
  if (/branch_budgets_uq/.test(msg)) throw new DomainError("توجد ميزانية لهذا الفرع والشهر والفئة", 409);
  throw e;
}
const month = (v: unknown) => { if (typeof v !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw new DomainError("الشهر غير صحيح (YYYY-MM)"); return `${v}-01`; };
const dateStr = (v: unknown, what: string) => { if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new DomainError(`${what} غير صحيح`); return v; };
const evidence = (o: Awaited<ReturnType<typeof consumeChallenge>> | null) => (o ? { challengeId: o.challengeId, sentAt: o.sentAt, verifiedAt: o.verifiedAt, sentIp: o.sentIp, verifiedIp: o.verifiedIp } : null);

// ---------- Budgets --------------------------------------------------------------------------------------------------
export async function setBudget(m: Member, i: { branchId?: unknown; month?: unknown; categoryId?: unknown; amountHalalas?: unknown; warnAtPercent?: unknown }) {
  if (!BUDGET_WRITE.includes(m.role)) deny("الميزانية للمالية والمدير العام");
  const periodMonth = month(i.month);
  if (!Number.isInteger(i.branchId)) throw new DomainError("اختر الفرع");
  if (!Number.isInteger(i.amountHalalas) || (i.amountHalalas as number) < 0) throw new DomainError("المبلغ غير صحيح");
  const warn = i.warnAtPercent == null ? 80 : Number(i.warnAtPercent);
  if (!Number.isInteger(warn) || warn < 1 || warn > 100) throw new DomainError("نسبة التنبيه من 1 إلى 100");
  const categoryId = i.categoryId == null || i.categoryId === "" ? null : Number(i.categoryId);
  if (!inScope(m, i.branchId as number)) deny("الفرع خارج نطاقك");
  try {
    return await db.transaction(async (tx) => {
      const [prev] = await tx.select().from(branchBudgets).where(and(eq(branchBudgets.branchId, i.branchId as number), eq(branchBudgets.periodMonth, periodMonth),
        categoryId == null ? sql`${branchBudgets.categoryId} is null` : eq(branchBudgets.categoryId, categoryId)));
      const values = { amountHalalas: i.amountHalalas as number, warnAtPercent: warn, approvedBy: m.id };
      const [row] = prev ? await tx.update(branchBudgets).set(values).where(eq(branchBudgets.id, prev.id)).returning()
        : await tx.insert(branchBudgets).values({ branchId: i.branchId as number, periodMonth, categoryId, ...values }).returning();
      await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, branchId: i.branchId as number, action: "budget.set", subjectType: "budget", subjectId: row!.id, subjectNo: `${i.month}`, before: prev ? { amount: prev.amountHalalas } : null, after: { amount: values.amountHalalas, categoryId } });
      await budgetAlerts(tx, i.branchId as number, periodMonth);
      return row!;
    });
  } catch (e) { return friendly(e); }
}

export async function budgetStatus(m: Member, ym: unknown) {
  if (!canReadFiscal(m)) deny();
  const periodMonth = month(ym);
  const rows = (await db.execute(sql`
    select b.id::int as budget_id, v.branch_id::int as branch_id, br.name as branch, v.category_id::int as category_id, c.name as category,
           v.budget_halalas::float8 as budget_halalas, v.actual_halalas::float8 as actual_halalas, v.committed_halalas::float8 as committed_halalas, v.warn_at_percent
      from v_branch_budget_status v join branches br on br.id = v.branch_id join branch_budgets b on b.branch_id = v.branch_id and b.period_month = v.period_month and b.category_id is not distinct from v.category_id
      left join expense_categories c on c.id = v.category_id where v.period_month = ${periodMonth}::date order by br.name, c.name nulls first`)).rows as { branch_id: number; budget_halalas: number; actual_halalas: number; committed_halalas: number; warn_at_percent: number }[];
  return rows.filter((r) => inScope(m, r.branch_id) || (m.role === "branch_manager" && m.branchId === r.branch_id)).map((r) => {
    const used = r.actual_halalas + r.committed_halalas;
    const pct = r.budget_halalas > 0 ? (used / r.budget_halalas) * 100 : 0;
    return { ...r, used_halalas: used, available_halalas: r.budget_halalas - used, percent: Math.round(pct * 10) / 10, level: pct >= 100 ? "over" : pct >= r.warn_at_percent ? "warn" : "ok" };
  });
}

/** One notification per level per budget when spending (actual + committed) crosses the warning threshold or the budget. */
export async function budgetAlerts(tx: Tx, branchId: number, periodMonth: string) {
  const r = (await tx.execute(sql`select b.id::int as id, b.amount_halalas::float8 as budget, b.warn_at_percent as warn,
      coalesce((select sum(e.net_halalas) from expenses e where e.branch_id = b.branch_id and e.status = 'confirmed' and e.reverses_expense_id is null and date_trunc('month', e.expense_date) = b.period_month), 0)::float8 as actual,
      coalesce((select sum(po.net_halalas) from purchase_orders po where po.branch_id = b.branch_id and date_trunc('month', po.issue_date) = b.period_month and po.status in ('approved','sent','acknowledged','partially_received','received')
         and not exists (select 1 from supplier_invoices si where si.po_id = po.id and si.status in ('approved','paid'))), 0)::float8 as committed
      from branch_budgets b where b.branch_id = ${branchId} and b.period_month = ${periodMonth}::date and b.category_id is null`)).rows[0] as { id: number; budget: number; warn: number; actual: number; committed: number } | undefined;
  if (!r || r.budget <= 0) return;
  const pct = ((r.actual + r.committed) / r.budget) * 100;
  const level = pct >= 100 ? "over" : pct >= r.warn ? "warn" : null;
  if (!level) return;
  const title = level === "over" ? "تجاوز ميزانية الفرع الشهرية" : "اقتراب من ميزانية الفرع الشهرية";
  await tx.execute(sql`insert into notifications (member_id, type, title, body, link, subject_type, subject_id)
    select m.id, 'budget_alert', ${title}, ${`${periodMonth.slice(0, 7)}: الاستهلاك ${pct.toFixed(1)}% من الميزانية (يشمل أوامر الشراء المعتمدة غير المفوترة).`}, '/fiscal', ${"budget_" + level}, ${r.id}
      from org_members m where m.status = 'active' and (m.role in ('super_admin','finance') or (m.role = 'branch_manager' and m.branch_id = ${branchId}))
       and not exists (select 1 from notifications n where n.subject_type = ${"budget_" + level} and n.subject_id = ${r.id} and n.member_id = m.id)`);
}

// ---------- Weekly expenses ------------------------------------------------------------------------------------------
/** Confirmed expenses per ISO week and category. (Electricity allocation stays monthly: the bill is monthly.) */
export async function weeklyExpenses(m: Member, q: { branchId?: unknown; from?: unknown; to?: unknown }) {
  if (!canReadFiscal(m)) deny();
  const from = dateStr(q.from, "من"), to = dateStr(q.to, "إلى");
  const branchId = q.branchId == null || q.branchId === "" ? null : Number(q.branchId);
  if (branchId != null && !inScope(m, branchId)) deny("الفرع خارج نطاقك");
  const rows = (await db.execute(sql`
    select to_char(date_trunc('week', e.expense_date), 'YYYY-MM-DD') as week_start, e.branch_id::int as branch_id, br.name as branch, c.name as category, c.is_petty,
           sum(e.net_halalas)::float8 as net_halalas, sum(e.vat_halalas)::float8 as vat_halalas, count(*)::int as entries
      from expenses e join expense_categories c on c.id = e.category_id join branches br on br.id = e.branch_id
     where e.status = 'confirmed' and e.reverses_expense_id is null and e.expense_date between ${from}::date and ${to}::date and (${branchId}::bigint is null or e.branch_id = ${branchId})
     group by 1, 2, 3, 4, 5 order by 1 desc, 3, 4`)).rows as { branch_id: number }[];
  return rows.filter((r) => inScope(m, r.branch_id) || (m.role === "branch_manager" && m.branchId === r.branch_id));
}

// ---------- Sales invoices and VAT ------------------------------------------------------------------------------------
type LineInput = { description?: unknown; quantity?: unknown; unitPriceHalalas?: unknown; vatRate?: unknown; discountHalalas?: unknown };
/** pricesIncludeVat: the entered unit prices already contain VAT (the specialist's choice); net, VAT and gross are always derived. */
export async function createSalesInvoice(m: Member, i: { branchId?: unknown; customerName?: unknown; customerVatNumber?: unknown; invoiceType?: unknown; issueDate?: unknown; pricesIncludeVat?: unknown; lines?: unknown }) {
  if (!INVOICE_WRITE.includes(m.role)) deny("فواتير المبيعات للمالية والمدير العام");
  if (!Number.isInteger(i.branchId) || !inScope(m, i.branchId as number)) throw new DomainError("اختر الفرع");
  const customerName = typeof i.customerName === "string" ? i.customerName.trim() : "";
  if (!customerName || customerName.length > 200) throw new DomainError("اسم العميل مطلوب");
  const type = typeof i.invoiceType === "string" ? i.invoiceType : "simplified";
  if (!["standard", "simplified"].includes(type)) throw new DomainError("نوع الفاتورة غير صحيح");
  const lines = Array.isArray(i.lines) ? (i.lines as LineInput[]) : [];
  if (!lines.length || lines.length > 100) throw new DomainError("أضف بندًا واحدًا على الأقل");
  const inclusive = i.pricesIncludeVat === true;
  try {
    return await db.transaction(async (tx) => {
      const no = (await tx.execute(sql`select next_doc_no('INV') as n`)).rows[0] as { n: string };
      const vatNo = typeof i.customerVatNumber === "string" && i.customerVatNumber.trim() ? i.customerVatNumber.trim() : null;
      const [inv] = await tx.insert(salesInvoices).values({ invoiceNo: no.n, branchId: i.branchId as number, customerName, customerVatNumber: vatNo, invoiceType: type, issueDate: dateStr(i.issueDate ?? new Date().toISOString().slice(0, 10), "التاريخ"), createdBy: m.id }).returning();
      let n = 0;
      for (const l of lines) {
        const price = Number(l.unitPriceHalalas), qty = Number(l.quantity ?? 1), rate = l.vatRate == null ? 15 : Number(l.vatRate), disc = Number(l.discountHalalas ?? 0);
        if (!Number.isInteger(price) || price < 0 || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(rate) || rate < 0 || rate > 100 || !Number.isInteger(disc) || disc < 0) throw new DomainError("بنود الفاتورة غير صحيحة");
        const description = typeof l.description === "string" ? l.description.trim().slice(0, 300) : "";
        if (!description) throw new DomainError("وصف البند مطلوب");
        // The same SQL function that prices diplomas converts a VAT-inclusive price into the net unit price.
        const net = inclusive ? Number((await tx.execute(sql`select vat_net(${price}::bigint, ${rate}::numeric, true) as v`)).rows[0]!.v) : price;
        await tx.insert(salesInvoiceLines).values({ invoiceId: inv!.id, lineNo: ++n, description, quantity: qty, unitPriceHalalas: net, vatRate: rate, discountHalalas: disc });
      }
      const tot = (await tx.execute(sql`select sum(net_halalas)::float8 as n, sum(vat_halalas)::float8 as v from sales_invoice_lines where invoice_id = ${inv!.id}`)).rows[0] as { n: number; v: number };
      const [row] = await tx.update(salesInvoices).set({ netHalalas: tot.n, vatHalalas: tot.v }).where(eq(salesInvoices.id, inv!.id)).returning();
      await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, branchId: i.branchId as number, action: "sales_invoice.create", subjectType: "sales_invoice", subjectId: inv!.id, subjectNo: no.n, after: { net: tot.n, vat: tot.v, inclusive } });
      return row!;
    });
  } catch (e) { return friendly(e); }
}

export async function issueSalesInvoice(m: Member, id: number, ctx: { challengeId?: string; userAgent?: string | null }) {
  if (!INVOICE_WRITE.includes(m.role)) deny("إصدار الفواتير للمالية والمدير العام");
  try {
    return await db.transaction(async (tx) => {
      const [inv] = await tx.select().from(salesInvoices).where(eq(salesInvoices.id, id));
      if (!inv || !inScope(m, inv.branchId)) throw new DomainError("الفاتورة غير موجودة", 404);
      if (inv.status !== "draft") throw new DomainError("الفاتورة ليست مسودة", 409);
      const subject = { invoiceId: id, no: inv.invoiceNo, net: inv.netHalalas, vat: inv.vatHalalas, customer: inv.customerName };
      const otp = otpEnabled() ? await consumeChallenge(tx, { challengeId: ctx.challengeId, memberId: m.id, action: "sales.invoice.issue", subject }) : null;
      const [row] = await tx.update(salesInvoices).set({ status: "issued" }).where(eq(salesInvoices.id, id)).returning();
      await recordAudit(tx, { actorMemberId: m.id, actorRole: m.role, branchId: inv.branchId, action: "sales_invoice.issue", subjectType: "sales_invoice", subjectId: id, subjectNo: inv.invoiceNo, after: subject, otp: evidence(otp), userAgent: ctx.userAgent, contentHash: otp?.subjectHash });
      return row!;
    });
  } catch (e) { return friendly(e); }
}

export async function listSalesInvoices(m: Member) {
  if (!canReadFiscal(m)) deny();
  const rows = (await db.execute(sql`select s.id::int as id, s.invoice_no, s.status, s.invoice_type, s.issue_date, s.customer_name, s.customer_vat_number, s.branch_id::int as branch_id, b.name as branch,
      s.net_halalas::float8 as net_halalas, s.vat_halalas::float8 as vat_halalas, s.gross_halalas::float8 as gross_halalas from sales_invoices s join branches b on b.id = s.branch_id order by s.id desc limit 200`)).rows as { branch_id: number }[];
  return rows.filter((r) => inScope(m, r.branch_id) || (m.role === "branch_manager" && m.branchId === r.branch_id));
}

/** Output VAT (issued sales invoices) against input VAT (approved supplier invoices) per month and branch, with the net position. */
export async function vatReport(m: Member, q: { from?: unknown; to?: unknown }) {
  if (!canReadFiscal(m)) deny();
  const from = month(typeof q.from === "string" ? q.from : "1970-01"), to = month(typeof q.to === "string" ? q.to : "2999-12");
  const sales = (await db.execute(sql`select to_char(month, 'YYYY-MM') as month, branch_id::int as branch_id, invoices::int as invoices, net_halalas::float8 as net_halalas, vat_halalas::float8 as vat_halalas, gross_halalas::float8 as gross_halalas from v_vat_sales where month between ${from}::date and ${to}::date`)).rows as { month: string; branch_id: number; vat_halalas: number; net_halalas: number; gross_halalas: number; invoices: number }[];
  const purchases = (await db.execute(sql`select to_char(month, 'YYYY-MM') as month, branch_id::int as branch_id, invoices::int as invoices, net_halalas::float8 as net_halalas, vat_halalas::float8 as vat_halalas, gross_halalas::float8 as gross_halalas from v_vat_purchases where month between ${from}::date and ${to}::date`)).rows as typeof sales;
  const visible = (r: { branch_id: number }) => inScope(m, r.branch_id) || (m.role === "branch_manager" && m.branchId === r.branch_id);
  const s = sales.filter(visible), p = purchases.filter(visible);
  const sum = (rows: typeof sales, k: "net_halalas" | "vat_halalas" | "gross_halalas") => rows.reduce((a, r) => a + r[k], 0);
  return { sales: s, purchases: p, totals: { outputVat: sum(s, "vat_halalas"), inputVat: sum(p, "vat_halalas"), netVatPayable: sum(s, "vat_halalas") - sum(p, "vat_halalas"), salesNet: sum(s, "net_halalas"), purchasesNet: sum(p, "net_halalas") }, mode: "display_only" };
}

void asc;
