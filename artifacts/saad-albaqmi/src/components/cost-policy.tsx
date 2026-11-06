import { useEffect, useState } from "react";
import type { CostPolicy } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useCostPolicy, useCostPolicyMutations } from "@/hooks/use-data";
import { fmtDate } from "@/lib/domain";

const errMessage = (e: unknown) => (e as { data?: { error?: string } })?.data?.error ?? "تعذر إتمام العملية";
const sel = "h-9 w-full rounded-md border bg-background px-2 text-sm";

type Form = {
  from: string; to: string;
  expenses: boolean; electricity: boolean; depreciation: boolean; instructorPay: boolean;
  method: string; meters: { meter: string; roomId: string }[];
  life: string; salvage: string; start: string; revenue: string; basis: string;
};
const empty: Form = { from: "", to: "", expenses: false, electricity: false, depreciation: false, instructorPay: false, method: "", meters: [], life: "", salvage: "", start: "", revenue: "", basis: "" };

const toForm = (p: CostPolicy | null | undefined): Form => !p ? empty : {
  from: p.period.from, to: p.period.to, ...p.components,
  method: p.electricity?.method ?? "", meters: (p.electricity?.meterAssignments ?? []).map((m) => ({ meter: m.meter, roomId: String(m.roomId) })),
  life: p.depreciation ? String(p.depreciation.usefulLifeMonths) : "", salvage: p.depreciation ? String(p.depreciation.salvagePercent) : "",
  start: p.depreciation?.startConvention ?? "", revenue: p.revenueRecognition, basis: p.basis,
};
const toPolicy = (f: Form): CostPolicy => ({
  period: { from: f.from, to: f.to },
  components: { expenses: f.expenses, electricity: f.electricity, depreciation: f.depreciation, instructorPay: f.instructorPay },
  electricity: f.electricity ? { method: f.method as "meter", meterAssignments: f.method === "meter" ? f.meters.map((m) => ({ meter: m.meter, roomId: Number(m.roomId) })) : [] } : null,
  depreciation: f.depreciation ? { method: "straight_line", usefulLifeMonths: Number(f.life), salvagePercent: Number(f.salvage), startConvention: f.start as "purchase_month" } : null,
  revenueRecognition: f.revenue as "cash",
  basis: f.basis,
});

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1"><label className="text-xs text-muted-foreground">{label}</label>{children}</div>
);

export function CostPolicyPanel() {
  const state = useCostPolicy();
  const { save, approve } = useCostPolicyMutations();
  const { toast } = useToast();
  const [f, setF] = useState<Form>(empty);
  const data = state.data;
  useEffect(() => { if (data) setF(toForm(data.draft ?? data.approved)); }, [data?.draftVersion, data?.approvedVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return null;
  const rooms = data.rooms;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const ro = !data.canEdit;
  const complete = f.from && f.to && f.revenue && f.basis.trim() && (f.expenses || f.electricity || f.depreciation || f.instructorPay)
    && (!f.electricity || (f.method && (f.method !== "meter" || (f.meters.length > 0 && f.meters.every((m) => m.meter.trim() && m.roomId)))))
    && (!f.depreciation || (f.life && f.salvage !== "" && f.start));

  const doSave = () => save.mutate({ data: toPolicy(f) }, {
    onSuccess: () => toast({ title: "حُفظت المسودة", description: "لن تُستخدم في التقارير قبل الاعتماد." }),
    onError: (e) => toast({ title: "تعذر حفظ السياسة", description: errMessage(e), variant: "destructive" }),
  });
  const doApprove = () => approve.mutate({ data: { version: data.draftVersion } }, {
    onSuccess: () => toast({ title: "اعتُمدت السياسة" }),
    onError: (e) => toast({ title: "تعذر الاعتماد", description: errMessage(e), variant: "destructive" }),
  });

  const choose = <option value="">اختر…</option>;

  return (
    <section className="rise rounded-xl border bg-card p-5" data-testid="cost-policy-panel">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-xl text-primary">سياسة احتساب التكلفة</h2>
        <span className="rounded-full bg-secondary px-3 py-1 text-xs" data-testid="policy-status">
          {data.approved ? `معتمدة — النسخة ${data.approvedVersion} · ${data.approvedAt ? fmtDate(data.approvedAt.slice(0, 10)) : ""}` : "لا توجد سياسة معتمدة"}
        </span>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">لا توجد قيم افتراضية: كل خيار تحدده الإدارة المالية. تُحسب التقارير من النسخة المعتمدة فقط، وتعديل المسودة لا يغيّر الأرقام قبل إعادة الاعتماد.{ro ? " صلاحيتك للعرض فقط." : ""}</p>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="بداية فترة الميزانية (أول يوم في الشهر)"><Input type="date" disabled={ro} value={f.from} onChange={(e) => set("from", e.target.value)} data-testid="policy-from" /></Field>
        <Field label="نهاية فترة الميزانية (آخر يوم في الشهر)"><Input type="date" disabled={ro} value={f.to} onChange={(e) => set("to", e.target.value)} data-testid="policy-to" /></Field>
        <Field label="الاعتراف بالإيراد">
          <select className={sel} disabled={ro} value={f.revenue} onChange={(e) => set("revenue", e.target.value)} data-testid="policy-revenue">
            {choose}<option value="cash">عند التحصيل (تاريخ الدفعة)</option><option value="installment_due">عند الاستحقاق (تاريخ القسط)</option>
          </select>
        </Field>
        <div className="space-y-2"><span className="text-xs text-muted-foreground">مكونات التكلفة المعتمدة</span>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={ro} checked={f.expenses} onChange={(e) => set("expenses", e.target.checked)} data-testid="policy-expenses" /> المصروفات العامة</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={ro} checked={f.electricity} onChange={(e) => set("electricity", e.target.checked)} data-testid="policy-electricity" /> الكهرباء (من الفواتير)</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={ro} checked={f.depreciation} onChange={(e) => set("depreciation", e.target.checked)} data-testid="policy-depreciation" /> إهلاك الأصول</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={ro} checked={f.instructorPay} onChange={(e) => set("instructorPay", e.target.checked)} data-testid="policy-instructorPay" /> أجور المدربين (الحصص المنعقدة)</label>
        </div>
        {f.electricity && (
          <div className="space-y-3 rounded-lg border p-3 md:col-span-2">
            <Field label="طريقة توزيع الكهرباء على القاعات">
              <select className={sel} disabled={ro} value={f.method} onChange={(e) => set("method", e.target.value)} data-testid="policy-method">
                {choose}<option value="meter">حسب العدادات الفرعية</option><option value="area">حسب المساحة</option><option value="power_hours">حسب قدرة الأجهزة × ساعات التشغيل الفعلية</option>
              </select>
            </Field>
            {f.method === "meter" && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">الفواتير لعدادات غير مربوطة بقاعة تبقى «غير موزعة» على مستوى الفرع.</p>
                {f.meters.map((m, i) => (
                  <div key={i} className="flex gap-2">
                    <Input placeholder="رقم العداد" disabled={ro} value={m.meter} onChange={(e) => set("meters", f.meters.map((x, j) => j === i ? { ...x, meter: e.target.value } : x))} />
                    <select className={sel} disabled={ro} value={m.roomId} onChange={(e) => set("meters", f.meters.map((x, j) => j === i ? { ...x, roomId: e.target.value } : x))}>
                      {choose}{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                    {!ro && <Button type="button" variant="outline" size="sm" onClick={() => set("meters", f.meters.filter((_, j) => j !== i))}>حذف</Button>}
                  </div>
                ))}
                {!ro && <Button type="button" variant="outline" size="sm" onClick={() => set("meters", [...f.meters, { meter: "", roomId: "" }])}>إضافة عداد</Button>}
              </div>
            )}
          </div>
        )}
        {f.depreciation && (
          <div className="grid gap-3 rounded-lg border p-3 md:col-span-2 md:grid-cols-3">
            <Field label="العمر الإنتاجي (أشهر) — قسط ثابت"><Input type="number" min={1} disabled={ro} value={f.life} onChange={(e) => set("life", e.target.value)} data-testid="policy-life" /></Field>
            <Field label="القيمة المتبقية %"><Input type="number" min={0} max={100} disabled={ro} value={f.salvage} onChange={(e) => set("salvage", e.target.value)} data-testid="policy-salvage" /></Field>
            <Field label="بداية الإهلاك">
              <select className={sel} disabled={ro} value={f.start} onChange={(e) => set("start", e.target.value)} data-testid="policy-start">
                {choose}<option value="purchase_month">شهر الشراء</option><option value="next_month">الشهر التالي للشراء</option>
              </select>
            </Field>
            <p className="text-xs text-muted-foreground md:col-span-3">يُحتسب الإهلاك للأصول التي لها تاريخ شراء فقط؛ غيرها يُستبعد مع تنبيه.</p>
          </div>
        )}
        <div className="md:col-span-2"><Field label="مرجع اعتماد السياسة (قرار أو محضر)">
          <Input disabled={ro} maxLength={500} value={f.basis} onChange={(e) => set("basis", e.target.value)} data-testid="policy-basis" />
        </Field></div>
      </div>
      {!ro && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={doSave} disabled={!complete || save.isPending} data-testid="button-save-policy">حفظ المسودة</Button>
          {data.canApprove && <Button variant="secondary" onClick={doApprove} disabled={!data.draft || data.draftIsApproved || approve.isPending} data-testid="button-approve-policy">
            {data.draftIsApproved ? "المسودة معتمدة" : "اعتماد المسودة الحالية"}
          </Button>}
          {!data.canApprove && <span className="self-center text-xs text-muted-foreground">الاعتماد من صلاحية الإدارة العليا.</span>}
        </div>
      )}
    </section>
  );
}
