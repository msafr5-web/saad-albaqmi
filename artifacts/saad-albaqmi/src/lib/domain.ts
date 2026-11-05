import type { EducationRecord, RecordInputKind } from "@workspace/api-client-react";

export type Kind = RecordInputKind;

export type FieldType =
  | "text"
  | "number"
  | "date"
  | "time"
  | "email"
  | "tel"
  | "select"
  | "relation"
  | "multirelation"
  | "bool"
  | "list";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  relation?: Kind;
  options?: { value: string; label: string }[];
  suffix?: string;
  money?: boolean;
  hint?: string;
}

export interface KindDef {
  kind: Kind;
  label: string;
  singular: string;
  nameLabel: string;
  needsBranch: boolean;
  statuses: { value: string; label: string }[];
  fields: FieldDef[];
  columns: string[];
  empty: string;
}

const S = {
  active: { value: "active", label: "نشط" },
  planned: { value: "planned", label: "مخطط" },
  closed: { value: "closed", label: "مغلق" },
  maintenance: { value: "maintenance", label: "صيانة" },
  retired: { value: "retired", label: "مستبعد" },
  enrolled: { value: "enrolled", label: "مسجل" },
  graduated: { value: "graduated", label: "متخرج" },
  suspended: { value: "suspended", label: "موقوف" },
  paid: { value: "paid", label: "مدفوع" },
  pending: { value: "pending", label: "معلق" },
  overdue: { value: "overdue", label: "متأخر" },
  scheduled: { value: "scheduled", label: "مجدول" },
  done: { value: "done", label: "منعقد" },
  cancelled: { value: "cancelled", label: "ملغى" },
  recorded: { value: "recorded", label: "مسجل" },
  draft: { value: "draft", label: "مسودة" },
};

export const KINDS: Record<Kind, KindDef> = {
  branch: {
    kind: "branch", label: "الفروع", singular: "فرع", nameLabel: "اسم الفرع", needsBranch: false,
    statuses: [S.active, S.planned, S.closed],
    fields: [
      { key: "city", label: "المدينة", type: "text", required: true },
      { key: "budget", label: "الميزانية المخصصة", type: "number", required: true, money: true },
    ],
    columns: ["city", "budget"],
    empty: "ابدأ بالمركز الرئيسي، ثم أضف فروع الرياض وجدة والشرقية أو أي فرع مستقبلي.",
  },
  room: {
    kind: "room", label: "القاعات والمعامل", singular: "قاعة", nameLabel: "اسم القاعة", needsBranch: true,
    statuses: [S.active, S.maintenance, S.closed],
    fields: [
      { key: "type", label: "النوع", type: "select", required: true, options: [
        { value: "قاعة", label: "قاعة دراسية" }, { value: "معمل", label: "معمل" },
        { value: "ورشة", label: "ورشة" }, { value: "مكتب", label: "مكتب إداري" } ] },
      { key: "area", label: "المساحة", type: "number", required: true, suffix: "م²" },
      { key: "capacity", label: "السعة", type: "number", required: true, suffix: "مقعد" },
      { key: "powerKw", label: "قدرة الأجهزة", type: "number", suffix: "ك.واط" },
    ],
    columns: ["type", "capacity", "area", "powerKw"],
    empty: "أضف القاعات والمعامل لكل فرع لتتمكن من جدولة الحصص وتوزيع الأصول.",
  },
  asset: {
    kind: "asset", label: "الأصول", singular: "أصل", nameLabel: "اسم الأصل", needsBranch: true,
    statuses: [S.active, S.maintenance, S.retired],
    fields: [
      { key: "roomId", label: "القاعة", type: "relation", relation: "room", required: true },
      { key: "serial", label: "الرقم التسلسلي", type: "text" },
      { key: "maintenanceDate", label: "موعد الصيانة", type: "date" },
      { key: "value", label: "القيمة", type: "number", required: true, money: true },
    ],
    columns: ["roomId", "serial", "maintenanceDate", "value"],
    empty: "سجّل الأجهزة والأثاث مع موقعها وموعد صيانتها لتبني جردًا موثوقًا.",
  },
  diploma: {
    kind: "diploma", label: "الدبلومات", singular: "دبلوم", nameLabel: "اسم الدبلوم", needsBranch: false,
    statuses: [S.active, S.draft, S.closed],
    fields: [
      { key: "duration", label: "المدة", type: "text", required: true, hint: "مثال: 4 فصول" },
      { key: "fee", label: "الرسوم", type: "number", required: true, money: true },
    ],
    columns: ["duration", "fee"],
    empty: "عرّف الدبلومات بمددها ورسومها، ثم أضف مستوياتها ومواد كل مستوى.",
  },
  level: {
    kind: "level", label: "المستويات", singular: "مستوى", nameLabel: "اسم المستوى", needsBranch: false,
    statuses: [S.active, S.closed],
    fields: [
      { key: "diplomaId", label: "الدبلوم", type: "relation", relation: "diploma", required: true },
      { key: "order", label: "الترتيب", type: "number", required: true, hint: "1 للمستوى الأول" },
    ],
    columns: ["diplomaId", "order"],
    empty: "أضف مستويات كل دبلوم بترتيبها؛ تحدد المتطلبات السابقة للمواد.",
  },
  subject: {
    kind: "subject", label: "المواد", singular: "مادة", nameLabel: "اسم المادة", needsBranch: false,
    statuses: [S.active, S.closed],
    fields: [
      { key: "diplomaId", label: "الدبلوم", type: "relation", relation: "diploma", required: true },
      { key: "levelId", label: "المستوى", type: "relation", relation: "level", required: true },
      { key: "price", label: "سعر المادة", type: "number", required: true, money: true },
      { key: "hours", label: "الساعات", type: "number", required: true, suffix: "ساعة" },
      { key: "prerequisiteIds", label: "المتطلبات السابقة", type: "multirelation", relation: "subject", hint: "مواد من مستويات أسبق" },
    ],
    columns: ["diplomaId", "levelId", "price", "hours", "prerequisiteIds"],
    empty: "أضف مواد كل مستوى بسعرها وساعاتها ومتطلباتها السابقة.",
  },
  student: {
    kind: "student", label: "الطلاب", singular: "طالب", nameLabel: "اسم الطالب", needsBranch: true,
    statuses: [S.enrolled, S.graduated, S.suspended],
    fields: [
      { key: "diplomaId", label: "الدبلوم", type: "relation", relation: "diploma", required: true },
      { key: "levelId", label: "المستوى", type: "relation", relation: "level" },
      { key: "subjectIds", label: "المواد المسجلة", type: "multirelation", relation: "subject", hint: "عند الاختيار تُحسب الرسوم من أسعار المواد" },
      { key: "email", label: "البريد الإلكتروني", type: "email" },
      { key: "phone", label: "الجوال", type: "tel" },
      { key: "fees", label: "الرسوم المستحقة", type: "number", required: true, money: true },
    ],
    columns: ["diplomaId", "levelId", "phone", "fees"],
    empty: "سجّل الطلاب وربطهم بالدبلوم والفرع لتتبع الرسوم والحضور والدرجات.",
  },
  instructor: {
    kind: "instructor", label: "المدربون", singular: "مدرب", nameLabel: "اسم المدرب", needsBranch: true,
    statuses: [S.active, S.suspended],
    fields: [
      { key: "qualification", label: "المؤهل", type: "text" },
      { key: "hourlyRate", label: "أجر الساعة", type: "number", required: true, money: true },
      { key: "weeklyHours", label: "الساعات الأسبوعية", type: "number", required: true, suffix: "ساعة" },
      { key: "subjectIds", label: "المواد المسندة", type: "multirelation", relation: "subject" },
    ],
    columns: ["qualification", "hourlyRate", "weeklyHours", "subjectIds"],
    empty: "أضف المدربين بمؤهلاتهم وأجورهم وموادهم ليتاح تكليفهم بالحصص.",
  },
  expense: {
    kind: "expense", label: "المصروفات", singular: "مصروف", nameLabel: "البيان", needsBranch: true,
    statuses: [S.paid, S.pending],
    fields: [
      { key: "category", label: "الفئة", type: "select", required: true, options: [
        { value: "رواتب", label: "رواتب" }, { value: "إيجار", label: "إيجار" }, { value: "صيانة", label: "صيانة" },
        { value: "تجهيزات", label: "تجهيزات" }, { value: "تسويق", label: "تسويق" }, { value: "أخرى", label: "أخرى" } ] },
      { key: "amount", label: "المبلغ", type: "number", required: true, money: true },
      { key: "date", label: "التاريخ", type: "date", required: true },
    ],
    columns: ["category", "amount", "date"],
    empty: "سجّل المصروفات الفعلية مفصولة عن الميزانية لتظهر نسب الاستهلاك بدقة.",
  },
  invoice: {
    kind: "invoice", label: "فواتير الخدمات", singular: "فاتورة", nameLabel: "البيان", needsBranch: true,
    statuses: [S.paid, S.pending, S.overdue],
    fields: [
      { key: "meter", label: "رقم العداد", type: "text", required: true },
      { key: "month", label: "الشهر", type: "text", required: true, hint: "مثال: 2025-03" },
      { key: "kwh", label: "الاستهلاك", type: "number", required: true, suffix: "ك.واط.س" },
      { key: "amount", label: "المبلغ", type: "number", required: true, money: true },
    ],
    columns: ["meter", "month", "kwh", "amount"],
    empty: "أدخل فواتير الكهرباء والعدادات شهريًا لمتابعة كفاءة الطاقة لكل فرع.",
  },
  payment: {
    kind: "payment", label: "المدفوعات", singular: "دفعة", nameLabel: "البيان", needsBranch: true,
    statuses: [S.paid],
    fields: [
      { key: "studentId", label: "الطالب", type: "relation", relation: "student", required: true },
      { key: "amount", label: "المبلغ", type: "number", required: true, money: true },
      { key: "date", label: "التاريخ", type: "date", required: true },
    ],
    columns: ["studentId", "amount", "date"],
    empty: "سجّل الدفعات المحصلة فعليًا من الطلاب، منفصلة عن الرسوم المستحقة.",
  },
  installment: {
    kind: "installment", label: "خطة الأقساط", singular: "قسط", nameLabel: "اسم القسط", needsBranch: true,
    statuses: [S.pending],
    fields: [
      { key: "studentId", label: "الطالب", type: "relation", relation: "student", required: true },
      { key: "amount", label: "المبلغ", type: "number", required: true, money: true },
      { key: "dueDate", label: "تاريخ الاستحقاق", type: "date", required: true },
    ],
    columns: ["studentId", "amount", "dueDate"],
    empty: "قسّم رسوم الطالب إلى أقساط بمواعيد استحقاق؛ يرفض الخادم تجاوز مجموعها للرسوم.",
  },
  session: {
    kind: "session", label: "الحصص", singular: "حصة", nameLabel: "عنوان الحصة", needsBranch: true,
    statuses: [S.scheduled, S.done, S.cancelled],
    fields: [
      { key: "date", label: "التاريخ", type: "date", required: true },
      { key: "start", label: "من", type: "time", required: true },
      { key: "end", label: "إلى", type: "time", required: true },
      { key: "roomId", label: "القاعة", type: "relation", relation: "room", required: true },
      { key: "instructorId", label: "المدرب", type: "relation", relation: "instructor", required: true },
      { key: "diplomaId", label: "الدبلوم", type: "relation", relation: "diploma", required: true },
      { key: "subjectId", label: "المادة", type: "relation", relation: "subject" },
      { key: "studentIds", label: "الطلاب", type: "multirelation", relation: "student" },
    ],
    columns: ["date", "start", "end", "roomId", "instructorId", "studentIds"],
    empty: "أنشئ الحصص يدويًا؛ يرفض الخادم أي تعارض في القاعة أو المدرب أو الطلاب أو تجاوز السعة.",
  },
  attendance: {
    kind: "attendance", label: "الحضور", singular: "سجل حضور", nameLabel: "البيان", needsBranch: true,
    statuses: [S.recorded],
    fields: [
      { key: "studentId", label: "الطالب", type: "relation", relation: "student", required: true },
      { key: "sessionId", label: "الحصة", type: "relation", relation: "session", required: true },
      { key: "present", label: "حاضر", type: "bool" },
    ],
    columns: ["studentId", "sessionId", "present"],
    empty: "سجّل حضور الطلاب لكل حصة منعقدة.",
  },
  grade: {
    kind: "grade", label: "الدرجات", singular: "درجة", nameLabel: "البيان", needsBranch: true,
    statuses: [S.recorded, S.draft],
    fields: [
      { key: "studentId", label: "الطالب", type: "relation", relation: "student", required: true },
      { key: "subject", label: "المادة", type: "text", required: true },
      { key: "score", label: "الدرجة", type: "number", required: true },
      { key: "maxScore", label: "الدرجة العظمى", type: "number", required: true },
    ],
    columns: ["studentId", "subject", "score", "maxScore"],
    empty: "أدخل درجات الطلاب لكل مادة.",
  },
};

const ALL_STATUS: Record<string, string> = Object.fromEntries(Object.values(S).map((s) => [s.value, s.label]));
export const statusLabel = (s: string) => ALL_STATUS[s] ?? s;
export const statusTone = (s: string): "good" | "warn" | "bad" | "neutral" => {
  if (["active", "paid", "done", "enrolled", "graduated", "recorded"].includes(s)) return "good";
  if (["pending", "maintenance", "planned", "scheduled", "draft"].includes(s)) return "warn";
  if (["overdue", "closed", "cancelled", "suspended", "retired"].includes(s)) return "bad";
  return "neutral";
};

const sar = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const dec = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
export const fmtNum = (n: number) => sar.format(Number.isFinite(n) ? n : 0);
export const fmtDec = (n: number) => dec.format(Number.isFinite(n) ? n : 0);
export const fmtSAR = (n: number) => `${fmtNum(n)} ر.س`;
export const fmtPct = (n: number) => `${dec.format(Number.isFinite(n) ? n : 0)}%`;
export const fmtDate = (s: string) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("ar-SA-u-nu-latn-ca-gregory", { year: "numeric", month: "short", day: "numeric" });
};

export const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const det = (r: EducationRecord, key: string): unknown => (r.details as Record<string, unknown>)?.[key];

export function errorText(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { data?: unknown; message?: string };
    if (e.data && typeof e.data === "object") {
      const d = e.data as { error?: unknown; message?: unknown };
      if (typeof d.error === "string") return d.error;
      if (typeof d.message === "string") return d.message;
    }
    if (typeof e.data === "string" && e.data) return e.data;
    if (e.message) return e.message;
  }
  return "تعذر إكمال العملية. حاول مرة أخرى.";
}

export function toMinutes(t: string) {
  const [h, m] = String(t ?? "").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
