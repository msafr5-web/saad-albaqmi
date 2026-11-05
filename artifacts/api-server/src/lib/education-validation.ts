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
  if (["branch","diploma","level","subject"].includes(input.kind)) {
    if (input.branchId != null) throw new DomainError("هذا السجل لا يتطلب فرعًا");
  } else if (!records.some(r => r.id === input.branchId && r.kind === "branch")) {
    throw new DomainError("اختر فرعًا صحيحًا");
  }
  const idList = (key: string, kind: string, required = false) => {
    const v = d[key];
    if (v === undefined && !required) return [] as EducationRow[];
    if (!Array.isArray(v) || !v.every(x => Number.isInteger(x)) || new Set(v).size !== v.length) throw new DomainError(`قائمة غير صحيحة: ${key}`);
    return (v as number[]).map(id => {
      const item = records.find(r => r.id === id && r.kind === kind);
      if (!item) throw new DomainError(`ارتباط غير صحيح: ${key}`);
      return item;
    });
  };
  const optionalRelation = (key: string, kind: string, sameBranch = true) => (d[key] === undefined || d[key] === null ? undefined : relation(key, kind, sameBranch));
  const sumOf = (items: EducationRow[]) => Math.round(items.reduce((a, r) => a + Number(r.details.amount || 0), 0) * 100) / 100;
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
    case "level": {
      relation("diplomaId", "diploma", false); numeric("order", 1);
      if (!Number.isInteger(d.order)) throw new DomainError("ترتيب المستوى يجب أن يكون عددًا صحيحًا");
      if (records.some(r => r.id !== excludeId && r.kind === "level" && r.details.diplomaId === d.diplomaId && r.details.order === d.order)) throw new DomainError("يوجد مستوى بنفس الترتيب في هذا الدبلوم", 409);
      break;
    }
    case "subject": {
      relation("diplomaId", "diploma", false); numeric("price"); numeric("hours", 0.5);
      const level = relation("levelId", "level", false);
      if (level.details.diplomaId !== d.diplomaId) throw new DomainError("المستوى لا يتبع الدبلوم المحدد");
      if (records.some(r => r.id !== excludeId && r.kind === "subject" && r.details.diplomaId === d.diplomaId && r.name.trim() === input.name.trim())) throw new DomainError("توجد مادة بالاسم نفسه في هذا الدبلوم", 409);
      for (const pre of idList("prerequisiteIds", "subject")) {
        if (pre.id === excludeId) throw new DomainError("لا يمكن أن تكون المادة متطلبًا سابقًا لنفسها");
        const preLevel = records.find(r => r.id === pre.details.levelId);
        if (pre.details.diplomaId !== d.diplomaId || Number(preLevel?.details.order) >= Number(level.details.order)) throw new DomainError("المتطلب السابق يجب أن يكون من الدبلوم نفسه ومن مستوى أسبق");
      }
      break;
    }
    case "student": {
      relation("diplomaId", "diploma", false); numeric("fees");
      const level = optionalRelation("levelId", "level", false);
      if (level && level.details.diplomaId !== d.diplomaId) throw new DomainError("المستوى لا يتبع الدبلوم المحدد");
      const subjects = idList("subjectIds", "subject");
      if (subjects.some(x => x.details.diplomaId !== d.diplomaId)) throw new DomainError("إحدى المواد لا تتبع دبلوم الطالب");
      if (subjects.length) {
        const total = Math.round(subjects.reduce((a, x) => a + Number(x.details.price || 0), 0) * 100) / 100;
        if (Math.abs(total - Number(d.fees)) > 0.005) throw new DomainError(`الرسوم يجب أن تساوي مجموع أسعار المواد المسجلة (${total})`);
        const before = Array.isArray(previous?.details.subjectIds) ? previous!.details.subjectIds as number[] : [];
        for (const sub of subjects.filter(x => !before.includes(x.id))) {
          for (const preId of Array.isArray(sub.details.prerequisiteIds) ? sub.details.prerequisiteIds as number[] : []) {
            const pre = records.find(r => r.id === preId);
            const passed = !!pre && records.some(g => g.kind === "grade" && g.details.studentId === excludeId && g.details.subject === pre.name && Number(g.details.score) / Number(g.details.maxScore) >= 0.5);
            if (!passed) throw new DomainError(`لم يجتز الطالب المتطلب السابق «${pre?.name ?? preId}» للمادة «${sub.name}»`, 409);
          }
        }
      }
      if (sumOf(records.filter(r => r.kind === "installment" && r.details.studentId === excludeId).map(r => ({...r,details:{amount:r.details.amount}}))) > Number(d.fees) + 0.005) throw new DomainError("الرسوم أقل من مجموع خطة الأقساط الحالية", 409);
      if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(d.email))) throw new DomainError("البريد الإلكتروني غير صحيح");
      break;
    }
    case "instructor":
      numeric("hourlyRate"); numeric("weeklyHours"); idList("subjectIds", "subject");
      if (Number(d.weeklyHours) > 168) throw new DomainError("الساعات الأسبوعية تتجاوز ساعات الأسبوع");
      break;
    case "expense":
    case "payment":
      numeric("amount", 0.01); date("date");
      if (input.kind === "payment") {
        const student = relation("studentId", "student");
        if (input.status !== "paid") throw new DomainError("سجّل فقط الدفعات المحصلة فعليًا");
        const total = sumOf(records.filter(r => r.kind === "payment" && r.id !== excludeId && r.details.studentId === d.studentId)) + Number(d.amount);
        if (total > Number(student.details.fees) + 0.005) throw new DomainError("إجمالي المدفوعات يتجاوز الرسوم المستحقة للطالب", 409);
      }
      break;
    case "installment": {
      const student = relation("studentId", "student");
      numeric("amount", 0.01); date("dueDate");
      const total = sumOf(records.filter(r => r.kind === "installment" && r.id !== excludeId && r.details.studentId === d.studentId)) + Number(d.amount);
      if (total > Number(student.details.fees) + 0.005) throw new DomainError("مجموع الأقساط يتجاوز الرسوم المستحقة للطالب", 409);
      break;
    }
    case "invoice":
      numeric("amount", 0.01); numeric("kwh");
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(d.month))) throw new DomainError("شهر الفاتورة غير صحيح");
      if (!String(d.meter ?? "").trim()) throw new DomainError("رقم العداد مطلوب");
      if (records.some(r => r.id !== excludeId && r.kind === "invoice" && r.branchId === input.branchId && r.details.month === d.month && r.details.meter === d.meter)) throw new DomainError("توجد فاتورة لهذا العداد والشهر بالفعل", 409);
      break;
    case "session": {
      date("date");
      const room = relation("roomId", "room");
      const instructor = relation("instructorId", "instructor"); relation("diplomaId", "diploma", false);
      const subject = optionalRelation("subjectId", "subject", false);
      if (subject) {
        if (subject.details.diplomaId !== d.diplomaId) throw new DomainError("المادة لا تتبع الدبلوم المحدد");
        if (Array.isArray(instructor.details.subjectIds) && instructor.details.subjectIds.length && !instructor.details.subjectIds.includes(subject.id)) throw new DomainError("المادة غير ضمن مواد المدرب المسندة");
      }
      if (input.status === "done" && String(d.date) > new Date().toISOString().slice(0, 10)) throw new DomainError("لا يمكن اعتماد حصة مستقبلية كمنعقدة");
      if (!Array.isArray(d.studentIds) || !d.studentIds.every(id => Number.isInteger(id))) throw new DomainError("قائمة الطلاب غير صحيحة");
      const ids = d.studentIds as number[];
      if (new Set(ids).size !== ids.length) throw new DomainError("لا يمكن تكرار الطالب في الحصة");
      if (ids.length > Number(room.details.capacity)) throw new DomainError("عدد الطلاب يتجاوز سعة القاعة", 409);
      for (const id of ids) {
        const student = records.find(r => r.id === id && r.kind === "student" && r.branchId === input.branchId && r.details.diplomaId === d.diplomaId);
        if (!student) throw new DomainError("أحد الطلاب لا يتبع الفرع أو الدبلوم المحدد");
        if (subject && Array.isArray(student.details.subjectIds) && student.details.subjectIds.length && !student.details.subjectIds.includes(subject.id)) throw new DomainError(`الطالب «${student.name}» غير مسجل في مادة الحصة`);
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
  const keys = ["roomId","instructorId","diplomaId","studentId","sessionId","levelId","subjectId"];
  const lists = ["studentIds","subjectIds","prerequisiteIds"];
  if (records.some(r => r.id !== id && (r.branchId === id || keys.some(k => r.details[k] === id) || lists.some(k => Array.isArray(r.details[k]) && (r.details[k] as unknown[]).includes(id))))) {
    throw new DomainError("لا يمكن حذف السجل لوجود سجلات مرتبطة به؛ عدّل الارتباطات أولًا",409);
  }
}
