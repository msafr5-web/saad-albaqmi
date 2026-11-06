import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState, LoadingRows } from "@/components/bits";
import { useCostReport } from "@/hooks/use-data";
import { fmtSAR } from "@/lib/domain";

type Csv = (name: string, header: string[], rows: (string | number)[][]) => void;

export function CostReportSection({ downloadCsv }: { downloadCsv: Csv }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const rep = useCostReport(from, to);
  const d = rep.data;
  const th = (h: string) => <th key={h} className="px-4 py-3 font-medium">{h}</th>;

  return (
    <section className="rise" data-testid="cost-report">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-display text-xl text-primary">تقرير التكلفة وفق السياسة المعتمدة</h2>
        {d?.status === "approved" && d.period && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-muted-foreground">من (أول الشهر)<Input type="date" min={d.policy?.period.from} max={d.policy?.period.to} value={from || d.period.from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="text-xs text-muted-foreground">إلى (آخر الشهر)<Input type="date" min={d.policy?.period.from} max={d.policy?.period.to} value={to || d.period.to} onChange={(e) => setTo(e.target.value)} /></label>
            <Button variant="outline" size="sm" className="gap-1.5" data-testid="button-export-cost" onClick={() => {
              downloadCsv("cost-by-branch", ["الفرع", "الإيراد", "مصروفات", "كهرباء", "إهلاك", "أجور مدربين", "إجمالي التكلفة", "الفرق", "الطلاب", "تكلفة الطالب", "كهرباء غير موزعة"],
                d.branches.map((r) => [r.name, r.revenue, r.cost.expenses, r.cost.electricity, r.cost.depreciation, r.cost.instructorPay, r.totalCost, r.margin, r.students, r.costPerStudent ?? "", r.unallocatedElectricity]));
              downloadCsv("cost-by-diploma", ["الدبلوم", "الإيراد", "كهرباء", "إهلاك", "أجور مدربين", "التكلفة المنسوبة", "الفرق", "الطلاب", "تكلفة الطالب"],
                d.diplomas.map((r) => [r.name, r.revenue, r.cost.electricity, r.cost.depreciation, r.cost.instructorPay, r.totalCost, r.margin, r.students, r.costPerStudent ?? ""]));
            }}><Download className="h-4 w-4" /> تصدير CSV</Button>
          </div>
        )}
      </div>
      {rep.isLoading ? <LoadingRows rows={3} /> : rep.isError ? <ErrorState error={rep.error} onRetry={() => rep.refetch()} /> : !d || d.status !== "approved" ? (
        <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground" data-testid="cost-report-empty">
          لا يوجد تقرير تكلفة أو ربحية قبل اعتماد سياسة التوزيع والإهلاك والاعتراف بالإيراد. الأرقام التراكمية أعلاه ليست تكلفة طالب فعلية ولا ربحًا محاسبيًا.
        </div>
      ) : (
        <div className="space-y-6">
          <p className="text-xs text-muted-foreground">نسخة السياسة {d.policyVersion} · الفترة {d.period?.from} إلى {d.period?.to} · الفرق = الإيراد المعترف به − التكلفة وفق السياسة، وليس ربحًا محاسبيًا. الإجمالي: إيراد {fmtSAR(d.totals.revenue)} / تكلفة {fmtSAR(d.totals.totalCost)}.</p>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[900px] text-sm">
              <thead><tr className="border-b bg-muted/50 text-right text-[11px] text-muted-foreground">{["الفرع", "الإيراد", "مصروفات", "كهرباء", "إهلاك", "أجور المدربين", "إجمالي التكلفة", "الفرق", "الطلاب", "تكلفة الطالب"].map(th)}</tr></thead>
              <tbody>{d.branches.map((r) => (
                <tr key={r.branchId} className="border-b border-border/60 last:border-0" data-testid={`row-cost-branch-${r.branchId}`}>
                  <td className="px-4 py-3 font-medium">{r.name}{r.unallocatedElectricity > 0 && <span className="block text-[11px] text-muted-foreground">كهرباء غير موزعة: {fmtSAR(r.unallocatedElectricity)}</span>}</td>
                  <td className="px-4 py-3 num">{fmtSAR(r.revenue)}</td><td className="px-4 py-3 num">{fmtSAR(r.cost.expenses)}</td>
                  <td className="px-4 py-3 num">{fmtSAR(r.cost.electricity)}</td><td className="px-4 py-3 num">{fmtSAR(r.cost.depreciation)}</td>
                  <td className="px-4 py-3 num">{fmtSAR(r.cost.instructorPay)}</td><td className="px-4 py-3 num">{fmtSAR(r.totalCost)}</td>
                  <td className={`px-4 py-3 num ${r.margin < 0 ? "text-destructive" : "text-success"}`}>{fmtSAR(r.margin)}</td>
                  <td className="px-4 py-3 num">{r.students}</td><td className="px-4 py-3 num">{r.costPerStudent == null ? "—" : fmtSAR(r.costPerStudent)}</td>
                </tr>))}</tbody>
            </table>
          </div>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[800px] text-sm">
              <thead><tr className="border-b bg-muted/50 text-right text-[11px] text-muted-foreground">{["الدبلوم", "الإيراد", "كهرباء", "إهلاك", "أجور المدربين", "التكلفة المنسوبة", "الفرق", "الطلاب", "تكلفة الطالب"].map(th)}</tr></thead>
              <tbody>{d.diplomas.map((r) => (
                <tr key={r.diplomaId} className="border-b border-border/60 last:border-0" data-testid={`row-cost-diploma-${r.diplomaId}`}>
                  <td className="px-4 py-3 font-medium">{r.name}</td><td className="px-4 py-3 num">{fmtSAR(r.revenue)}</td>
                  <td className="px-4 py-3 num">{fmtSAR(r.cost.electricity)}</td><td className="px-4 py-3 num">{fmtSAR(r.cost.depreciation)}</td>
                  <td className="px-4 py-3 num">{fmtSAR(r.cost.instructorPay)}</td><td className="px-4 py-3 num">{fmtSAR(r.totalCost)}</td>
                  <td className={`px-4 py-3 num ${r.margin < 0 ? "text-destructive" : "text-success"}`}>{fmtSAR(r.margin)}</td>
                  <td className="px-4 py-3 num">{r.students}</td><td className="px-4 py-3 num">{r.costPerStudent == null ? "—" : fmtSAR(r.costPerStudent)}</td>
                </tr>))}</tbody>
            </table>
          </div>
          <details className="rounded-xl border bg-card p-4 text-sm">
            <summary className="cursor-pointer font-medium">أثر التدقيق: توزيع القاعات والتنبيهات</summary>
            <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
              {d.rooms.map((r) => <li key={r.roomId}>{r.name}: ساعات منعقدة {r.heldHours} · كهرباء {fmtSAR(r.electricity)} · إهلاك {fmtSAR(r.depreciation)}</li>)}
            </ul>
            <ul className="mt-3 list-disc space-y-1 pr-5 text-xs">{d.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </details>
        </div>
      )}
    </section>
  );
}
