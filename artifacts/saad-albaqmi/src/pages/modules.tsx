import { useMemo } from "react";
import { PageHeader, Kpi, ErrorState } from "@/components/bits";
import { RecordModule } from "@/components/record-module";
import { Overview } from "@/components/overview";
import { useRecords, useRecordIndex, usePageTitle, useWorkspace } from "@/hooks/use-data";
import { det, fmtSAR, fmtNum, num, toMinutes } from "@/lib/domain";

export function DashboardPage() {
  usePageTitle("النظرة التنفيذية");
  const ws = useWorkspace();
  return (
    <>
      <PageHeader eyebrow={ws.data?.label ?? "مساحة العمل"} title="النظرة التنفيذية" desc="ملخص محسوب من السجلات الفعلية في مساحة عملك: الميزانيات مقابل المصروف، والتحصيل، والطاقة الاستيعابية." />
      <Overview />
    </>
  );
}

export function BranchesPage() {
  usePageTitle("الفروع");
  return (<><PageHeader eyebrow="الهيكل" title="الفروع" desc="المركز الرئيسي والفروع الحالية والمستقبلية. الميزانية هنا سقف للمقارنة، لا مصروف فعلي." /><RecordModule kinds={["branch"]} /></>);
}
export function RoomsPage() {
  usePageTitle("القاعات والمعامل");
  return (<><PageHeader eyebrow="المرافق" title="القاعات والمعامل" desc="النوع والمساحة والسعة وقدرة الأجهزة لكل قاعة؛ تعتمد عليها الجدولة وتوزيع الأصول." /><RecordModule kinds={["room"]} /></>);
}
export function AssetsPage() {
  usePageTitle("الأصول والجرد");
  return (<><PageHeader eyebrow="الجرد" title="الأصول" desc="الأجهزة والتجهيزات بموقعها وقيمتها وموعد صيانتها." /><RecordModule kinds={["asset"]} /></>);
}
export function DiplomasPage() {
  usePageTitle("الدبلومات");
  return (<><PageHeader eyebrow="المناهج" title="الدبلومات" desc="المدة والرسوم والمستويات والمواد لكل برنامج تدريبي." /><RecordModule kinds={["diploma"]} /></>);
}
export function StudentsPage() {
  usePageTitle("الطلاب");
  return (<><PageHeader eyebrow="الأكاديمية" title="الطلاب" desc="التسجيل والرسوم والحضور والدرجات. الرسوم المستحقة منفصلة عن المدفوعات المحصلة." /><RecordModule kinds={["student", "attendance", "grade"]} /></>);
}
export function InstructorsPage() {
  usePageTitle("المدربون");
  return (<><PageHeader eyebrow="الكادر" title="المدربون" desc="المؤهلات والأجور والساعات الأسبوعية والمواد المسندة." /><RecordModule kinds={["instructor"]} /></>);
}

export function FinancePage() {
  usePageTitle("المالية");
  const records = useRecords();
  const idx = useRecordIndex(records.data);
  const t = useMemo(() => {
    const exp = idx.of("expense").reduce((a, r) => a + num(det(r, "amount")), 0);
    const inv = idx.of("invoice").reduce((a, r) => a + num(det(r, "amount")), 0);
    const kwh = idx.of("invoice").reduce((a, r) => a + num(det(r, "kwh")), 0);
    const pay = idx.of("payment").reduce((a, r) => a + num(det(r, "amount")), 0);
    const due = idx.of("student").reduce((a, r) => a + num(det(r, "fees")), 0);
    return { exp, inv, kwh, pay, due };
  }, [idx]);
  const strip = (
    <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
      <Kpi label="مصروفات تشغيلية" value={fmtSAR(t.exp)} />
      <Kpi delay={50} label="فواتير خدمات" value={fmtSAR(t.inv)} sub={`${fmtNum(t.kwh)} ك.واط.س`} />
      <Kpi delay={100} label="رسوم مستحقة" value={fmtSAR(t.due)} />
      <Kpi delay={150} label="محصل فعليًا" value={fmtSAR(t.pay)} />
      <Kpi delay={200} tone="accent" label="متبقٍ للتحصيل" value={fmtSAR(Math.max(0, t.due - t.pay))} />
    </div>
  );
  return (
    <>
      <PageHeader eyebrow="المالية" title="المصروفات والفواتير والمدفوعات" desc="أرقام مجمعة من السجلات المدخلة فقط. لا تُعد قوائم مالية نهائية قبل اعتماد سياسات الأقساط والضرائب والإهلاك." />
      {records.isError ? <ErrorState error={records.error} onRetry={() => records.refetch()} /> : strip}
      <RecordModule kinds={["expense", "invoice", "payment"]} />
    </>
  );
}

export function SchedulePage() {
  usePageTitle("الجدولة");
  const records = useRecords();
  const idx = useRecordIndex(records.data);
  const conflicts = useMemo(() => {
    const out: string[] = [];
    const ss = idx.of("session").filter((s) => s.status !== "cancelled");
    for (let i = 0; i < ss.length; i++) for (let j = i + 1; j < ss.length; j++) {
      const a = ss[i], b = ss[j];
      if (det(a, "date") !== det(b, "date")) continue;
      const overlap = toMinutes(String(det(a, "start"))) < toMinutes(String(det(b, "end"))) && toMinutes(String(det(b, "start"))) < toMinutes(String(det(a, "end")));
      if (!overlap) continue;
      if (det(a, "roomId") && det(a, "roomId") === det(b, "roomId")) out.push(`«${a.name}» و«${b.name}» في القاعة نفسها (${idx.nameOf(det(a, "roomId"))})`);
      if (det(a, "instructorId") && det(a, "instructorId") === det(b, "instructorId")) out.push(`«${a.name}» و«${b.name}» للمدرب نفسه (${idx.nameOf(det(a, "instructorId"))})`);
    }
    return out;
  }, [idx]);
  const panel = (
    <div className={`mb-5 rounded-xl border p-4 text-sm ${conflicts.length ? "border-destructive/30 bg-destructive/5" : "border-success/30 bg-success/5"}`} data-testid="panel-conflicts">
      <div className="font-medium">{conflicts.length ? `رُصد ${conflicts.length} تعارض في السجلات الحالية` : "لا توجد تعارضات في الحصص المسجلة"}</div>
      {conflicts.length > 0 && <ul className="mt-2 list-disc space-y-1 pr-5 text-xs">{conflicts.map((c, i) => <li key={i}>{c}</li>)}</ul>}
      <p className="mt-2 text-[11px] text-muted-foreground">الجدولة يدوية. يرفض الخادم عند الحفظ تعارض القاعة أو المدرب أو الطلاب، وتجاوز السعة، والربط بفرع مختلف، وتظهر رسالته كما هي.</p>
    </div>
  );
  return (
    <>
      <PageHeader eyebrow="التشغيل" title="الجدولة والحصص" desc="أنشئ الحصص وحدد القاعة والمدرب والطلاب. لا توجد جدولة تلقائية في هذا الإصدار." />
      <RecordModule kinds={["session", "attendance"]} extra={{ session: panel }} />
    </>
  );
}
