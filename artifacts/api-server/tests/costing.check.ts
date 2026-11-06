import assert from "node:assert/strict";
import { computeCostReport, type CostPolicy } from "../src/lib/education-costing";
import type { EducationRow } from "../src/lib/education-demo";

let id = 0;
const R = (kind: string, name: string, branchId: number | null, details: Record<string, unknown>, status = "نشط"): EducationRow =>
  ({ id: ++id, kind, name, branchId, details, status, createdAt: "2026-01-01T00:00:00.000Z" });

const policy = (over: Partial<CostPolicy> & { components?: Partial<CostPolicy["components"]> }): CostPolicy => ({
  period: { from: "2026-01-01", to: "2026-03-31" },
  components: { expenses: false, electricity: false, depreciation: false, instructorPay: false, ...over.components },
  electricity: over.electricity ?? null,
  depreciation: over.depreciation ?? null,
  revenueRecognition: over.revenueRecognition ?? "cash",
  basis: "test",
});

const branch = R("branch", "فرع", null, {});
const dip = R("diploma", "دبلوم", null, {});
const roomA = R("room", "A", branch.id, { area: 30, powerKw: 10 });
const roomB = R("room", "B", branch.id, { area: 70, powerKw: 5 });
const session = (room: EducationRow, date: string, start: string, end: string) =>
  R("session", "s", branch.id, { roomId: room.id, diplomaId: dip.id, date, start, end }, "done");
const invoice = (month: string, meter: string, amount: number, name = "فاتورة") => R("invoice", name, branch.id, { month, meter, amount });
const roomRow = (rep: ReturnType<typeof computeCostReport>, r: EducationRow) => rep.rooms.find(x => x.roomId === r.id)!;
const base = [branch, dip, roomA, roomB];

// 1. Duplicate electricity bills (same branch+meter+month) counted once; other meter/month kept.
{
  const rep = computeCostReport([...base, invoice("2026-01", "M1", 1000), invoice("2026-01", "M1", 1000, "مكررة"), invoice("2026-01", "M2", 500), invoice("2026-02", "M1", 200)],
    policy({ components: { electricity: true }, electricity: { method: "area", meterAssignments: [] } }));
  assert.equal(rep.branches[0].cost.electricity, 1700);
  assert.equal(rep.warnings.filter(w => w.includes("مكررة")).length, 1);
  // Bills outside the range are ignored.
  const out = computeCostReport([...base, invoice("2026-06", "M1", 999)], policy({ components: { electricity: true }, electricity: { method: "area", meterAssignments: [] } }));
  assert.equal(out.branches[0].cost.electricity, 0);
  // Electricity expense lines are dropped when bills are used, kept otherwise.
  const exp = R("expense", "فاتورة كهرباء", branch.id, { date: "2026-01-10", amount: 300, category: "كهرباء" });
  const on = computeCostReport([...base, exp], policy({ components: { expenses: true, electricity: true }, electricity: { method: "area", meterAssignments: [] } }));
  assert.equal(on.branches[0].cost.expenses, 0);
  const off = computeCostReport([...base, exp], policy({ components: { expenses: true } }));
  assert.equal(off.branches[0].cost.expenses, 300);
}

// 2a. Area allocation: 30/70 split.
{
  const rep = computeCostReport([...base, invoice("2026-01", "M1", 1000)], policy({ components: { electricity: true }, electricity: { method: "area", meterAssignments: [] } }));
  assert.equal(roomRow(rep, roomA).electricity, 300);
  assert.equal(roomRow(rep, roomB).electricity, 700);
}
// 2b. kW × hours, per month: A 10kW×2h=20, B 5kW×2h=10 in Jan; only B has weight in Feb.
{
  const rep = computeCostReport([...base, invoice("2026-01", "M1", 900), invoice("2026-02", "M1", 600),
    session(roomA, "2026-01-05", "08:00", "10:00"), session(roomB, "2026-01-06", "08:00", "10:00"), session(roomB, "2026-02-06", "09:00", "11:00")],
    policy({ components: { electricity: true }, electricity: { method: "power_hours", meterAssignments: [] } }));
  assert.equal(roomRow(rep, roomA).electricity, 600);
  assert.equal(roomRow(rep, roomB).electricity, 900);
  // Month with no held hours is reported as unallocated, not lost.
  const none = computeCostReport([...base, invoice("2026-01", "M1", 400)], policy({ components: { electricity: true }, electricity: { method: "power_hours", meterAssignments: [] } }));
  assert.equal(none.branches[0].unallocatedElectricity, 400);
  assert.equal(none.branches[0].cost.electricity, 400);
}
// 2c. Meters: assigned meter goes to its room; unknown meter is unallocated.
{
  const rep = computeCostReport([...base, invoice("2026-01", "M1", 250), invoice("2026-01", "M9", 100)],
    policy({ components: { electricity: true }, electricity: { method: "meter", meterAssignments: [{ meter: "M1", roomId: roomB.id }] } }));
  assert.equal(roomRow(rep, roomB).electricity, 250);
  assert.equal(roomRow(rep, roomA).electricity, 0);
  assert.equal(rep.branches[0].unallocatedElectricity, 100);
  assert.equal(rep.branches[0].cost.electricity, 350);
}

// 3. Straight-line depreciation: value 12000, salvage 10%, life 12 months => 900/month.
{
  const asset = (pd: string) => R("asset", "أصل", branch.id, { roomId: roomA.id, value: 12000, purchaseDate: pd });
  const dep = (startConvention: "purchase_month" | "next_month"): CostPolicy["depreciation"] => ({ method: "straight_line", usefulLifeMonths: 12, salvagePercent: 10, startConvention });
  const run = (a: EducationRow, d: CostPolicy["depreciation"], from?: string, to?: string) =>
    roomRow(computeCostReport([...base, a], policy({ components: { depreciation: true }, depreciation: d }), from, to), roomA).depreciation;
  assert.equal(run(asset("2026-01-15"), dep("purchase_month")), 2700);
  assert.equal(run(asset("2026-01-15"), dep("next_month")), 1800);
  assert.equal(run(asset("2026-02-10"), dep("purchase_month"), "2026-02-01", "2026-02-28"), 900);
  assert.equal(run(asset("2026-02-10"), dep("purchase_month"), "2026-01-01", "2026-01-31"), 0, "no depreciation before purchase");
  // Life ended before the period: nothing charged.
  const old = R("asset", "قديم", branch.id, { roomId: roomA.id, value: 12000, purchaseDate: "2024-01-01" });
  assert.equal(run(old, dep("purchase_month")), 0);
  // Missing date excluded with a warning.
  const nd = computeCostReport([...base, R("asset", "بلا تاريخ", branch.id, { roomId: roomA.id, value: 1000 })], policy({ components: { depreciation: true }, depreciation: dep("purchase_month") }));
  assert.ok(nd.warnings.some(w => w.includes("بلا تاريخ")));
}

// 4. Revenue recognition: cash counts payments by payment date; installment_due by due date.
{
  const st = R("student", "طالب", branch.id, { diplomaId: dip.id });
  const recs = [...base, st,
    R("payment", "p1", branch.id, { studentId: st.id, date: "2026-01-10", amount: 500 }),
    R("payment", "p2", branch.id, { studentId: st.id, date: "2026-05-10", amount: 999 }),
    R("installment", "i1", branch.id, { studentId: st.id, dueDate: "2026-02-01", amount: 800 }),
    R("installment", "i2", branch.id, { studentId: st.id, dueDate: "2026-03-01", amount: 700 })];
  const cash = computeCostReport(recs, policy({ revenueRecognition: "cash" }));
  assert.equal(cash.totals.revenue, 500);
  assert.equal(cash.diplomas[0].revenue, 500);
  const due = computeCostReport(recs, policy({ revenueRecognition: "installment_due" }));
  assert.equal(due.totals.revenue, 1500);
  assert.equal(computeCostReport(recs, policy({ revenueRecognition: "installment_due" }), "2026-02-01", "2026-02-28").totals.revenue, 800);
}

console.log("costing checks passed");
