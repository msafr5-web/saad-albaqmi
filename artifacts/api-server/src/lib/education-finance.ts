import type { EducationRow } from "./education-demo";

const round = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const minutes = (t: unknown) => { const [h, m] = String(t ?? "").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
export const todayISO = () => new Date().toISOString().slice(0, 10);

/** Instructor dues come only from sessions with status "done" (actually held), never from planned assignments. */
export function computePayroll(records: EducationRow[], from?: string, to?: string) {
  const inRange = (d: unknown) => typeof d === "string" && (!from || d >= from) && (!to || d <= to);
  const hours = (s: EducationRow) => Math.max(0, minutes(s.details.end) - minutes(s.details.start)) / 60;
  const sessions = records.filter(r => r.kind === "session" && inRange(r.details.date));
  const lines = records.filter(r => r.kind === "instructor").map(i => {
    const mine = sessions.filter(s => s.details.instructorId === i.id);
    const held = mine.filter(s => s.status === "done");
    const scheduled = mine.filter(s => s.status === "scheduled");
    const heldHours = round(held.reduce((a, s) => a + hours(s), 0));
    return {
      instructorId: i.id, name: i.name, branchId: i.branchId, hourlyRate: num(i.details.hourlyRate),
      heldSessions: held.length, heldHours, earned: round(heldHours * num(i.details.hourlyRate)),
      scheduledSessions: scheduled.length, scheduledHours: round(scheduled.reduce((a, s) => a + hours(s), 0)),
    };
  });
  return { from: from ?? null, to: to ?? null, total: round(lines.reduce((a, l) => a + l.earned, 0)), lines };
}

/** Payments are allocated to installments oldest-due first; the remainder is reported as unallocated. */
export function computeLedger(records: EducationRow[], today = todayISO()) {
  return records.filter(r => r.kind === "student").map(st => {
    const payments = records.filter(r => r.kind === "payment" && r.details.studentId === st.id)
      .sort((a, b) => String(a.details.date).localeCompare(String(b.details.date)) || a.id - b.id);
    const paid = round(payments.reduce((a, p) => a + num(p.details.amount), 0));
    let pool = paid;
    const installments = records.filter(r => r.kind === "installment" && r.details.studentId === st.id)
      .sort((a, b) => String(a.details.dueDate).localeCompare(String(b.details.dueDate)) || a.id - b.id)
      .map(i => {
        const amount = num(i.details.amount);
        const applied = round(Math.min(pool, amount));
        pool = round(pool - applied);
        const remaining = round(amount - applied);
        const dueDate = String(i.details.dueDate);
        const state = remaining === 0 ? "paid" as const : dueDate < today ? "overdue" as const : applied > 0 ? "partial" as const : "pending" as const;
        return { id: i.id, name: i.name, dueDate, amount, paid: applied, remaining, state };
      });
    const fees = num(st.details.fees);
    return {
      studentId: st.id, name: st.name, branchId: st.branchId,
      diplomaId: typeof st.details.diplomaId === "number" ? st.details.diplomaId : null,
      fees, planned: round(installments.reduce((a, i) => a + i.amount, 0)), paid, balance: round(Math.max(0, fees - paid)),
      overdue: round(installments.filter(i => i.state === "overdue").reduce((a, i) => a + i.remaining, 0)),
      unallocated: round(Math.max(0, pool)), installments,
      payments: payments.map(p => ({ id: p.id, name: p.name, date: String(p.details.date), amount: num(p.details.amount) })),
    };
  });
}
