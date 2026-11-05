import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorState, Kpi, LoadingRows } from "@/components/bits";
import { useWorkspace } from "@/hooks/use-data";
import { useLedger, usePayroll, useRecordIndex, useRecords } from "@/hooks/use-data";
import { fmtDate, fmtDec, fmtSAR } from "@/lib/domain";
import { cn } from "@/lib/utils";

const INST_STATE: Record<string, { label: string; cls: string }> = {
  paid: { label: "مسدد", cls: "text-success" },
  partial: { label: "سداد جزئي", cls: "text-warning" },
  pending: { label: "قادم", cls: "text-muted-foreground" },
  overdue: { label: "متأخر", cls: "text-destructive" },
};

function PayrollPanelBody() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const payroll = usePayroll(from, to);
  const d = payroll.data;
  return (
    <section className="mb-6 rounded-xl border bg-card p-4" data-testid="panel-payroll">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-display text-lg text-primary">مستحقات المدربين</h3>
          <p className="text-[11px] text-muted-foreground">تُحسب من الحصص المنعقدة فعليًا فقط (حالة «منعقد») × أجر الساعة. الحصص المجدولة تظهر منفصلة ولا تدخل في المستحق.</p>
        </div>
        <div className="flex gap-2">
          <div><Label className="mb-1 block text-[11px]">من</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="num h-8 w-36" data-testid="input-payroll-from" /></div>
          <div><Label className="mb-1 block text-[11px]">إلى</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="num h-8 w-36" data-testid="input-payroll-to" /></div>
        </div>
      </div>
      {payroll.isLoading ? <LoadingRows rows={3} /> : payroll.isError ? <ErrorState error={payroll.error} onRetry={() => payroll.refetch()} /> : d && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3"><Kpi label="إجمالي المستحق" value={fmtSAR(d.total)} tone="accent" /><Kpi label="ساعات منعقدة" value={fmtDec(d.lines.reduce((a, l) => a + l.heldHours, 0))} /></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-right text-[11px] text-muted-foreground">
                {["المدرب", "أجر الساعة", "حصص منعقدة", "ساعات منعقدة", "المستحق", "مجدولة (غير محتسبة)"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}
              </tr></thead>
              <tbody>
                {d.lines.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-muted-foreground">لا يوجد مدربون بعد.</td></tr>}
                {d.lines.map((l) => (
                  <tr key={l.instructorId} className="border-b border-border/60 last:border-0" data-testid={`row-payroll-${l.instructorId}`}>
                    <td className="px-3 py-2 font-medium">{l.name}</td>
                    <td className="num px-3 py-2">{fmtSAR(l.hourlyRate)}</td>
                    <td className="num px-3 py-2">{l.heldSessions}</td>
                    <td className="num px-3 py-2">{fmtDec(l.heldHours)}</td>
                    <td className="num px-3 py-2 font-semibold text-primary">{fmtSAR(l.earned)}</td>
                    <td className="num px-3 py-2 text-muted-foreground">{l.scheduledSessions} حصة · {fmtDec(l.scheduledHours)} ساعة</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function LedgerPanelBody() {
  const ledger = useLedger();
  const records = useRecords();
  const idx = useRecordIndex(records.data);
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section className="mb-6 rounded-xl border bg-card p-4" data-testid="panel-ledger">
      <h3 className="font-display text-lg text-primary">السجل المالي للطالب</h3>
      <p className="mb-3 text-[11px] text-muted-foreground">الرسوم وخطة الأقساط والمدفوعات؛ تُوزَّع المدفوعات على الأقساط الأقدم استحقاقًا، ويُعد القسط متأخرًا إذا تجاوز تاريخه ولم يُسدد.</p>
      {ledger.isLoading ? <LoadingRows rows={3} /> : ledger.isError ? <ErrorState error={ledger.error} onRetry={() => ledger.refetch()} /> : !ledger.data?.length ? (
        <p className="py-6 text-center text-xs text-muted-foreground">لا يوجد طلاب بعد.</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {ledger.data.map((l) => (
            <div key={l.studentId} data-testid={`ledger-${l.studentId}`}>
              <button className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-right hover:bg-muted/40" onClick={() => setOpen(open === l.studentId ? null : l.studentId)}>
                <span className="font-medium">{l.name} <span className="text-[11px] text-muted-foreground">· {idx.nameOf(l.diplomaId)}</span></span>
                <span className="num flex flex-wrap gap-x-4 text-xs">
                  <span>الرسوم {fmtSAR(l.fees)}</span><span>المدفوع {fmtSAR(l.paid)}</span>
                  <span className="font-semibold">المتبقي {fmtSAR(l.balance)}</span>
                  {l.overdue > 0 && <span className="text-destructive">متأخر {fmtSAR(l.overdue)}</span>}
                </span>
              </button>
              {open === l.studentId && (
                <div className="grid gap-4 bg-muted/20 px-4 py-3 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs font-medium">الأقساط (المخطط {fmtSAR(l.planned)} من {fmtSAR(l.fees)})</div>
                    {l.installments.length === 0 ? <p className="text-xs text-muted-foreground">لم تُحدد خطة أقساط لهذا الطالب.</p> : l.installments.map((i) => (
                      <div key={i.id} className="flex justify-between border-b py-1.5 text-xs last:border-0">
                        <span>{i.name} · <span className="num">{fmtDate(i.dueDate)}</span></span>
                        <span className="num">{fmtSAR(i.paid)} / {fmtSAR(i.amount)} <b className={cn("mr-1", INST_STATE[i.state].cls)}>{INST_STATE[i.state].label}</b></span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-medium">المدفوعات</div>
                    {l.payments.length === 0 ? <p className="text-xs text-muted-foreground">لا توجد مدفوعات.</p> : l.payments.map((p) => (
                      <div key={p.id} className="flex justify-between border-b py-1.5 text-xs last:border-0"><span>{p.name} · <span className="num">{fmtDate(p.date)}</span></span><span className="num">{fmtSAR(p.amount)}</span></div>
                    ))}
                    {l.unallocated > 0 && <p className="mt-1 text-[11px] text-muted-foreground">مبلغ غير موزع على أقساط: {fmtSAR(l.unallocated)}</p>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function PayrollPanel() {
  const ws = useWorkspace();
  return ws.data?.canViewPayroll ? <PayrollPanelBody /> : null;
}
export function LedgerPanel() {
  const ws = useWorkspace();
  return ws.data?.canViewLedger ? <LedgerPanelBody /> : null;
}
