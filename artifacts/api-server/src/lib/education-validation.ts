import type { EducationRow } from "./education-demo";

export class DomainError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export type InputRecord = Omit<EducationRow, "id" | "createdAt">;
export function validateRecord(input: InputRecord, records: EducationRow[], excludeId?: number) {
  const d = input.details;
  if (!input.name.trim()) throw new DomainError("الاسم مطلوب");
  if (JSON.stringify(d).length > 20000) throw new DomainError("تفاصيل السجل تتجاوز الحجم المسموح");
  const numeric = (key: string, minimum = 0, required = true) => {
    if (d[key] === undefined && !required) return;
    if (typeof d[key] !== "number" || !Number.isFinite(d[key]) || Number(d[key]) < minimum || Number(d[key]) > 1e10) throw new DomainError(`قيمة غير صحيحة: ${key}`);
  };
  const date = (key: string) => {
    const value = String(d[key] ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) throw new DomainError("التاريخ غير صحيح");
  };
  const relation = (key: string, kind: string, sameBranch = true) => {
    const item = records.find(r => r.id === d[key] && r.kind === kind);
    if (!item || (sameBranch && item.branchId !== input.branchId)) throw new DomainError(`الارتباط غير صحيح أو لا يتبع الفرع: ${key}`);
    return item;
  };
  if (input.kind === "branch" || input.kind === "diploma") {
    if (input.branchId != null) throw new DomainError("هذا السجل لا يتطلب فرعًا");
  } else if (!records.some(r => r.id === input.branchId && r.kind === "branch")) {
    throw new DomainError("اختر فرعًا صحيحًا");
  }
  const previous = records.find(r => r.id === excludeId);
  if (previous && (previous.kind !== input.kind || previous.branchId !== input.branchId)) throw new DomainError("لا يمكن تغيير نوع السجل أو فرعه بعد إنشائه؛ أنشئ سجلًا جديدًا");
  switch (input.kind) {
    case "branch":
      numeric("budget"); break;
    case "room":
      numeric("area", 0.01); numeric("capacity", 1); numeric("powerKw", 0, false);
      if (!Number.isInteger(d.capacity)) throw new DomainError("السعة يجب أن تكون عددًا صحيحًا");
      break;
    case "asset":
      numeric("value"); relation("roomId", "room"); if (d.maintenanceDate) date("maintenanceDate"); break;
    case "diploma":
      numeric("fee"); break;
    case "student":
      relation("diplomaId", "diploma", false); numeric("fees");
      if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(d.email))) throw new DomainError("البريد الإلكتروني غير صحيح");
      break;
    case "instructor":
      numeric("hourlyRate"); numeric("weeklyHours");
      if (Number(d.weeklyHours) > 168) throw new DomainError("الساعات الأسبوعية تتجاوز ساعات الأسبوع");
      break;
    case "expense":
    case "payment":
      numeric("amount", 0.01); date("date");
      if (input.kind === "payment") {
        relation("studentId", "student");
        if (input.status !== "paid") throw new DomainError("سجّل فقط الدفعات المحصلة فعليًا");
      }
      break;
    case "invoice":
      numeric("amount", 0.01); numeric("kwh");
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(d.month))) throw new DomainError("شهر الفاتورة غير صحيح");
      if (!String(d.meter ?? "").trim()) throw new DomainError("رقم العداد مطلوب");
      if (records.some(r => r.id !== excludeId && r.kind === "invoice" && r.branchId === input.branchId && r.details.month === d.month && r.details.meter === d.meter)) throw new DomainError("توجد فاتورة لهذا العداد والشهر بالفعل", 409);
      break;
    case "session": {
      date("date");
      const room = relation("roomId", "room");
      relation("instructorId", "instructor"); relation("diplomaId", "diploma", false);
      if (!Array.isArray(d.studentIds) || !d.studentIds.every(id => Number.isInteger(id))) throw new DomainError("قائمة الطلاب غير صحيحة");
      const ids = d.studentIds as number[];
      if (new Set(ids).size !== ids.length) throw new DomainError("لا يمكن تكرار الطالب في الحصة");
      if (ids.length > Number(room.details.capacity)) throw new DomainError("عدد الطلاب يتجاوز سعة القاعة", 409);
      for (const id of ids) {
        const student = records.find(r => r.id === id && r.kind === "student" && r.branchId === input.branchId && r.details.diplomaId === d.diplomaId);
        if (!student) throw new DomainError("أحد الطلاب لا يتبع الفرع أو الدبلوم المحدد");
      }
      if (![d.start,d.end].every(t => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)) || String(d.start) >= String(d.end)) throw new DomainError("حدد وقت بداية ونهاية صحيحين");
      for (const other of records.filter(r => r.kind === "session" && r.id !== excludeId && r.details.date === d.date && !["ملغي","cancelled"].includes(r.status))) {
        const x = other.details;
        if (!["ملغي","cancelled"].includes(input.status) && String(d.start) < String(x.end) && String(d.end) > String(x.start)) {
          if (x.roomId === d.roomId || x.instructorId === d.instructorId || (Array.isArray(x.studentIds) && ids.some(id => (x.studentIds as number[]).includes(id)))) throw new DomainError("تعارض في الموعد: القاعة أو المدرب أو أحد الطلاب مرتبط بحصة أخرى", 409);
        }
      }
      break;
    }
    case "attendance": {
      relation("studentId", "student");
      const session = relation("sessionId", "session");
      if (!Array.isArray(session.details.studentIds) || !session.details.studentIds.includes(d.studentId)) throw new DomainError("الطالب غير مسجل في الحصة المحددة");
      if (typeof d.present !== "boolean") throw new DomainError("حدد حالة الحضور");
      if (records.some(r => r.id !== excludeId && r.kind === "attendance" && r.details.studentId === d.studentId && r.details.sessionId === d.sessionId)) throw new DomainError("سجل حضور الطالب موجود لهذه الحصة",409);
      break;
    }
    case "grade":
      relation("studentId", "student"); numeric("score"); numeric("maxScore", 1);
      if (Number(d.score) > Number(d.maxScore)) throw new DomainError("الدرجة تتجاوز الدرجة القصوى");
      break;
  }
}

export function ensureDeletable(id: number, records: EducationRow[]) {
  const keys = ["roomId","instructorId","diplomaId","studentId","sessionId"];
  if (records.some(r => r.id !== id && (r.branchId === id || keys.some(k => r.details[k] === id) || (Array.isArray(r.details.studentIds) && r.details.studentIds.includes(id))))) {
    throw new DomainError("لا يمكن حذف السجل لوجود سجلات مرتبطة به؛ عدّل الارتباطات أولًا",409);
  }
}
