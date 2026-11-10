import { api } from "@/hooks/use-ops";
import { errorText } from "@/lib/domain";
import { serialToIso, type Cell, type SheetSpec } from "@/lib/xlsx";

/**
 * Excel sheets for bulk add / update. Every row is applied through the SAME endpoints and validations the screens use
 * (so permissions, business rules and the audit trail are identical). Rules:
 *   - identifier column filled  -> update that record; blank cells keep the current value
 *   - identifier column blank   -> create a new record
 * Each parser returns one preview line per row; nothing is sent until the user confirms.
 */
export type EntityId = "branches" | "rooms" | "departments" | "employees";
export type PreviewRow = { rowNo: number; action: "create" | "update" | "skip" | "error"; label: string; messages: string[]; run?: () => Promise<unknown> };
type Col = { header: string; required?: boolean; width: number; note: string; options?: string[]; type?: "id" | "text" | "number" | "date" };
export type EntityDef = {
  id: EntityId; title: string; sheetName: string; file: string; columns: Col[];
  load: () => Promise<unknown>;
  exportRows: (ctx: never) => Cell[][];
  lists: (ctx: never) => { column: number; values: string[] }[];
  parse: (grid: string[][], ctx: never) => PreviewRow[];
};

// ---------- helpers ----------
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
export const clean = (s: unknown) => String(s ?? "").replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/[​-‏‪-‮﻿]/g, "").trim();
const key = (s: string) => clean(s).replace(/\s+/g, " ").toLowerCase();
const parseNumber = (s: string): number => { const t = clean(s).replace(/[,،\s]/g, "").replace("٫", "."); return t === "" ? NaN : Number(t); };
function parseDate(raw: string): string | null {
  const s = clean(raw);
  if (/^\d{5}(\.\d+)?$/.test(s)) return serialToIso(Number(s));
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s); let y: string, mo: string, d: string;
  if (m) [, y, mo, d] = m as unknown as string[]; else if ((m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s))) [, d, mo, y] = m as unknown as string[]; else return null;
  const iso = `${y}-${mo!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  return !Number.isNaN(Date.parse(iso)) && new Date(iso).toISOString().slice(0, 10) === iso ? iso : null;
}
const labelToValue = (opts: { value: string; label: string }[], raw: string) => { const k = key(raw); return opts.find((o) => key(o.label) === k || key(o.value) === k)?.value; };

/** Maps the sheet's header row to column positions by header text, so reordered columns still import correctly. */
function headerIndex(grid: string[][], columns: Col[]): { idx: Map<string, number>; error?: string } {
  const head = (grid[0] ?? []).map((h) => key(h).replace(/\s*\*$/, ""));
  const idx = new Map<string, number>(); const missing: string[] = [];
  for (const c of columns) { const i = head.indexOf(key(c.header)); if (i < 0) missing.push(c.header); else idx.set(c.header, i); }
  return missing.length ? { idx, error: `أعمدة ناقصة أو بعناوين مختلفة: ${missing.join("، ")}. نزّل القالب الحالي ولا تغيّر عناوين الصف الأول.` } : { idx };
}
const rowsOf = (grid: string[][]) => grid.slice(1).map((cells, i) => ({ cells, rowNo: i + 2 })).filter((r) => r.cells.some((c) => clean(c) !== ""));
const errRow = (rowNo: number, label: string, messages: string[]): PreviewRow => ({ rowNo, action: "error", label, messages });
const guard = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (e) { throw new Error(errorText(e)); } };

function instructions(title: string, cols: Col[], extra: string[]): SheetSpec {
  return {
    name: "تعليمات", title, widths: [110],
    rows: [[`تعليمات ${title}`], [""],
      ["1) لإضافة سجل جديد: اترك عمود المعرّف فارغًا واملأ باقي الحقول."], ["2) لتعديل سجل موجود: لا تغيّر قيمة المعرّف (العمود الرمادي)، وعدّل ما تريد. الخلية الفارغة تعني الإبقاء على القيمة الحالية."],
      ["3) لا تغيّر عناوين الصف الأول ولا اسم الورقة الأولى. يمكنك إعادة ترتيب الأعمدة."], ["4) استخدم القوائم المنسدلة حيثما وُجدت. التواريخ بصيغة 2026-01-31."],
      ["5) ارفع الملف من نفس الصفحة بزر «استيراد من Excel»؛ تظهر لك معاينة بكل صف قبل أي حفظ، والصفوف التي بها خطأ لا تُنفَّذ."], [""],
      ...extra.map((e) => [e]), [""], ["الأعمدة:"],
      ...cols.map((c) => [`• ${c.header}${c.required ? " (مطلوب)" : ""}: ${c.note}`])],
  };
}
const sheetOf = (def: { sheetName: string; columns: Col[] }, body: Cell[][], lists: { column: number; values: string[] }[], extra: string[]): SheetSpec[] => {
  const cols = def.columns;
  return [
    { name: def.sheetName, rows: [cols.map((c) => c.header + (c.required ? " *" : "")), ...body], widths: cols.map((c) => c.width), idColumns: [0], lists, textColumns: cols.map((c, i) => (c.type === "date" || c.type === "text" ? i : -1)).filter((i) => i > 0) },
    instructions(def.sheetName, cols, extra),
  ];
};

// ---------- records (branches, rooms) ----------
type Rec = { id: number; kind: string; name: string; branchId: number | null; status: string; details: Record<string, unknown> };
const BRANCH_STATUS = [{ value: "active", label: "نشط" }, { value: "planned", label: "مخطط" }, { value: "closed", label: "مغلق" }];
const ROOM_STATUS = [{ value: "active", label: "نشط" }, { value: "maintenance", label: "صيانة" }, { value: "closed", label: "مغلق" }];
const ROOM_TYPE = [{ value: "قاعة", label: "قاعة دراسية" }, { value: "معمل", label: "معمل" }, { value: "ورشة", label: "ورشة" }, { value: "مكتب", label: "مكتب إداري" }];
const statusLabel = (opts: { value: string; label: string }[], v: string) => opts.find((o) => o.value === v)?.label ?? v;
const loadRecords = async () => (await api<Rec[]>("/records"));
const recPost = (body: unknown) => guard(() => api("/records", { method: "POST", body }));
const recPatch = (id: number, body: unknown) => guard(() => api(`/records/${id}`, { method: "PATCH", body }));

const BRANCH_COLS: Col[] = [
  { header: "المعرّف", width: 12, type: "id", note: "رقم السجل؛ اتركه فارغًا للإضافة ولا تغيّره عند التعديل" },
  { header: "اسم الفرع", required: true, width: 28, type: "text", note: "اسم فريد للفرع" },
  { header: "الحالة", width: 14, options: BRANCH_STATUS.map((s) => s.label), note: "نشط / مخطط / مغلق (الافتراضي نشط عند الإضافة)" },
  { header: "المدينة", required: true, width: 18, type: "text", note: "مدينة الفرع" },
  { header: "الميزانية المخصصة (ريال)", required: true, width: 24, type: "number", note: "رقم موجب بالريال؛ سقف للمقارنة وليس مصروفًا فعليًا" },
];

export const branchesDef: EntityDef = {
  id: "branches", title: "الفروع", sheetName: "الفروع", file: "الفروع", columns: BRANCH_COLS,
  load: loadRecords,
  exportRows: ((recs: Rec[]) => recs.filter((r) => r.kind === "branch").sort((a, b) => a.id - b.id).map((r) => [r.id, r.name, statusLabel(BRANCH_STATUS, r.status), String(r.details.city ?? ""), Number(r.details.budget ?? 0)])) as never,
  lists: (() => [{ column: 2, values: BRANCH_STATUS.map((s) => s.label) }]) as never,
  parse: ((grid: string[][], recs: Rec[]) => {
    const { idx, error } = headerIndex(grid, BRANCH_COLS); if (error) return [errRow(1, "العناوين", [error])];
    const branches = recs.filter((r) => r.kind === "branch"); const seen = new Map<string, number>(); const out: PreviewRow[] = [];
    for (const { cells, rowNo } of rowsOf(grid)) {
      const g = (h: string) => clean(cells[idx.get(h)!] ?? "");
      const idRaw = g("المعرّف"), name = g("اسم الفرع"); const label = name || `صف ${rowNo}`; const msgs: string[] = [];
      let existing: Rec | undefined;
      if (idRaw) { existing = branches.find((r) => String(r.id) === idRaw); if (!existing) msgs.push(`المعرّف ${idRaw} غير موجود بين الفروع`); }
      const nm = name || existing?.name || ""; if (!nm) msgs.push("اسم الفرع مطلوب");
      const st = g("الحالة") ? labelToValue(BRANCH_STATUS, g("الحالة")) : existing?.status ?? "active"; if (!st) msgs.push("حالة غير صحيحة (نشط / مخطط / مغلق)");
      const city = g("المدينة") || String(existing?.details.city ?? ""); if (!city) msgs.push("المدينة مطلوبة");
      const budgetRaw = g("الميزانية المخصصة (ريال)"); const budget = budgetRaw ? parseNumber(budgetRaw) : Number(existing?.details.budget ?? NaN);
      if (!Number.isFinite(budget) || budget < 0) msgs.push("الميزانية يجب أن تكون رقمًا موجبًا");
      const nk = key(nm); if (nk) {
        if (branches.some((r) => key(r.name) === nk && r.id !== existing?.id)) msgs.push("يوجد فرع بنفس الاسم");
        if (seen.has(nk)) msgs.push(`الاسم مكرر داخل الملف (الصف ${seen.get(nk)})`); else seen.set(nk, rowNo);
      }
      if (msgs.length) { out.push(errRow(rowNo, label, msgs)); continue; }
      const body = { kind: "branch", name: nm, branchId: null, status: st, details: { ...(existing?.details ?? {}), city, budget } };
      if (existing && existing.name === nm && existing.status === st && existing.details.city === city && Number(existing.details.budget) === budget) { out.push({ rowNo, action: "skip", label: nm, messages: ["لا تغيير"] }); continue; }
      out.push({ rowNo, action: existing ? "update" : "create", label: nm, messages: [], run: () => (existing ? recPatch(existing.id, body) : recPost(body)) });
    }
    return out;
  }) as never,
};

const ROOM_COLS: Col[] = [
  { header: "المعرّف", width: 12, type: "id", note: "رقم السجل؛ اتركه فارغًا للإضافة ولا تغيّره عند التعديل" },
  { header: "الفرع", required: true, width: 24, options: [], note: "اسم الفرع كما في القائمة (لا يمكن نقل قاعة إلى فرع آخر بعد إنشائها)" },
  { header: "اسم القاعة", required: true, width: 26, type: "text", note: "اسم القاعة أو المعمل، فريد داخل الفرع" },
  { header: "الحالة", width: 14, options: ROOM_STATUS.map((s) => s.label), note: "نشط / صيانة / مغلق (الافتراضي نشط)" },
  { header: "النوع", required: true, width: 18, options: ROOM_TYPE.map((s) => s.label), note: "قاعة دراسية / معمل / ورشة / مكتب إداري" },
  { header: "المساحة (م²)", required: true, width: 16, type: "number", note: "رقم أكبر من صفر" },
  { header: "السعة (مقعد)", required: true, width: 16, type: "number", note: "عدد صحيح أكبر من صفر" },
  { header: "قدرة الأجهزة (ك.واط)", width: 22, type: "number", note: "اختياري" },
];
export const roomsDef: EntityDef = {
  id: "rooms", title: "القاعات والمعامل", sheetName: "القاعات والمعامل", file: "القاعات-والمعامل", columns: ROOM_COLS,
  load: loadRecords,
  exportRows: ((recs: Rec[]) => { const bn = new Map(recs.filter((r) => r.kind === "branch").map((b) => [b.id, b.name])); return recs.filter((r) => r.kind === "room").sort((a, b) => a.id - b.id)
    .map((r) => [r.id, bn.get(r.branchId ?? -1) ?? "", r.name, statusLabel(ROOM_STATUS, r.status), statusLabel(ROOM_TYPE, String(r.details.type ?? "")), Number(r.details.area ?? 0), Number(r.details.capacity ?? 0), r.details.powerKw == null ? null : Number(r.details.powerKw)]); }) as never,
  lists: ((recs: Rec[]) => [{ column: 1, values: recs.filter((r) => r.kind === "branch").map((b) => b.name) }, { column: 3, values: ROOM_STATUS.map((s) => s.label) }, { column: 4, values: ROOM_TYPE.map((s) => s.label) }]) as never,
  parse: ((grid: string[][], recs: Rec[]) => {
    const { idx, error } = headerIndex(grid, ROOM_COLS); if (error) return [errRow(1, "العناوين", [error])];
    const branches = recs.filter((r) => r.kind === "branch"); const rooms = recs.filter((r) => r.kind === "room"); const seen = new Map<string, number>(); const out: PreviewRow[] = [];
    for (const { cells, rowNo } of rowsOf(grid)) {
      const g = (h: string) => clean(cells[idx.get(h)!] ?? "");
      const idRaw = g("المعرّف"), name = g("اسم القاعة"); const msgs: string[] = [];
      let existing: Rec | undefined;
      if (idRaw) { existing = rooms.find((r) => String(r.id) === idRaw); if (!existing) msgs.push(`المعرّف ${idRaw} غير موجود بين القاعات`); }
      const nm = name || existing?.name || ""; if (!nm) msgs.push("اسم القاعة مطلوب");
      const brName = g("الفرع"); let branchId = existing?.branchId ?? null;
      if (brName) { const hit = branches.filter((b) => key(b.name) === key(brName)); if (hit.length !== 1) msgs.push(hit.length ? `اسم الفرع مكرر: ${brName}` : `الفرع غير موجود: ${brName}`); else branchId = hit[0]!.id; }
      if (branchId == null && !msgs.length) msgs.push("الفرع مطلوب");
      if (existing && branchId != null && existing.branchId !== branchId) msgs.push("لا يمكن نقل قاعة إلى فرع آخر؛ أضف قاعة جديدة");
      const st = g("الحالة") ? labelToValue(ROOM_STATUS, g("الحالة")) : existing?.status ?? "active"; if (!st) msgs.push("حالة غير صحيحة (نشط / صيانة / مغلق)");
      const type = g("النوع") ? labelToValue(ROOM_TYPE, g("النوع")) : String(existing?.details.type ?? ""); if (!type) msgs.push("النوع مطلوب (قاعة / معمل / ورشة / مكتب)");
      const area = g("المساحة (م²)") ? parseNumber(g("المساحة (م²)")) : Number(existing?.details.area ?? NaN); if (!(area > 0)) msgs.push("المساحة يجب أن تكون أكبر من صفر");
      const capacity = g("السعة (مقعد)") ? parseNumber(g("السعة (مقعد)")) : Number(existing?.details.capacity ?? NaN); if (!Number.isInteger(capacity) || capacity < 1) msgs.push("السعة يجب أن تكون عددًا صحيحًا أكبر من صفر");
      const pk = g("قدرة الأجهزة (ك.واط)"); const power = pk ? parseNumber(pk) : existing?.details.powerKw == null ? undefined : Number(existing.details.powerKw); if (power !== undefined && !(power >= 0)) msgs.push("قدرة الأجهزة رقم غير صحيح");
      const nk = `${branchId}|${key(nm)}`;
      if (nm && branchId != null) {
        if (rooms.some((r) => r.branchId === branchId && key(r.name) === key(nm) && r.id !== existing?.id)) msgs.push("توجد قاعة بنفس الاسم في هذا الفرع");
        if (seen.has(nk)) msgs.push(`الاسم مكرر داخل الملف (الصف ${seen.get(nk)})`); else seen.set(nk, rowNo);
      }
      if (msgs.length) { out.push(errRow(rowNo, nm || `صف ${rowNo}`, msgs)); continue; }
      const details: Record<string, unknown> = { ...(existing?.details ?? {}), type, area, capacity }; if (power !== undefined) details.powerKw = power; else delete details.powerKw;
      const body = { kind: "room", name: nm, branchId, status: st, details };
      if (existing && existing.name === nm && existing.status === st && JSON.stringify(existing.details) === JSON.stringify(details)) { out.push({ rowNo, action: "skip", label: nm, messages: ["لا تغيير"] }); continue; }
      out.push({ rowNo, action: existing ? "update" : "create", label: nm, messages: [], run: () => (existing ? recPatch(existing.id, body) : recPost(body)) });
    }
    return out;
  }) as never,
};

// ---------- HR (departments, employees) ----------
type HrCat = { departments: { id: number; name: string; code: string; branchId: number | null }[]; jobTitles: { id: number; name: string }[]; branches: { id: number; name: string }[] };
type Emp = { id: number; employeeNo: string; fullName: string; branchId: number; departmentId: number | null; jobTitleId: number | null; nationalId: string | null; nationality: string | null; email: string | null; phone: string | null; iban: string | null; employmentType: string; hireDate: string; terminationDate: string | null; status: string; basicSalaryHalalas: number | null; housingAllowanceHalalas: number | null; transportAllowanceHalalas: number | null };
const EMP_STATUS = [{ value: "active", label: "على رأس العمل" }, { value: "on_leave", label: "في إجازة" }, { value: "suspended", label: "موقوف" }, { value: "terminated", label: "منتهي الخدمة" }];
const EMP_TYPE = [{ value: "full_time", label: "دوام كامل" }, { value: "part_time", label: "دوام جزئي" }, { value: "contract", label: "عقد" }, { value: "trainee", label: "متدرب" }];

const DEPT_COLS: Col[] = [
  { header: "المعرّف", width: 12, type: "id", note: "رقم القسم؛ اتركه فارغًا للإضافة ولا تغيّره عند التعديل" },
  { header: "اسم القسم", required: true, width: 28, type: "text", note: "اسم القسم" },
  { header: "رمز القسم", width: 16, type: "text", note: "رمز مختصر فريد (حروف وأرقام)؛ يُولَّد تلقائيًا إن تُرك فارغًا عند الإضافة" },
  { header: "الفرع", width: 24, options: [], note: "اتركه فارغًا لقسم عام يخدم كل الفروع" },
];
export const departmentsDef: EntityDef = {
  id: "departments", title: "الأقسام", sheetName: "الأقسام", file: "الأقسام", columns: DEPT_COLS,
  load: () => api<HrCat>("/hr/catalogue"),
  exportRows: ((c: HrCat) => { const bn = new Map(c.branches.map((b) => [b.id, b.name])); return [...c.departments].sort((a, b) => a.id - b.id).map((d) => [d.id, d.name, d.code, d.branchId == null ? "" : bn.get(d.branchId) ?? ""]); }) as never,
  lists: ((c: HrCat) => [{ column: 3, values: c.branches.map((b) => b.name) }]) as never,
  parse: ((grid: string[][], c: HrCat) => {
    const { idx, error } = headerIndex(grid, DEPT_COLS); if (error) return [errRow(1, "العناوين", [error])];
    const seen = new Map<string, number>(); const out: PreviewRow[] = [];
    for (const { cells, rowNo } of rowsOf(grid)) {
      const g = (h: string) => clean(cells[idx.get(h)!] ?? ""); const msgs: string[] = [];
      const idRaw = g("المعرّف"); const existing = idRaw ? c.departments.find((d) => String(d.id) === idRaw) : undefined; if (idRaw && !existing) msgs.push(`المعرّف ${idRaw} غير موجود بين الأقسام`);
      const name = g("اسم القسم") || existing?.name || ""; if (!name) msgs.push("اسم القسم مطلوب");
      const code = (g("رمز القسم") || existing?.code || "").toUpperCase(); if (code && !/^[A-Z0-9_-]{1,20}$/.test(code)) msgs.push("الرمز حروف إنجليزية وأرقام فقط (20 خانة كحد أقصى)");
      const brName = g("الفرع"); let branchId: number | null = existing?.branchId ?? null;
      if (brName) { const hit = c.branches.filter((b) => key(b.name) === key(brName)); if (hit.length !== 1) msgs.push(`الفرع غير موجود: ${brName}`); else branchId = hit[0]!.id; }
      if (code) { if (c.departments.some((d) => d.code.toUpperCase() === code && d.id !== existing?.id)) msgs.push("الرمز مستخدم لقسم آخر"); if (seen.has(code)) msgs.push(`الرمز مكرر داخل الملف (الصف ${seen.get(code)})`); else seen.set(code, rowNo); }
      if (msgs.length) { out.push(errRow(rowNo, name || `صف ${rowNo}`, msgs)); continue; }
      if (existing && existing.name === name && existing.code.toUpperCase() === code && existing.branchId === branchId) { out.push({ rowNo, action: "skip", label: name, messages: ["لا تغيير"] }); continue; }
      out.push({ rowNo, action: existing ? "update" : "create", label: name, messages: [], run: () => guard(() => existing ? api(`/hr/departments/${existing.id}`, { method: "PUT", body: { name, code, branchId } }) : api("/hr/departments", { method: "POST", body: { name, code: code || undefined, branchId } })) });
    }
    return out;
  }) as never,
};

const EMP_COLS: Col[] = [
  { header: "رقم الموظف", width: 14, type: "id", note: "مثل EMP-0001؛ اتركه فارغًا للإضافة ولا تغيّره عند التعديل" },
  { header: "الاسم الكامل", required: true, width: 28, type: "text", note: "الاسم الكامل للموظف" },
  { header: "الفرع", required: true, width: 22, options: [], note: "اسم الفرع كما في القائمة" },
  { header: "القسم", width: 22, options: [], note: "اسم القسم (عام أو تابع لنفس الفرع)" },
  { header: "المسمى الوظيفي", width: 22, options: [], note: "من قائمة المسميات الموجودة في النظام" },
  { header: "تاريخ التعيين", required: true, width: 16, type: "date", note: "بصيغة 2026-01-31" },
  { header: "الهوية / الإقامة", width: 18, type: "text", note: "فريدة لكل موظف" },
  { header: "الجنسية", width: 14, type: "text", note: "اختياري" },
  { header: "البريد الإلكتروني", width: 28, type: "text", note: "ضروري ليستقبل الموظف الطلبات والإشعارات ويدخل النظام" },
  { header: "الجوال", width: 16, type: "text", note: "مثل 0501234567" },
  { header: "الآيبان", width: 28, type: "text", note: "SA + 22 رقمًا" },
  { header: "نوع التوظيف", width: 16, options: EMP_TYPE.map((s) => s.label), note: "دوام كامل / دوام جزئي / عقد / متدرب" },
  { header: "الحالة", width: 16, options: EMP_STATUS.map((s) => s.label), note: "على رأس العمل / في إجازة / موقوف / منتهي الخدمة" },
  { header: "تاريخ انتهاء الخدمة", width: 18, type: "date", note: "مطلوب فقط عندما تكون الحالة منتهي الخدمة" },
  { header: "الراتب الأساسي (ريال)", width: 20, type: "number", note: "شهري بالريال" },
  { header: "بدل السكن (ريال)", width: 18, type: "number", note: "شهري بالريال" },
  { header: "بدل النقل (ريال)", width: 18, type: "number", note: "شهري بالريال" },
];
const sar = (h: number | null) => (h == null ? null : h / 100);
export const employeesDef: EntityDef = {
  id: "employees", title: "الموظفون", sheetName: "الموظفون", file: "الموظفون", columns: EMP_COLS,
  load: async () => ({ cat: await api<HrCat>("/hr/catalogue"), emps: await api<Emp[]>("/hr/employees") }),
  exportRows: ((x: { cat: HrCat; emps: Emp[] }) => { const bn = new Map(x.cat.branches.map((b) => [b.id, b.name])), dn = new Map(x.cat.departments.map((d) => [d.id, d.name])), tn = new Map(x.cat.jobTitles.map((t) => [t.id, t.name]));
    return [...x.emps].sort((a, b) => a.id - b.id).map((e) => [e.employeeNo, e.fullName, bn.get(e.branchId) ?? "", dn.get(e.departmentId ?? -1) ?? "", tn.get(e.jobTitleId ?? -1) ?? "", e.hireDate, e.nationalId ?? "", e.nationality ?? "", e.email ?? "", e.phone ?? "", e.iban ?? "",
      statusLabel(EMP_TYPE, e.employmentType), statusLabel(EMP_STATUS, e.status), e.terminationDate ?? "", sar(e.basicSalaryHalalas), sar(e.housingAllowanceHalalas), sar(e.transportAllowanceHalalas)]); }) as never,
  lists: ((x: { cat: HrCat }) => [{ column: 2, values: x.cat.branches.map((b) => b.name) }, { column: 3, values: [...new Set(x.cat.departments.map((d) => d.name))] }, { column: 4, values: x.cat.jobTitles.map((t) => t.name) },
    { column: 11, values: EMP_TYPE.map((s) => s.label) }, { column: 12, values: EMP_STATUS.map((s) => s.label) }]) as never,
  parse: ((grid: string[][], x: { cat: HrCat; emps: Emp[] }) => {
    const { idx, error } = headerIndex(grid, EMP_COLS); if (error) return [errRow(1, "العناوين", [error])];
    const { cat, emps } = x; const out: PreviewRow[] = []; const seenNid = new Map<string, number>(); const seenNo = new Map<string, number>();
    for (const { cells, rowNo } of rowsOf(grid)) {
      const g = (h: string) => clean(cells[idx.get(h)!] ?? ""); const msgs: string[] = [];
      const noRaw = g("رقم الموظف").toUpperCase(); const ex = noRaw ? emps.find((e) => e.employeeNo.toUpperCase() === noRaw) : undefined; if (noRaw && !ex) msgs.push(`رقم الموظف ${noRaw} غير موجود`);
      if (noRaw) { if (seenNo.has(noRaw)) msgs.push(`الموظف مكرر داخل الملف (الصف ${seenNo.get(noRaw)})`); else seenNo.set(noRaw, rowNo); }
      const fullName = g("الاسم الكامل") || ex?.fullName || ""; if (!fullName) msgs.push("الاسم الكامل مطلوب");
      let branchId = ex?.branchId ?? null; const brName = g("الفرع");
      if (brName) { const hit = cat.branches.filter((b) => key(b.name) === key(brName)); if (hit.length !== 1) msgs.push(`الفرع غير موجود: ${brName}`); else branchId = hit[0]!.id; }
      if (branchId == null && !brName) msgs.push("الفرع مطلوب");
      let departmentId = ex?.departmentId ?? null; const dn = g("القسم");
      if (dn) { const hit = cat.departments.filter((d) => key(d.name) === key(dn) && (d.branchId == null || d.branchId === branchId)); if (hit.length === 0) msgs.push(`القسم غير موجود لهذا الفرع: ${dn}`); else departmentId = (hit.find((d) => d.branchId === branchId) ?? hit[0]!).id; }
      let jobTitleId = ex?.jobTitleId ?? null; const jt = g("المسمى الوظيفي");
      if (jt) { const hit = cat.jobTitles.find((t) => key(t.name) === key(jt)); if (!hit) msgs.push(`المسمى الوظيفي غير موجود في القائمة: ${jt}`); else jobTitleId = hit.id; }
      const hd = g("تاريخ التعيين"); const hireDate = hd ? parseDate(hd) : ex?.hireDate ?? null; if (!hireDate) msgs.push(hd ? "تاريخ التعيين غير صحيح (استخدم 2026-01-31)" : "تاريخ التعيين مطلوب");
      const nationalId = g("الهوية / الإقامة") || ex?.nationalId || null;
      if (nationalId) { if (emps.some((e) => e.nationalId === nationalId && e.id !== ex?.id)) msgs.push("رقم الهوية مسجل لموظف آخر"); if (seenNid.has(nationalId)) msgs.push(`رقم الهوية مكرر داخل الملف (الصف ${seenNid.get(nationalId)})`); else seenNid.set(nationalId, rowNo); }
      const email = (g("البريد الإلكتروني") || ex?.email || "").toLowerCase(); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) msgs.push("البريد الإلكتروني غير صحيح");
      const iban = (g("الآيبان") || ex?.iban || "").replace(/\s+/g, "").toUpperCase(); if (iban && !/^SA\d{22}$/.test(iban)) msgs.push("الآيبان يبدأ بـ SA ويليه 22 رقمًا");
      const type = g("نوع التوظيف") ? labelToValue(EMP_TYPE, g("نوع التوظيف")) : ex?.employmentType ?? "full_time"; if (!type) msgs.push("نوع التوظيف غير صحيح");
      const status = g("الحالة") ? labelToValue(EMP_STATUS, g("الحالة")) : ex?.status ?? "active"; if (!status) msgs.push("الحالة غير صحيحة");
      const td = g("تاريخ انتهاء الخدمة"); const terminationDate = td ? parseDate(td) : ex?.terminationDate ?? null; if (td && !terminationDate) msgs.push("تاريخ انتهاء الخدمة غير صحيح");
      if (status === "terminated" && !terminationDate) msgs.push("تاريخ انتهاء الخدمة مطلوب لحالة منتهي الخدمة");
      const money = (h: string, cur: number | null) => { const r = g(h); if (!r) return cur ?? 0; const n = parseNumber(r); if (!Number.isFinite(n) || n < 0) { msgs.push(`${h}: رقم غير صحيح`); return 0; } return Math.round(n * 100); };
      const basic = money("الراتب الأساسي (ريال)", ex?.basicSalaryHalalas ?? null), housing = money("بدل السكن (ريال)", ex?.housingAllowanceHalalas ?? null), transport = money("بدل النقل (ريال)", ex?.transportAllowanceHalalas ?? null);
      if (msgs.length) { out.push(errRow(rowNo, fullName || `صف ${rowNo}`, msgs)); continue; }
      const body = { fullName, branchId, departmentId, jobTitleId, hireDate, nationalId, nationality: g("الجنسية") || ex?.nationality || null, email: email || null, phone: g("الجوال") || ex?.phone || null, iban: iban || null, employmentType: type,
        basicSalaryHalalas: basic, housingAllowanceHalalas: housing, transportAllowanceHalalas: transport, ...(ex ? { status, terminationDate: status === "terminated" ? terminationDate : null } : {}) };
      if (ex) {
        const same = ex.fullName === fullName && ex.branchId === branchId && ex.departmentId === departmentId && ex.jobTitleId === jobTitleId && ex.hireDate === hireDate && (ex.nationalId ?? null) === nationalId && (ex.nationality ?? null) === body.nationality
          && (ex.email ?? null) === body.email && (ex.phone ?? null) === body.phone && (ex.iban ?? null) === body.iban && ex.employmentType === type && ex.status === status && (ex.terminationDate ?? null) === (status === "terminated" ? terminationDate : null)
          && (ex.basicSalaryHalalas ?? 0) === basic && (ex.housingAllowanceHalalas ?? 0) === housing && (ex.transportAllowanceHalalas ?? 0) === transport;
        if (same) { out.push({ rowNo, action: "skip", label: fullName, messages: ["لا تغيير"] }); continue; }
      }
      out.push({ rowNo, action: ex ? "update" : "create", label: fullName, messages: [], run: () => guard(() => api(ex ? `/hr/employees/${ex.id}` : "/hr/employees", { method: ex ? "PUT" : "POST", body })) });
    }
    return out;
  }) as never,
};

export const ENTITIES: Record<EntityId, EntityDef> = { branches: branchesDef, rooms: roomsDef, departments: departmentsDef, employees: employeesDef };

export function workbookFor(def: EntityDef, ctx: unknown | null, withData = true): SheetSpec[] {
  const extra = def.id === "employees" ? ["• الرواتب والهوية والآيبان تظهر لمن يملك صلاحية الموارد البشرية فقط.", "• يحتاج الموظف بريدًا إلكترونيًا ليتسلم الطلبات ويدخل النظام بعد دعوته من «فريق العمل»."] : def.id === "rooms" ? ["• القاعة تتبع فرعها نهائيًا؛ لإضافة قاعة في فرع آخر استخدم صفًا جديدًا."] : [];
  const sheets = sheetOf(def, ctx && withData ? (def.exportRows as (c: unknown) => Cell[][])(ctx) : [], ctx ? (def.lists as (c: unknown) => { column: number; values: string[] }[])(ctx) : [], extra);
  const staticLists = def.columns.map((c, i) => (c.options && c.options.length ? { column: i, values: c.options } : null)).filter(Boolean) as { column: number; values: string[] }[];
  const dyn = sheets[0]!.lists ?? []; sheets[0]!.lists = [...staticLists.filter((s) => !dyn.some((d) => d.column === s.column)), ...dyn];
  return sheets;
}
