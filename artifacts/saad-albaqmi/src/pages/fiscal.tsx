import { useMemo, useState } from "react";
import { Plus, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, ErrorState, LoadingRows, EmptyState, Kpi, Meter } from "@/components/bits";
import { usePageTitle } from "@/hooks/use-data";
import { api, toHalalas, useAct, useOps, useRole } from "@/hooks/use-ops";
import { fmtSAR } from "@/lib/domain";

type Budget = { budget_id: number; branch_id: number; branch: string; category: string | null; category_id: number | null; budget_halalas: number; actual_halalas: number; committed_halalas: number; available_halalas: number; percent: number; level: "ok" | "warn" | "over" };
type Weekly = { week_start: string; branch: string; category: string; is_petty: boolean; net_halalas: number; vat_halalas: number; entries: number };
type Sales = { id: number; invoice_no: string; status: string; invoice_type: string; issue_date: string; customer_name: string; branch: string; net_halalas: number; vat_halalas: number; gross_halalas: number };
type Vat = { sales: { month: string; branch_id: number; net_halalas: number; vat_halalas: number; gross_halalas: number; invoices: number }[]; purchases: { month: string; branch_id: number; net_halalas: number; vat_halalas: number; gross_halalas: number; invoices: number }[]; totals: { outputVat: number; inputVat: number; netVatPayable: number; salesNet: number; purchasesNet: number } };
type Cat = { branches: { id: number; name: string }[] };
const LEVEL: Record<string, string> = { ok: "ضمن الميزانية", warn: "اقتراب من الحد", over: "تجاوز الميزانية" };
const ym = (d = new Date()) => d.toISOString().slice(0, 7);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const money = (h: number) => fmtSAR(h / 100);

function Table({ head, children, testId }: { head: string[]; children: React.ReactNode; testId: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[600px] text-sm" data-testid={testId}>
        <thead><tr className="border-b bg-muted/50 text-right text-[11px] text-muted-foreground">{head.map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export default function FiscalPage() {
  usePageTitle("الميزانية والضريبة");
  const { role } = useRole();
  const canWrite = role === "super_admin" || role === "finance";
  const act = useAct();
  const cat = useOps<Cat>(["fiscal-cat"], "/inventory/catalogue");
  const [month, setMonth] = useState(ym());
  const budgets = useOps<Budget[]>(["budgets", month], `/fiscal/budgets?month=${month}`);
  const [from, setFrom] = useState(iso(new Date(Date.now() - 28 * 864e5))); const [to, setTo] = useState(iso(new Date()));
  const weekly = useOps<Weekly[]>(["weekly", from, to], `/fiscal/weekly-expenses?from=${from}&to=${to}`);
  const sales = useOps<Sales[]>(["sales"], "/fiscal/sales-invoices");
  const [vFrom, setVFrom] = useState(`${new Date().getFullYear()}-01`); const [vTo, setVTo] = useState(ym());
  const vat = useOps<Vat>(["vat", vFrom, vTo], `/fiscal/vat?from=${vFrom}&to=${vTo}`);
  const [dlg, setDlg] = useState<"budget" | "invoice" | null>(null);
  const weeklyTotal = useMemo(() => (weekly.data ?? []).reduce((a, w) => a + w.net_halalas, 0), [weekly.data]);
  const branches = cat.data?.branches ?? [];

  return (
    <>
      <PageHeader eyebrow="المالية" title="الميزانية والضريبة"
        desc="ميزانية شهرية لكل فرع تشمل أوامر الشراء المعتمدة غير المفوترة، وعرض أسبوعي للمصروفات، وفواتير المبيعات بالضريبة. في فترة التجربة تُعرض الضريبة نظاميًا فقط ولا تُرسل إلى هيئة الزكاة والضريبة والجمارك."
        actions={canWrite ? <div className="flex flex-wrap gap-2"><Button onClick={() => setDlg("budget")} className="gap-1.5" data-testid="button-new-budget"><Plus className="h-4 w-4" /> ميزانية</Button><Button variant="outline" onClick={() => setDlg("invoice")} data-testid="button-new-sales-invoice">فاتورة مبيعات</Button></div> : undefined} />
      <Tabs defaultValue="budgets" dir="rtl">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="budgets" data-testid="tab-budgets">الميزانية الشهرية</TabsTrigger>
          <TabsTrigger value="weekly" data-testid="tab-weekly">المصروفات الأسبوعية</TabsTrigger>
          <TabsTrigger value="vat" data-testid="tab-vat">تقرير الضريبة</TabsTrigger>
          <TabsTrigger value="sales" data-testid="tab-sales">فواتير المبيعات</TabsTrigger>
        </TabsList>

        <TabsContent value="budgets">
          <div className="mb-3 max-w-44"><Label className="mb-1.5 block text-xs">الشهر</Label><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} data-testid="input-budget-month" /></div>
          {budgets.isLoading ? <LoadingRows /> : budgets.isError ? <ErrorState error={budgets.error} onRetry={() => budgets.refetch()} /> : !budgets.data?.length ? <EmptyState title="لا توجد ميزانية لهذا الشهر" desc="حدّد ميزانية الفرع الشهرية (إجمالية أو لفئة مصروف) ليظهر الاستهلاك والتنبيه." /> : (
            <Table testId="table-budgets" head={["الفرع", "الفئة", "الميزانية", "المصروف الفعلي", "التزامات الشراء", "المتاح", "الاستهلاك"]}>
              {budgets.data.map((b) => (
                <tr key={b.budget_id} className="border-b border-border/60 last:border-0" data-testid={`row-budget-${b.budget_id}`}>
                  <td className="px-4 py-3 font-medium">{b.branch}</td><td className="px-4 py-3">{b.category ?? "الإجمالي"}</td>
                  <td className="px-4 py-3 num">{money(b.budget_halalas)}</td><td className="px-4 py-3 num">{money(b.actual_halalas)}</td><td className="px-4 py-3 num">{money(b.committed_halalas)}</td>
                  <td className={`px-4 py-3 num ${b.available_halalas < 0 ? "text-destructive" : ""}`}>{money(b.available_halalas)}</td>
                  <td className="w-44 px-4 py-3"><div className="flex items-center gap-2"><Meter value={b.percent} /><span className="num text-[11px]">{b.percent}%</span></div><div className={`mt-0.5 text-[10px] ${b.level === "over" ? "text-destructive" : "text-muted-foreground"}`}>{LEVEL[b.level]}</div></td>
                </tr>
              ))}
            </Table>
          )}
          <p className="mt-3 text-xs text-muted-foreground">الاستهلاك = المصروف المؤكَّد + أوامر الشراء المعتمدة التي لم تُفوتر بعد. عند الاقتراب من الحد أو تجاوزه يصل إشعار للمالية والمدير العام ومدير الفرع.</p>
        </TabsContent>

        <TabsContent value="weekly">
          <div className="mb-3 flex flex-wrap items-end gap-3"><div><Label className="mb-1.5 block text-xs">من</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div><div><Label className="mb-1.5 block text-xs">إلى</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div><div className="w-48"><Kpi label="الإجمالي قبل الضريبة" value={money(weeklyTotal)} /></div></div>
          {weekly.isLoading ? <LoadingRows /> : !weekly.data?.length ? <EmptyState title="لا توجد مصروفات مؤكَّدة في هذه الفترة" desc="تظهر المصروفات بعد تأكيدها (اعتماد فواتير الموردين أو تسجيل المصروفات)." /> : (
            <Table testId="table-weekly" head={["بداية الأسبوع", "الفرع", "الفئة", "عدد القيود", "قبل الضريبة", "الضريبة"]}>
              {weekly.data.map((w, i) => (
                <tr key={i} className="border-b border-border/60 last:border-0"><td className="px-4 py-3 num" dir="ltr">{w.week_start}</td><td className="px-4 py-3">{w.branch}</td><td className="px-4 py-3">{w.category} {w.is_petty && <span className="text-[10px] text-muted-foreground">نثرية</span>}</td><td className="px-4 py-3 num">{w.entries}</td><td className="px-4 py-3 num">{money(w.net_halalas)}</td><td className="px-4 py-3 num">{money(w.vat_halalas)}</td></tr>
              ))}
            </Table>
          )}
          <p className="mt-3 text-xs text-muted-foreground">الأسبوع يبدأ الاثنين. فاتورة الكهرباء شهرية، فتوزيعها على القاعات يبقى في تقرير التكلفة الشهري.</p>
        </TabsContent>

        <TabsContent value="vat">
          <div className="mb-3 flex flex-wrap items-end gap-3"><div><Label className="mb-1.5 block text-xs">من شهر</Label><Input type="month" value={vFrom} onChange={(e) => setVFrom(e.target.value)} /></div><div><Label className="mb-1.5 block text-xs">إلى شهر</Label><Input type="month" value={vTo} onChange={(e) => setVTo(e.target.value)} /></div></div>
          {vat.isLoading ? <LoadingRows /> : vat.isError || !vat.data ? <ErrorState error={vat.error} onRetry={() => vat.refetch()} /> : (
            <>
              <div className="mb-4 grid gap-3 sm:grid-cols-3" data-testid="vat-totals">
                <Kpi label="ضريبة المخرجات (المبيعات)" value={money(vat.data.totals.outputVat)} sub={`مبيعات قبل الضريبة ${money(vat.data.totals.salesNet)}`} />
                <Kpi label="ضريبة المدخلات (المشتريات)" value={money(vat.data.totals.inputVat)} sub={`مشتريات قبل الضريبة ${money(vat.data.totals.purchasesNet)}`} />
                <Kpi label="الصافي المستحق" value={money(vat.data.totals.netVatPayable)} tone="accent" sub="المخرجات − المدخلات" />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                {([["المبيعات (فواتير صادرة)", vat.data.sales], ["المشتريات (فواتير موردين معتمدة)", vat.data.purchases]] as const).map(([title, rows]) => (
                  <section key={title}><h3 className="mb-2 text-sm font-medium">{title}</h3>
                    <Table testId={`table-vat-${title.slice(0, 4)}`} head={["الشهر", "الفواتير", "قبل الضريبة", "الضريبة", "الإجمالي"]}>
                      {rows.length === 0 ? <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">لا بيانات</td></tr> : rows.map((r, i) => <tr key={i} className="border-b border-border/60 last:border-0"><td className="px-4 py-3 num" dir="ltr">{r.month}</td><td className="px-4 py-3 num">{r.invoices}</td><td className="px-4 py-3 num">{money(r.net_halalas)}</td><td className="px-4 py-3 num">{money(r.vat_halalas)}</td><td className="px-4 py-3 num">{money(r.gross_halalas)}</td></tr>)}
                    </Table></section>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">عرض فقط في فترة التجربة: لا إقرار ولا ربط مع منصة فاتورة. راجع المحاسب القانوني قبل الاعتماد على الأرقام في الإقرار الضريبي.</p>
            </>
          )}
        </TabsContent>

        <TabsContent value="sales">
          {sales.isLoading ? <LoadingRows /> : !sales.data?.length ? <EmptyState title="لا توجد فواتير مبيعات" desc="أنشئ فاتورة بالضريبة، ثم أصدرها لتدخل تقرير ضريبة المخرجات." /> : (
            <Table testId="table-sales" head={["الرقم", "العميل", "النوع", "قبل الضريبة", "الضريبة", "الإجمالي", "الحالة", ""]}>
              {sales.data.map((s) => (
                <tr key={s.id} className="border-b border-border/60 last:border-0" data-testid={`row-sales-${s.id}`}>
                  <td className="px-4 py-3 num" dir="ltr">{s.invoice_no}</td><td className="px-4 py-3 font-medium">{s.customer_name}</td><td className="px-4 py-3 text-[11px]">{s.invoice_type === "standard" ? "ضريبية قياسية" : "مبسّطة"}</td>
                  <td className="px-4 py-3 num">{money(s.net_halalas)}</td><td className="px-4 py-3 num">{money(s.vat_halalas)}</td><td className="px-4 py-3 num">{money(s.gross_halalas)}</td>
                  <td className="px-4 py-3"><span className="rounded-full bg-secondary px-2 py-0.5 text-[11px]">{s.status === "issued" ? "صادرة" : s.status === "draft" ? "مسودة" : "ملغاة"}</span></td>
                  <td className="px-4 py-3 text-left">{s.status === "draft" && canWrite && <Button size="sm" className="gap-1.5" data-testid={`button-issue-${s.id}`} onClick={() => act.run(() => api(`/fiscal/sales-invoices/${s.id}/issue`, { method: "POST" }), { success: "صدرت الفاتورة", refresh: ["sales", "vat"] })}><ShieldCheck className="h-3.5 w-3.5" /> إصدار</Button>}</td>
                </tr>
              ))}
            </Table>
          )}
        </TabsContent>
      </Tabs>
      {dlg === "budget" && <BudgetDialog branches={branches} month={month} onClose={() => setDlg(null)} />}
      {dlg === "invoice" && <InvoiceDialog branches={branches} onClose={() => setDlg(null)} />}
      {act.dialog}
    </>
  );
}

function BudgetDialog({ branches, month, onClose }: { branches: { id: number; name: string }[]; month: string; onClose: () => void }) {
  const act = useAct();
  const [branch, setBranch] = useState(""); const [m, setM] = useState(month); const [amount, setAmount] = useState(""); const [warn, setWarn] = useState("80");
  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader className="text-right"><DialogTitle className="font-display text-xl text-primary">ميزانية شهرية</DialogTitle><DialogDescription>ميزانية إجمالية للفرع في الشهر. يُنبَّه المعنيون عند بلوغ نسبة التنبيه وعند التجاوز.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div><Label className="mb-1.5 block text-xs">الفرع</Label><Select value={branch} onValueChange={setBranch}><SelectTrigger data-testid="select-budget-branch"><SelectValue placeholder="اختر الفرع" /></SelectTrigger><SelectContent>{branches.map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid grid-cols-3 gap-3"><div className="col-span-1"><Label className="mb-1.5 block text-xs">الشهر</Label><Input type="month" value={m} onChange={(e) => setM(e.target.value)} /></div><div><Label className="mb-1.5 block text-xs">المبلغ (ر.س)</Label><Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="input-budget-amount" /></div><div><Label className="mb-1.5 block text-xs">تنبيه عند %</Label><Input type="number" min={1} max={100} value={warn} onChange={(e) => setWarn(e.target.value)} /></div></div>
          </div>
          <DialogFooter className="gap-2 sm:justify-start"><Button disabled={!branch || !amount} data-testid="button-budget-save" onClick={() => act.run(() => api("/fiscal/budgets", { method: "PUT", body: { branchId: Number(branch), month: m, amountHalalas: toHalalas(amount), warnAtPercent: Number(warn) } }), { success: "حُفظت الميزانية", refresh: ["budgets"], onDone: onClose })}>حفظ</Button><Button variant="outline" onClick={onClose}>إلغاء</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {act.dialog}
    </>
  );
}

/** Invoice with the specialist's inclusive/exclusive choice and a live preview of the difference between the two ways of pricing. */
function InvoiceDialog({ branches, onClose }: { branches: { id: number; name: string }[]; onClose: () => void }) {
  const act = useAct();
  const [branch, setBranch] = useState(""); const [customer, setCustomer] = useState(""); const [vatNo, setVatNo] = useState("");
  const [desc, setDesc] = useState(""); const [qty, setQty] = useState("1"); const [price, setPrice] = useState(""); const [inclusive, setInclusive] = useState(false);
  const p = Math.round((Number(price) || 0) * 100) * (Number(qty) || 0);
  const rate = 0.15;
  const exclusive = { net: p, vat: Math.round(p * rate), gross: p + Math.round(p * rate) };
  const incl = { gross: p, net: Math.round(p / (1 + rate)), vat: p - Math.round(p / (1 + rate)) };
  const shown = inclusive ? incl : exclusive;
  const standard = vatNo.trim().length > 0;
  const vatOk = !vatNo || /^3\d{13}3$/.test(vatNo);
  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg" dir="rtl">
          <DialogHeader className="text-right"><DialogTitle className="font-display text-xl text-primary">فاتورة مبيعات</DialogTitle><DialogDescription>اختر هل السعر المُدخل شامل الضريبة أم قبلها، ويظهر الفرق بين الطريقتين. فاتورة المنشآت تتطلب الرقم الضريبي للمشتري.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="mb-1.5 block text-xs">الفرع</Label><Select value={branch} onValueChange={setBranch}><SelectTrigger data-testid="select-invoice-branch"><SelectValue placeholder="اختر" /></SelectTrigger><SelectContent>{branches.map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent></Select></div>
              <div><Label className="mb-1.5 block text-xs">العميل</Label><Input value={customer} onChange={(e) => setCustomer(e.target.value)} data-testid="input-invoice-customer" /></div>
            </div>
            <div><Label className="mb-1.5 block text-xs">الرقم الضريبي للمشتري (اختياري للأفراد)</Label><Input dir="ltr" inputMode="numeric" value={vatNo} onChange={(e) => setVatNo(e.target.value.replace(/\D/g, "").slice(0, 15))} />{!vatOk && <p className="mt-1 text-[11px] text-destructive">15 رقمًا يبدأ وينتهي بالرقم 3.</p>}</div>
            <div><Label className="mb-1.5 block text-xs">البند</Label><Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="مثال: رسوم دبلوم تقنية المعلومات" data-testid="input-invoice-desc" /></div>
            <div className="grid grid-cols-2 gap-3"><div><Label className="mb-1.5 block text-xs">الكمية</Label><Input type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} /></div><div><Label className="mb-1.5 block text-xs">سعر الوحدة (ر.س)</Label><Input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} data-testid="input-invoice-price" /></div></div>
            <label className="flex items-center justify-between rounded-lg border p-3 text-sm"><span>السعر المُدخل <b>{inclusive ? "شامل" : "قبل"}</b> ضريبة القيمة المضافة (15%)</span><Switch checked={inclusive} onCheckedChange={setInclusive} data-testid="switch-inclusive" /></label>
            <div className="rounded-lg bg-muted/50 p-3 text-sm" data-testid="invoice-preview">
              <div className="flex justify-between"><span>قبل الضريبة</span><b className="num">{fmtSAR(shown.net / 100)}</b></div>
              <div className="flex justify-between"><span>الضريبة 15%</span><b className="num">{fmtSAR(shown.vat / 100)}</b></div>
              <div className="flex justify-between border-t pt-1"><span>الإجمالي</span><b className="num">{fmtSAR(shown.gross / 100)}</b></div>
              <p className="mt-2 text-[11px] text-muted-foreground">لو كان نفس الرقم {inclusive ? "قبل الضريبة" : "شاملًا الضريبة"} لكان الإجمالي {fmtSAR((inclusive ? exclusive.gross : incl.gross) / 100)} — الفرق {fmtSAR(Math.abs(exclusive.gross - incl.gross) / 100)}.</p>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-start"><Button disabled={!branch || !customer.trim() || !desc.trim() || !(p > 0) || !vatOk} data-testid="button-invoice-create" onClick={() => act.run(() => api("/fiscal/sales-invoices", { method: "POST", body: { branchId: Number(branch), customerName: customer.trim(), customerVatNumber: vatNo || undefined, invoiceType: standard ? "standard" : "simplified", pricesIncludeVat: inclusive, lines: [{ description: desc.trim(), quantity: Number(qty), unitPriceHalalas: Math.round(Number(price) * 100) }] } }), { success: "أُنشئت الفاتورة كمسودة", refresh: ["sales"], onDone: onClose })}>إنشاء</Button><Button variant="outline" onClick={onClose}>إلغاء</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {act.dialog}
    </>
  );
}
