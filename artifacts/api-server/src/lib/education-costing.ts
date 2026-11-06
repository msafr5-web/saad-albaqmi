import type { EducationRow } from "./education-demo";
import { DomainError } from "./education-validation";

/**
 * Cost policy. Every field is chosen by the institute; nothing here has a default.
 * Calculations run only against an approved (frozen) copy of this policy.
 */
export type CostPolicy = {
  period: { from: string; to: string };
  components: { expenses: boolean; electricity: boolean; depreciation: boolean; instructorPay: boolean };
  electricity: { method: "meter" | "area" | "power_hours"; meterAssignments: { meter: string; roomId: number }[] } | null;
  depreciation: { method: "straight_line"; usefulLifeMonths: number; salvagePercent: number; startConvention: "purchase_month" | "next_month" } | null;
  revenueRecognition: "cash" | "installment_due";
  basis: string;
};

const round = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v).toISOString().slice(0, 10) === v;
const minutes = (t: unknown) => { const [h, m] = String(t ?? "").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const wholeMonths = (from: string, to: string) => from.slice(8) === "01" && to === new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)), 0)).toISOString().slice(0, 10);
const monthIndex = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;

export function validatePolicy(raw: unknown, rooms: EducationRow[]): CostPolicy {
  const bad = (m: string): never => { throw new DomainError(m); };
  if (!raw || typeof raw !== "object") return bad("السياسة غير صحيحة");
  const p = raw as Record<string, any>;
  if (!isDate(p.period?.from) || !isDate(p.period?.to) || p.period.from > p.period.to) bad("فترة الميزانية غير صحيحة");
  if (!wholeMonths(p.period.from, p.period.to)) bad("يجب أن تبدأ الفترة في أول الشهر وتنتهي في آخره");
  const c = p.components ?? {};
  for (const k of ["expenses", "electricity", "depreciation", "instructorPay"]) if (typeof c[k] !== "boolean") bad("حدد مكونات التكلفة المعتمدة كلها");
  if (!Object.values(c).some(Boolean)) bad("يجب اعتماد مكوّن تكلفة واحد على الأقل");
  let electricity: CostPolicy["electricity"] = null;
  if (c.electricity) {
    const e = p.electricity;
    if (!e || !["meter", "area", "power_hours"].includes(e.method)) return bad("اختر طريقة توزيع الكهرباء");
    const list = Array.isArray(e.meterAssignments) ? e.meterAssignments : [];
    if (e.method === "meter") {
      if (list.length === 0) bad("حدد القاعة التابعة لكل عداد فرعي");
      const seen = new Set<string>();
      for (const a of list) {
        const meter = typeof a?.meter === "string" ? a.meter.trim() : "";
        if (!meter || seen.has(meter)) bad("رقم العداد مطلوب وغير مكرر");
        seen.add(meter);
        if (!rooms.some(r => r.id === a.roomId && r.kind === "room")) bad("قاعة العداد غير موجودة");
      }
    }
    electricity = { method: e.method, meterAssignments: e.method === "meter" ? list.map((a: any) => ({ meter: a.meter.trim(), roomId: a.roomId })) : [] };
  }
  let depreciation: CostPolicy["depreciation"] = null;
  if (c.depreciation) {
    const d = p.depreciation;
    if (!d || d.method !== "straight_line") return bad("اختر طريقة الإهلاك");
    if (!Number.isInteger(d.usefulLifeMonths) || d.usefulLifeMonths < 1 || d.usefulLifeMonths > 600) bad("العمر الإنتاجي بالأشهر غير صحيح");
    if (typeof d.salvagePercent !== "number" || d.salvagePercent < 0 || d.salvagePercent > 100) bad("نسبة القيمة المتبقية غير صحيحة");
    if (!["purchase_month", "next_month"].includes(d.startConvention)) bad("اختر بداية احتساب الإهلاك");
    depreciation = { method: "straight_line", usefulLifeMonths: d.usefulLifeMonths, salvagePercent: d.salvagePercent, startConvention: d.startConvention };
  }
  if (!["cash", "installment_due"].includes(p.revenueRecognition)) bad("اختر طريقة الاعتراف بالإيراد");
  const basis = typeof p.basis === "string" ? p.basis.trim() : "";
  if (!basis || basis.length > 500) bad("اذكر مرجع اعتماد السياسة (حتى 500 حرف)");
  return { period: { from: p.period.from, to: p.period.to }, components: { expenses: c.expenses, electricity: c.electricity, depreciation: c.depreciation, instructorPay: c.instructorPay }, electricity, depreciation, revenueRecognition: p.revenueRecognition, basis };
}

const isElectricityExpense = (r: EducationRow) => /كهرب|electric/i.test(String(r.details.category ?? "") + " " + r.name);

export function computeCostReport(records: EducationRow[], policy: CostPolicy, from = policy.period.from, to = policy.period.to) {
  if (!isDate(from) || !isDate(to) || from > to) throw new DomainError("نطاق التاريخ غير صحيح");
  if (!wholeMonths(from, to)) throw new DomainError("التقارير تُحتسب بأشهر كاملة: ابدأ من أول الشهر وانتهِ في آخره");
  if (from < policy.period.from || to > policy.period.to) throw new DomainError("النطاق خارج فترة الميزانية المعتمدة");
  const inRange = (d: unknown) => isDate(d) && d >= from && d <= to;
  const mFrom = monthIndex(from.slice(0, 7)), mTo = monthIndex(to.slice(0, 7));
  const warnings: string[] = [];
  const of = (k: string) => records.filter(r => r.kind === k);
  const branches = of("branch"), rooms = of("room");
  const sessionsDone = of("session").filter(s => s.status === "done" && inRange(s.details.date));
  const hoursOf = (s: EducationRow) => Math.max(0, minutes(s.details.end) - minutes(s.details.start)) / 60;

  // Invoices: one per branch+meter+month, so a duplicated bill is never counted twice.
  const seen = new Set<string>();
  const invoices = of("invoice").filter(i => {
    const month = String(i.details.month ?? "");
    if (!/^\d{4}-\d{2}$/.test(month) || monthIndex(month) < mFrom || monthIndex(month) > mTo) return false;
    const key = `${i.branchId}|${i.details.meter}|${month}`;
    if (seen.has(key)) { warnings.push(`فاتورة كهرباء مكررة استُبعدت: ${i.name} (${month})`); return false; }
    seen.add(key); return true;
  });
  const electricityOn = policy.components.electricity;
  const expenses = of("expense").filter(e => inRange(e.details.date)).filter(e => {
    if (electricityOn && isElectricityExpense(e)) { warnings.push(`مصروف كهرباء استُبعد لأن الكهرباء تُحتسب من الفواتير: ${e.name}`); return false; }
    return true;
  });

  const room = new Map(rooms.map(r => [r.id, { roomId: r.id, name: r.name, branchId: r.branchId, heldHours: 0, electricity: 0, depreciation: 0 }]));
  const roomDiplomaHours = new Map<number, Map<number, number>>();
  for (const s of sessionsDone) {
    const rid = s.details.roomId as number, did = s.details.diplomaId as number, h = hoursOf(s);
    const r = room.get(rid); if (r) r.heldHours += h;
    const m = roomDiplomaHours.get(rid) ?? new Map<number, number>();
    m.set(did, (m.get(did) ?? 0) + h); roomDiplomaHours.set(rid, m);
  }

  const unallocatedElectricity = new Map<number, number>();
  const addUn = (b: number | null, v: number) => { if (b != null) unallocatedElectricity.set(b, round((unallocatedElectricity.get(b) ?? 0) + v)); };
  if (electricityOn && policy.electricity) {
    const { method, meterAssignments } = policy.electricity;
    for (const b of branches) {
      const bi = invoices.filter(i => i.branchId === b.id);
      const bRooms = rooms.filter(r => r.branchId === b.id);
      if (method === "meter") {
        for (const i of bi) {
          const a = meterAssignments.find(x => x.meter === i.details.meter && bRooms.some(r => r.id === x.roomId));
          if (a) room.get(a.roomId)!.electricity += num(i.details.amount); else addUn(b.id, num(i.details.amount));
        }
      } else {
        // Allocated month by month: a room only shares the bill of a month in which it has weight (area, or kW × hours held that month).
        for (const month of [...new Set(bi.map(i => String(i.details.month)))]) {
          const held = new Map<number, number>();
          for (const s of sessionsDone) if (String(s.details.date).slice(0, 7) === month) held.set(s.details.roomId as number, (held.get(s.details.roomId as number) ?? 0) + hoursOf(s));
          const weight = (r: EducationRow) => method === "area" ? num(r.details.area) : num(r.details.powerKw) * (held.get(r.id) ?? 0);
          const total = bRooms.reduce((a, r) => a + weight(r), 0);
          const pool = bi.filter(i => String(i.details.month) === month).reduce((a, i) => a + num(i.details.amount), 0);
          if (total > 0) for (const r of bRooms) room.get(r.id)!.electricity += pool * weight(r) / total; else addUn(b.id, pool);
        }
      }
    }
  }

  if (policy.components.depreciation && policy.depreciation) {
    const d = policy.depreciation;
    for (const a of of("asset")) {
      const pd = a.details.purchaseDate;
      if (!isDate(pd)) { warnings.push(`أصل بلا تاريخ شراء استُبعد من الإهلاك: ${a.name}`); continue; }
      const start = monthIndex(pd.slice(0, 7)) + (d.startConvention === "next_month" ? 1 : 0);
      const lo = Math.max(start, mFrom), hi = Math.min(start + d.usefulLifeMonths - 1, mTo);
      const months = Math.max(0, hi - lo + 1);
      const monthly = num(a.details.value) * (1 - d.salvagePercent / 100) / d.usefulLifeMonths;
      const r = room.get(a.details.roomId as number);
      if (r) r.depreciation += monthly * months;
    }
  }

  const students = of("student");
  const studentById = new Map(students.map(s => [s.id, s]));
  const revenueItems: { branchId: number | null; diplomaId: number | null; amount: number }[] = [];
  const addRev = (studentId: unknown, amount: number) => { const s = studentById.get(studentId as number); if (s) revenueItems.push({ branchId: s.branchId, diplomaId: typeof s.details.diplomaId === "number" ? s.details.diplomaId : null, amount }); };
  if (policy.revenueRecognition === "cash") for (const p of of("payment").filter(p => inRange(p.details.date))) addRev(p.details.studentId, num(p.details.amount));
  else for (const i of of("installment").filter(i => inRange(i.details.dueDate))) addRev(i.details.studentId, num(i.details.amount));

  const pay = policy.components.instructorPay ? sessionsDone.map(s => {
    const ins = records.find(r => r.id === s.details.instructorId && r.kind === "instructor");
    return { branchId: s.branchId, diplomaId: s.details.diplomaId as number, amount: hoursOf(s) * num(ins?.details.hourlyRate) };
  }) : [];

  const sumBy = (items: { amount: number }[]) => items.reduce((a, i) => a + i.amount, 0);
  const branchRows = branches.map(b => {
    const rs = [...room.values()].filter(r => r.branchId === b.id);
    const cost = {
      expenses: policy.components.expenses ? round(sumBy(expenses.filter(e => e.branchId === b.id).map(e => ({ amount: num(e.details.amount) })))) : 0,
      electricity: electricityOn ? round(rs.reduce((a, r) => a + r.electricity, 0) + (unallocatedElectricity.get(b.id) ?? 0)) : 0,
      depreciation: round(rs.reduce((a, r) => a + r.depreciation, 0)),
      instructorPay: round(sumBy(pay.filter(p => p.branchId === b.id))),
    };
    const totalCost = round(cost.expenses + cost.electricity + cost.depreciation + cost.instructorPay);
    const revenue = round(sumBy(revenueItems.filter(r => r.branchId === b.id)));
    const count = students.filter(s => s.branchId === b.id).length;
    return { branchId: b.id, name: b.name, revenue, cost, totalCost, margin: round(revenue - totalCost), students: count,
      costPerStudent: count ? round(totalCost / count) : null, unallocatedElectricity: unallocatedElectricity.get(b.id) ?? 0 };
  });

  const diplomaRows = of("diploma").map(dp => {
    let electricity = 0, depreciation = 0;
    for (const [rid, byDip] of roomDiplomaHours) {
      const total = [...byDip.values()].reduce((a, h) => a + h, 0), mine = byDip.get(dp.id) ?? 0;
      if (!total || !mine) continue;
      electricity += room.get(rid)!.electricity * mine / total; depreciation += room.get(rid)!.depreciation * mine / total;
    }
    const instructorPay = sumBy(pay.filter(p => p.diplomaId === dp.id));
    const cost = { electricity: round(electricity), depreciation: round(depreciation), instructorPay: round(instructorPay) };
    const totalCost = round(cost.electricity + cost.depreciation + cost.instructorPay);
    const revenue = round(sumBy(revenueItems.filter(r => r.diplomaId === dp.id)));
    const count = students.filter(s => s.details.diplomaId === dp.id).length;
    return { diplomaId: dp.id, name: dp.name, revenue, cost, totalCost, margin: round(revenue - totalCost), students: count, costPerStudent: count ? round(totalCost / count) : null };
  });

  if (policy.components.expenses) warnings.push("المصروفات العامة تُعرض على مستوى الفرع فقط ولا تُوزع على الدبلومات لعدم وجود ربط بين المصروف والدبلوم.");
  if (policy.components.depreciation || electricityOn) warnings.push("تكلفة الكهرباء والإهلاك تُحمَّل على الدبلومات حسب ساعات الحصص المنعقدة فعليًا في كل قاعة؛ ما لا حصص منعقدة له يبقى غير موزع على دبلوم.");
  warnings.push("عدد الطلاب هو العدد المسجل حاليًا وليس متوسط الفترة.");
  const roomRows = [...room.values()].map(r => ({ ...r, heldHours: round(r.heldHours), electricity: round(r.electricity), depreciation: round(r.depreciation) }));
  return { period: { from, to }, branches: branchRows, diplomas: diplomaRows, rooms: roomRows,
    totals: { revenue: round(sumBy(branchRows.map(b => ({ amount: b.revenue })))), totalCost: round(sumBy(branchRows.map(b => ({ amount: b.totalCost })))) },
    warnings };
}
