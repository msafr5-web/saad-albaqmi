import { useMemo } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CostPolicyPanel } from "@/components/cost-policy";
import { CostReportSection } from "@/components/cost-report";
import { PageHeader, ErrorState, LoadingRows, Meter, EmptyState } from "@/components/bits";
import { useRecords, useRecordIndex, usePageTitle } from "@/hooks/use-data";
import { det, fmtDate, fmtPct, fmtSAR, fmtNum, num } from "@/lib/domain";

function downloadCsv(name: string, header: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const text = String(v);
    const safe = typeof v === "string" && /^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const csv = "\uFEFF" + [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  usePageTitle("التقارير");
  const records = useRecords();
  const idx = useRecordIndex(records.data);

  const fin = useMemo(() => idx.of("branch").map((b) => {
    const inB = (k: "expense" | "invoice" | "payment" | "student" | "room") => idx.of(k).filter((r) => r.branchId === b.id);
    const budget = num(det(b, "budget"));
    const exp = inB("expense").reduce((a, r) => a + num(det(r, "amount")), 0);
    const inv = inB("invoice").reduce((a, r) => a + num(det(r, "amount")), 0);
    const kwh = inB("invoice").reduce((a, r) => a + num(det(r, "kwh")), 0);
    const collected = inB("payment").reduce((a, r) => a + num(det(r, "amount")), 0);
    const students = inB("student").length;
    const area = inB("room").reduce((a, r) => a + num(det(r, "area")), 0);
    const spent = exp + inv;
    return { id: b.id, name: b.name, budget, exp, inv, spent, collected, net: collected - spent, usage: budget ? (spent / budget) * 100 : 0, perStudent: students ? spent / students : 0, students, kwhPerM2: area ? kwh / area : 0 };
  }), [idx]);

  const inv = useMemo(() => idx.of("branch").map((b) => {
    const assets = idx.of("asset").filter((a) => a.branchId === b.id);
    const soon = new Date(); soon.setDate(soon.getDate() + 30);
    const s = soon.toISOString().slice(0, 10);
    return { id: b.id, name: b.name, count: assets.length, value: assets.reduce((a, r) => a + num(det(r, "value")), 0), maint: assets.filter((a) => a.status === "maintenance").length, due: assets.filter((a) => det(a, "maintenanceDate") && String(det(a, "maintenanceDate")) <= s).length };
  }), [idx]);

  const dueAssets = useMemo(() => idx.of("asset").filter((a) => det(a, "maintenanceDate")).sort((a, b) => String(det(a, "maintenanceDate")).localeCompare(String(det(b, "maintenanceDate")))).slice(0, 8), [idx]);

  const exportFin = () => downloadCsv("branch-financials", ["الفرع", "الميزانية", "مصروفات", "فواتير", "إجمالي المصروف", "نسبة الاستهلاك %", "المحصل", "الصافي", "الطلاب", "تكلفة الطالب", "ك.واط.س لكل م²"],
    fin.map((r) => [r.name, r.budget, r.exp, r.inv, r.spent, r.usage.toFixed(1), r.collected, r.net, r.students, r.perStudent.toFixed(2), r.kwhPerM2.toFixed(2)]));
  const exportInv = () => downloadCsv("inventory", ["الأصل", "الفرع", "القاعة", "الرقم التسلسلي", "القيمة", "موعد الصيانة", "الحالة"],
    idx.of("asset").map((a) => [a.name, idx.nameOf(a.branchId), idx.nameOf(det(a, "roomId")), String(det(a, "serial") ?? ""), num(det(a, "value")), String(det(a, "maintenanceDate") ?? ""), a.status]));

  return (
    <>
      <PageHeader eyebrow="التحليل" title="التقارير" desc="إجماليات تراكمية لجميع السجلات دون فلترة فترة محاسبية. المصروف = المصروفات والفواتير المسجلة؛ الصافي = المحصل ناقص المصروف المسجل، وليس ربحًا محاسبيًا. متوسط تكلفة الطالب = مصروف الفرع ÷ عدد طلابه، لا تكلفة الطالب الفعلية. الجدول التراكمي لا يشمل الإهلاك أو توزيع الطاقة؛ تقرير التكلفة أعلاه يعتمد على السياسة المعتمدة. لا تكرر فاتورة الكهرباء ضمن المصروفات." />
      {records.isLoading ? <LoadingRows /> : records.isError ? <ErrorState error={records.error} onRetry={() => records.refetch()} /> : fin.length === 0 ? (
        <EmptyState title="لا توجد بيانات للتقارير" desc="تُبنى التقارير من الفروع والمصروفات والفواتير والمدفوعات والأصول. أضف الفروع أولًا." />
      ) : (
        <div className="space-y-10">
          <CostPolicyPanel />
          <CostReportSection downloadCsv={downloadCsv} />
          <section className="rise">
            <div className="mb-3 flex items-end justify-between gap-3">
              <h2 className="font-display text-xl text-primary">التقرير المالي للفروع — إجماليات تراكمية</h2>
              <Button variant="outline" size="sm" onClick={exportFin} className="gap-1.5" data-testid="button-export-financial"><Download className="h-4 w-4" /> تصدير CSV</Button>
            </div>
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full min-w-[860px] text-sm">
                <thead><tr className="border-b bg-muted/50 text-right text-[11px] text-muted-foreground">
                  {["الفرع", "الميزانية", "إجمالي المصروف", "الاستهلاك", "المحصل", "الصافي", "تكلفة الطالب", "ك.واط.س/م²"].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}
                </tr></thead>
                <tbody>
                  {fin.map((r) => (
                    <tr key={r.id} className="border-b border-border/60 last:border-0 hover:bg-secondary/40" data-testid={`row-report-${r.id}`}>
                      <td className="px-4 py-3 font-medium">{r.name}</td>
                      <td className="px-4 py-3 num">{fmtSAR(r.budget)}</td>
                      <td className="px-4 py-3 num">{fmtSAR(r.spent)}</td>
                      <td className="w-44 px-4 py-3"><div className="flex items-center gap-2"><Meter value={r.usage} /><span className="num text-[11px]">{fmtPct(r.usage)}</span></div></td>
                      <td className="px-4 py-3 num">{fmtSAR(r.collected)}</td>
                      <td className={`px-4 py-3 num ${r.net < 0 ? "text-destructive" : "text-success"}`}>{fmtSAR(r.net)}</td>
                      <td className="px-4 py-3 num">{r.students ? fmtSAR(r.perStudent) : "—"}</td>
                      <td className="px-4 py-3 num">{r.kwhPerM2 ? r.kwhPerM2.toFixed(2) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rise" style={{ animationDelay: "100ms" }}>
            <div className="mb-3 flex items-end justify-between gap-3">
              <h2 className="font-display text-xl text-primary">تقرير الجرد</h2>
              <Button variant="outline" size="sm" onClick={exportInv} className="gap-1.5" data-testid="button-export-inventory"><Download className="h-4 w-4" /> تصدير CSV</Button>
            </div>
            <div className="grid gap-6 lg:grid-cols-5">
              <div className="overflow-x-auto rounded-xl border bg-card lg:col-span-3">
                <table className="w-full text-sm">
                  <thead><tr className="border-b bg-muted/50 text-right text-[11px] text-muted-foreground">
                    {["الفرع", "عدد الأصول", "القيمة المسجلة", "قيد الصيانة", "صيانة مستحقة خلال 30 يومًا"].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {inv.map((r) => (
                      <tr key={r.id} className="border-b border-border/60 last:border-0">
                        <td className="px-4 py-3 font-medium">{r.name}</td>
                        <td className="px-4 py-3 num">{fmtNum(r.count)}</td>
                        <td className="px-4 py-3 num">{fmtSAR(r.value)}</td>
                        <td className="px-4 py-3 num">{r.maint}</td>
                        <td className={`px-4 py-3 num ${r.due ? "text-[hsl(32_80%_32%)]" : ""}`}>{r.due}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="rounded-xl border bg-card p-4 lg:col-span-2">
                <h3 className="mb-3 text-sm font-medium">أقرب مواعيد الصيانة</h3>
                {dueAssets.length === 0 ? <p className="text-xs text-muted-foreground">لا توجد مواعيد صيانة مسجلة.</p> : (
                  <ul className="space-y-2">{dueAssets.map((a) => (
                    <li key={a.id} className="flex justify-between gap-3 text-sm"><span className="truncate">{a.name} <span className="text-[11px] text-muted-foreground">· {idx.nameOf(a.branchId)}</span></span><span className="num shrink-0 text-xs text-muted-foreground">{fmtDate(String(det(a, "maintenanceDate")))}</span></li>
                  ))}</ul>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
