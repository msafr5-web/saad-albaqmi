import { Link } from "wouter";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import { useSummary, useRecords, useRecordIndex } from "@/hooks/use-data";
import { ErrorState, EmptyState, Kpi, LoadingRows, Meter, StatusPill } from "@/components/bits";
import { Skeleton } from "@/components/ui/skeleton";
import { KINDS, det, fmtDate, fmtPct, fmtSAR, fmtNum } from "@/lib/domain";

export function Overview({ publicView = false }: { publicView?: boolean }) {
  const s = useSummary();
  const records = useRecords();
  const idx = useRecordIndex(records.data);

  if (s.isLoading) return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl bg-muted" />)}</div>
      <LoadingRows rows={4} />
    </div>
  );
  if (s.isError || !s.data) return <ErrorState error={s.error} onRetry={() => s.refetch()} />;
  const d = s.data;
  const budget = d.branchSummaries.reduce((a, b) => a + b.budget, 0);
  const net = d.collected - d.expenses;
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = idx.of("session").filter((x) => String(det(x, "date")) >= today).sort((a, b) => `${det(a, "date")}${det(a, "start")}`.localeCompare(`${det(b, "date")}${det(b, "start")}`)).slice(0, 5);

  if (!publicView && d.branches === 0 && d.students === 0) {
    return (
      <EmptyState
        title="مساحة عملك الخاصة جاهزة وفارغة"
        desc="هذه مساحة شخصية لا تحتوي أي بيانات للمعهد. ابدأ بإنشاء الفروع، ثم القاعات والدبلومات، ثم الطلاب والمدربين. ستظهر المؤشرات هنا تلقائيًا من سجلاتك الفعلية."
        action={<Link href="/branches" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground" data-testid="link-start-branches">ابدأ بالفروع <ArrowLeft className="h-4 w-4" /></Link>}
      />
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi tone="accent" label="صافي التحصيل ناقص المصروف" value={fmtSAR(net)} sub="محصل فعليًا مقابل مصروف فعلي" />
        <Kpi delay={60} label="المحصل" value={fmtSAR(d.collected)} />
        <Kpi delay={120} label="المصروفات" value={fmtSAR(d.expenses)} sub={budget ? `${fmtPct((d.expenses / budget) * 100)} من الميزانيات` : undefined} />
        <Kpi delay={180} label="الطلاب" value={fmtNum(d.students)} />
        <Kpi delay={240} label="المدربون" value={fmtNum(d.instructors)} />
        <Kpi delay={300} label="الفروع / الدبلومات" value={`${d.branches} / ${d.diplomas}`} />
      </div>

      <section className="rise" style={{ animationDelay: "120ms" }}>
        <div className="mb-3 flex items-end justify-between">
          <h2 className="font-display text-xl text-primary">مقارنة الفروع</h2>
          <span className="text-[11px] text-muted-foreground">تنبيه عند 80% و100% من الميزانية</span>
        </div>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="border-b bg-muted/50 text-right text-[11px] text-muted-foreground">
              <th className="px-4 py-3 font-medium">الفرع</th><th className="px-4 py-3 font-medium">الميزانية</th><th className="px-4 py-3 font-medium">المصروف</th>
              <th className="w-48 px-4 py-3 font-medium">الاستهلاك</th><th className="px-4 py-3 font-medium">المحصل</th><th className="px-4 py-3 font-medium">الطلاب</th><th className="px-4 py-3 font-medium">القاعات</th><th className="px-4 py-3 font-medium">التنبيه</th>
            </tr></thead>
            <tbody>
              {d.branchSummaries.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">لا توجد فروع.</td></tr>}
              {d.branchSummaries.map((b) => (
                <tr key={b.id} className="border-b border-border/60 last:border-0 hover:bg-secondary/40" data-testid={`row-branch-summary-${b.id}`}>
                  <td className="px-4 py-3 font-medium">{b.name}</td>
                  <td className="px-4 py-3 num">{fmtSAR(b.budget)}</td>
                  <td className="px-4 py-3 num">{fmtSAR(b.spent)}</td>
                  <td className="px-4 py-3"><div className="flex items-center gap-2"><Meter value={b.usage} /><span className="num w-12 text-[11px]">{fmtPct(b.usage)}</span></div></td>
                  <td className="px-4 py-3 num">{fmtSAR(b.collected)}</td>
                  <td className="px-4 py-3 num">{b.students}</td>
                  <td className="px-4 py-3 num">{b.rooms}</td>
                  <td className="px-4 py-3 text-xs">{b.alert ? <span className="inline-flex items-center gap-1 text-[hsl(32_80%_32%)]"><TriangleAlert className="h-3.5 w-3.5" />{b.alert}</span> : <span className="text-muted-foreground">ضمن الحد</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="rise lg:col-span-3" style={{ animationDelay: "180ms" }}>
          <h2 className="mb-3 font-display text-xl text-primary">آخر الحركات</h2>
          <ol className="relative space-y-0 rounded-xl border bg-card">
            {d.recent.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">لا توجد حركات بعد.</li>}
            {d.recent.slice(0, 8).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3 last:border-0">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="h-2 w-2 shrink-0 rotate-45 bg-accent" />
                  <div className="min-w-0">
                    <div className="truncate text-sm">{r.name}</div>
                    <div className="text-[11px] text-muted-foreground">{KINDS[r.kind]?.singular} · {fmtDate(r.createdAt)}</div>
                  </div>
                </div>
                <StatusPill status={r.status} />
              </li>
            ))}
          </ol>
        </section>
        <section className="rise lg:col-span-2" style={{ animationDelay: "240ms" }}>
          <h2 className="mb-3 font-display text-xl text-primary">الحصص القادمة</h2>
          <div className="rounded-xl border bg-card">
            {records.isLoading ? <div className="p-4"><LoadingRows rows={3} /></div> : upcoming.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">لا توجد حصص قادمة.</p> : upcoming.map((x) => (
              <div key={x.id} className="flex items-center gap-4 border-b border-border/60 px-4 py-3 last:border-0">
                <div className="num w-20 shrink-0 rounded-md bg-secondary px-2 py-1 text-center text-[11px]">{String(det(x, "start"))}–{String(det(x, "end"))}</div>
                <div className="min-w-0">
                  <div className="truncate text-sm">{x.name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{fmtDate(String(det(x, "date")))} · {idx.nameOf(det(x, "roomId"))} · {idx.nameOf(det(x, "instructorId"))}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
