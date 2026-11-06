export type EducationRow = {
  id: number; kind: string; name: string; branchId: number | null;
  status: string; details: Record<string, unknown>; createdAt: string;
};
const at = "2026-11-01T08:00:00.000Z";
function row(id: number, kind: string, name: string, branchId: number | null, details: Record<string, unknown>, status = "نشط"): EducationRow {
  return { id, kind, name, branchId, details, status, createdAt: at };
}
// Synthetic, public, read-only examples. Never mixed into authenticated workspaces.
export const demoRecords: EducationRow[] = [
  row(1, "branch", "المركز الرئيسي", null, { city: "الطائف", budget: 80000 }),
  row(2, "branch", "فرع الرياض", null, { city: "الرياض", budget: 60000 }),
  row(3, "branch", "فرع جدة", null, { city: "جدة", budget: 50000 }),
  row(4, "branch", "فرع الشرقية", null, { city: "الدمام", budget: 40000 }),
  row(5, "room", "معمل الحاسب الآلي", 1, { type: "عملي", area: 80, capacity: 24, powerKw: 12 }),
  row(6, "room", "قاعة التدريب ١", 2, { type: "نظري", area: 60, capacity: 30, powerKw: 5 }),
  row(7, "room", "معمل الشبكات", 3, { type: "عملي", area: 70, capacity: 20, powerKw: 10 }),
  row(8, "room", "قاعة التدريب ٢", 4, { type: "نظري", area: 55, capacity: 25, powerKw: 4 }),
  row(9, "diploma", "دبلوم تقنية المعلومات", null, { duration: "سنتان", fee: 24000 }),
  row(10, "diploma", "دبلوم إدارة الأعمال", null, { duration: "سنتان", fee: 20000 }),
  row(11, "diploma", "دبلوم الأمن السيبراني", null, { duration: "سنتان", fee: 28000 }),
  row(12, "student", "طالب توضيحي ١", 1, { diplomaId: 9, levelId: 31, fees: 24000 }),
  row(13, "student", "طالب توضيحي ٢", 2, { diplomaId: 10, fees: 20000 }),
  row(14, "student", "طالب توضيحي ٣", 3, { diplomaId: 11, fees: 28000 }),
  row(15, "instructor", "مدرب توضيحي ١", 1, { qualification: "ماجستير علوم الحاسب", hourlyRate: 150, weeklyHours: 18, subjectIds: [33] }),
  row(16, "instructor", "مدرب توضيحي ٢", 2, { qualification: "ماجستير إدارة الأعمال", hourlyRate: 140, weeklyHours: 16, subjectIds: [] }),
  row(17, "asset", "أجهزة حاسب تدريبية", 1, { roomId: 5, serial: "DEMO-PC-01", value: 24000, purchaseDate: "2026-01-15", maintenanceDate: "2026-12-01" }),
  row(18, "asset", "جهاز عرض تفاعلي", 2, { roomId: 6, serial: "DEMO-PR-01", value: 6500, purchaseDate: "2026-03-10", maintenanceDate: "2026-11-20" }),
  row(19, "expense", "مستلزمات تعليمية", 1, { category: "ورقيات", amount: 12000, date: "2026-11-01" }),
  row(20, "expense", "صيانة التكييف", 2, { category: "صيانة", amount: 43000, date: "2026-11-01" }),
  row(21, "expense", "تجهيزات المعامل", 3, { category: "مستلزمات", amount: 45500, date: "2026-11-02" }),
  row(22, "expense", "خدمات الحراسة", 4, { category: "حراسة", amount: 18000, date: "2026-11-02" }),
  row(23, "invoice", "فاتورة كهرباء المركز الرئيسي", 1, { meter: "DEMO-M1", month: "2026-11", kwh: 8200, amount: 6000 }),
  row(24, "invoice", "فاتورة كهرباء الرياض", 2, { meter: "DEMO-M2", month: "2026-11", kwh: 6500, amount: 6500 }),
  row(25, "invoice", "فاتورة كهرباء جدة", 3, { meter: "DEMO-M3", month: "2026-11", kwh: 7200, amount: 6000 }),
  row(26, "payment", "قسط الطالب التوضيحي ١", 1, { studentId: 12, amount: 12000, date: "2026-11-03" }),
  row(27, "payment", "قسط الطالب التوضيحي ٢", 2, { studentId: 13, amount: 10000, date: "2026-11-03" }),
  row(28, "payment", "قسط الطالب التوضيحي ٣", 3, { studentId: 14, amount: 14000, date: "2026-11-03" }),
  row(29, "session", "مقدمة البرمجة", 1, { roomId: 5, instructorId: 15, diplomaId: 9, studentIds: [12], date: "2026-11-05", start: "09:00", end: "11:00", subjectId: 33 }, "scheduled"),
  row(30, "session", "مبادئ الإدارة", 2, { roomId: 6, instructorId: 16, diplomaId: 10, studentIds: [13], date: "2026-11-05", start: "11:00", end: "13:00" }, "scheduled"),
  row(31, "level", "المستوى الأول", null, { diplomaId: 9, order: 1 }),
  row(32, "level", "المستوى الثاني", null, { diplomaId: 9, order: 2 }),
  row(33, "subject", "مقدمة البرمجة", null, { diplomaId: 9, levelId: 31, price: 3000, hours: 40, prerequisiteIds: [] }, "active"),
  row(34, "subject", "قواعد البيانات", null, { diplomaId: 9, levelId: 32, price: 3500, hours: 40, prerequisiteIds: [33] }, "active"),
  row(35, "installment", "القسط الأول", 1, { studentId: 12, amount: 12000, dueDate: "2026-11-03" }, "pending"),
  row(36, "installment", "القسط الثاني", 1, { studentId: 12, amount: 12000, dueDate: "2026-12-15" }, "pending"),
  row(37, "session", "حصة منعقدة — مقدمة البرمجة", 1, { roomId: 5, instructorId: 15, diplomaId: 9, subjectId: 33, studentIds: [12], date: "2026-11-04", start: "09:00", end: "11:00" }, "done"),
];

export function summarize(records: EducationRow[]) {
  const count = (kind: string) => records.filter(r => r.kind === kind).length;
  const sum = (items: EducationRow[]) => Math.round(items.reduce((s, r) => s + Number(r.details.amount || 0), 0) * 100) / 100;
  return {
    students: count("student"), instructors: count("instructor"), branches: count("branch"), diplomas: count("diploma"),
    expenses: sum(records.filter(r => r.kind === "expense" || r.kind === "invoice")),
    collected: sum(records.filter(r => r.kind === "payment")),
    branchSummaries: records.filter(r => r.kind === "branch").map(b => {
      const subset = records.filter(r => r.branchId === b.id);
      const budget = Number(b.details.budget || 0);
      const spent = sum(subset.filter(r => r.kind === "expense" || r.kind === "invoice"));
      const usage = budget > 0 ? Math.round(spent / budget * 1000) / 10 : 0;
      return { id: b.id, name: b.name, budget, spent, collected: sum(subset.filter(r => r.kind === "payment")),
        students: subset.filter(r => r.kind === "student").length, rooms: subset.filter(r => r.kind === "room").length,
        usage, alert: budget === 0 && spent > 0 ? "ميزانية غير محددة" : usage >= 100 ? "تجاوز الميزانية" : usage >= 80 ? "اقتراب من الحد" : "ضمن الميزانية" };
    }),
    recent: [...records].sort((a,b) => b.createdAt.localeCompare(a.createdAt) || b.id-a.id).slice(0,6),
  };
}
