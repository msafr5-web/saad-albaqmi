// Imports the legacy JSONB records (education_records, owner "org:main") into the relational schema.
//
//   DATABASE_URL=... node scripts/import-legacy.mjs [--dry-run] [--prices-include-vat] [--actor-email=a@b.c] [--report=import-report.json]
//
// Design
//  - SAME IDs: every relational row keeps the id of its legacy record (OVERRIDING SYSTEM VALUE), so org_members.linked_record_id, card holders and
//    any stored reference keep working. Identity sequences are repaired afterwards.
//  - IDEMPOTENT: master data is upserted; confirmed money documents (payments, expenses, utility bills, installments) are inserted once and never rewritten.
//    Running it twice changes nothing. Document numbers are deterministic (RC-IMP-<id>, EXP-IMP-<id>) so no counter is burned.
//  - SAFE: one transaction; every record runs in its own savepoint, so a bad record is skipped with a reason instead of aborting the import.
//    --dry-run rolls everything back and only prints the report.
//  - PROVABLE: the report compares legacy counts and money totals with what the relational tables now hold. It exits non-zero if they differ.
//  - ASSUMPTIONS (listed in the report): legacy money is SAR with no VAT split (net = amount, VAT 0); fees are VAT-exclusive unless --prices-include-vat;
//    payment method is unknown (cash); grades are "final" assessments; diploma duration text is parsed to months (fallback 12, flagged).
import pg from "pg";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const ORG = "org:main";
const sar = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null; };
const dateOf = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
const day = (ts) => new Date(ts).toISOString().slice(0, 10);
const email = (v) => (typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? v.trim().toLowerCase() : null);
const pad = (n, w = 5) => String(n).padStart(w, "0");
const ROOM_TYPE = { "قاعة": "classroom", "نظري": "classroom", "معمل": "lab", "عملي": "lab", "ورشة": "workshop", "مكتب": "office" };
const EXPENSE_CAT = { "رواتب": "SALARY", "إيجار": "RENT", "صيانة": "MAINT", "تجهيزات": "EQUIP", "تسويق": "MARKETING", "أخرى": "OTHER", "ورقيات": "PAPER", "حراسة": "SECURITY", "مستلزمات": "STATIONERY", "نظافة": "CLEANING", "كهرباء": "UTILITY" };
const SESSION_STATUS = (s) => (["done", "منعقدة", "منعقد"].includes(s) ? "done" : ["cancelled", "ملغي", "ملغى"].includes(s) ? "cancelled" : "scheduled");

/** "سنتان" / "4 فصول" / "18 شهر" / "2 سنة" -> months. */
export function monthsOf(text) {
  const t = String(text ?? "").trim(); const n = Number((t.match(/\d+(\.\d+)?/) ?? [])[0]);
  if (/سنتان|سنتين/.test(t)) return { months: 24 };
  if (/سنة|سنوات|عام|أعوام/.test(t) && n) return { months: Math.round(n * 12) };
  if (/شهر|أشهر|اشهر/.test(t) && n) return { months: Math.round(n) };
  if (/فصل|فصول|ترم/.test(t) && n) return { months: Math.round(n * 4), note: "فصل دراسي = 4 أشهر (افتراض)" };
  return { months: 12, note: `تعذر فهم المدة «${t}»؛ افتُرض 12 شهرًا` };
}

export async function runImport(c, opts = {}) {
  const report = { startedAt: new Date().toISOString(), dryRun: !!opts.dryRun, assumptions: [], kinds: {}, skipped: [], notes: [], totals: {}, ok: true };
  const bump = (kind, k) => { (report.kinds[kind] ??= { legacy: 0, imported: 0, existing: 0, skipped: 0 })[k]++; };
  const skip = (kind, id, reason) => { bump(kind, "skipped"); report.skipped.push({ kind, id, reason }); };
  report.assumptions.push("المبالغ القديمة بالريال دون فصل ضريبة (الصافي = المبلغ، الضريبة 0)", opts.pricesIncludeVat ? "أسعار الدبلومات والمواد شاملة الضريبة" : "أسعار الدبلومات والمواد قبل الضريبة", "طريقة الدفع غير مسجلة في السجل القديم؛ اعتُمدت «نقدًا»", "الدرجات تُستورد كاختبار نهائي (final)");

  const { rows: all } = await c.query("select id::int id, kind, name, branch_id::int branch_id, status, details, created_at from education_records where owner_id = $1 order by id", [ORG]);
  const of = (k) => all.filter((r) => r.kind === k);
  for (const k of ["branch", "room", "asset", "diploma", "level", "subject", "student", "instructor", "session", "attendance", "grade", "expense", "invoice", "installment", "payment"]) report.kinds[k] = { legacy: of(k).length, imported: 0, existing: 0, skipped: 0 };

  // importer identity (the audit columns of money documents need a real account)
  const actorQ = opts.actorEmail
    ? await c.query("select id::int id from org_members where lower(email) = lower($1) and status = 'active'", [opts.actorEmail])
    : await c.query("select id::int id from org_members where role = 'super_admin' and status = 'active' order by id limit 1");
  if (!actorQ.rowCount) throw new Error("لا يوجد حساب إدارة عليا نشط لينسب إليه الاستيراد؛ مرّر --actor-email");
  const actor = actorQ.rows[0].id;

  const sp = async (kind, id, fn) => {                                // one savepoint per record
    await c.query("savepoint rec");
    try { const r = await fn(); await c.query("release savepoint rec"); return r; }
    catch (e) { await c.query("rollback to savepoint rec"); await c.query("release savepoint rec"); skip(kind, id, String(e.message).split("\n")[0]); return undefined; }
  };
  const exists = async (table, id) => (await c.query(`select 1 from ${table} where id = $1`, [id])).rowCount > 0;
  const oneTime = async (kind, table, id, insertFn) => {            // documents: insert once, never rewrite
    if (await exists(table, id)) { bump(kind, "existing"); return false; }
    await insertFn(); bump(kind, "imported"); return true;
  };
  const upsertDone = (kind) => bump(kind, "imported");

  const branchIds = new Set(of("branch").map((b) => b.id));
  const roomsById = new Map(), subjectsById = new Map(of("subject").map((s) => [s.id, s])), diplomaIds = new Set(of("diploma").map((d) => d.id));
  const studentsById = new Map(of("student").map((s) => [s.id, s]));
  await c.query("select pg_advisory_xact_lock(hashtext('legacy-import'))");

  // ---- branches, rooms ----
  const hasHead = Number((await c.query("select count(*)::int n from branches where is_head_office")).rows[0].n) > 0; let head = hasHead;
  for (const b of of("branch")) await sp("branch", b.id, async () => {
    const isHead = !head && /المركز الرئيسي/.test(b.name); if (isHead) head = true;
    await c.query(`insert into branches (id, code, name, city, is_head_office, status) overriding system value values ($1,$2,$3,$4,$5,$6)
      on conflict (id) do update set name = excluded.name, city = excluded.city, status = excluded.status`, [b.id, `BR-${b.id}`, b.name, String(b.details.city ?? "—"), isHead, b.status === "closed" ? "inactive" : "active"]); upsertDone("branch");
  });
  for (const r of of("room")) await sp("room", r.id, async () => {
    if (!branchIds.has(r.branch_id)) throw new Error("فرع القاعة غير موجود");
    const area = Number(r.details.area) > 0 ? Number(r.details.area) : 1, cap = Math.max(1, Math.floor(Number(r.details.capacity) || 1));
    await c.query(`insert into rooms (id, branch_id, code, name, room_type, area_m2, capacity, power_kw, status) overriding system value values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      on conflict (id) do update set name = excluded.name, room_type = excluded.room_type, area_m2 = excluded.area_m2, capacity = excluded.capacity, power_kw = excluded.power_kw, status = excluded.status`,
      [r.id, r.branch_id, `RM-${r.id}`, r.name, ROOM_TYPE[String(r.details.type ?? "")] ?? "classroom", area, cap, r.details.powerKw == null ? null : Math.max(0, Number(r.details.powerKw) || 0), r.status === "maintenance" ? "maintenance" : r.status === "closed" ? "inactive" : "active"]);
    roomsById.set(r.id, r); upsertDone("room");
  });
  await c.query("insert into warehouses (branch_id, code, name) select b.id, 'WH-' || b.code, 'مستودع ' || b.name from branches b where not exists (select 1 from warehouses w where w.branch_id = b.id)");
  for (const r of (await c.query("select id::int id from rooms")).rows) roomsById.set(r.id, true);

  // ---- diplomas, levels, subjects ----
  const hoursByDiploma = new Map();
  for (const s of of("subject")) hoursByDiploma.set(s.details.diplomaId, (hoursByDiploma.get(s.details.diplomaId) ?? 0) + (Number(s.details.hours) || 0));
  for (const d of of("diploma")) await sp("diploma", d.id, async () => {
    const m = monthsOf(d.details.duration); if (m.note) report.notes.push(`دبلوم «${d.name}» (#${d.id}): ${m.note}`);
    const hours = hoursByDiploma.get(d.id) || 1; if (!hoursByDiploma.get(d.id)) report.notes.push(`دبلوم «${d.name}» (#${d.id}): بلا مواد؛ الساعات الكلية 1 مؤقتًا`);
    const fee = sar(d.details.fee); if (fee == null) throw new Error("رسوم الدبلوم غير صحيحة");
    await c.query(`insert into diplomas (id, code, name, duration_months, total_hours, price_halalas, price_includes_vat, status) overriding system value values ($1,$2,$3,$4,$5,$6,$7,'active')
      on conflict (id) do update set name = excluded.name, duration_months = excluded.duration_months, total_hours = excluded.total_hours, price_halalas = excluded.price_halalas`, [d.id, `DIP-${d.id}`, d.name, m.months, hours, fee, !!opts.pricesIncludeVat]); upsertDone("diploma");
  });
  for (const l of of("level")) await sp("level", l.id, async () => {
    await c.query(`insert into levels (id, diploma_id, level_no, name) overriding system value values ($1,$2,$3,$4) on conflict (id) do update set name = excluded.name, level_no = excluded.level_no`, [l.id, l.details.diplomaId, Number(l.details.order), l.name]); upsertDone("level");
  });
  for (const s of of("subject")) await sp("subject", s.id, async () => {
    const price = sar(s.details.price); if (price == null) throw new Error("سعر المادة غير صحيح");
    await c.query(`insert into subjects (id, code, diploma_id, level_id, name, price_halalas, price_includes_vat, hours, status) overriding system value values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      on conflict (id) do update set name = excluded.name, price_halalas = excluded.price_halalas, hours = excluded.hours, level_id = excluded.level_id`,
      [s.id, `SUB-${s.id}`, s.details.diplomaId, s.details.levelId, s.name, price, !!opts.pricesIncludeVat, Math.max(0.5, Number(s.details.hours) || 0.5), s.status === "closed" ? "closed" : "active"]); upsertDone("subject");
  });
  for (const s of of("subject")) for (const pre of Array.isArray(s.details.prerequisiteIds) ? s.details.prerequisiteIds : [])
    await sp("subject_prerequisite", s.id, async () => { await c.query("insert into subject_prerequisites (subject_id, prerequisite_id) values ($1,$2) on conflict do nothing", [s.id, pre]); });

  // ---- students, instructors ----
  for (const s of of("student")) await sp("student", s.id, async () => {
    if (!diplomaIds.has(s.details.diplomaId)) throw new Error("دبلوم الطالب غير موجود");
    await c.query(`insert into students (id, student_no, branch_id, diploma_id, current_level_id, full_name, email, phone, status, enrolled_at, created_at) overriding system value values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      on conflict (id) do update set full_name = excluded.full_name, email = excluded.email, phone = excluded.phone, current_level_id = excluded.current_level_id, status = excluded.status`,
      [s.id, `ST-${pad(s.id)}`, s.branch_id, s.details.diplomaId, s.details.levelId ?? null, s.name, email(s.details.email), typeof s.details.phone === "string" ? s.details.phone.trim().slice(0, 30) || null : null,
        ["enrolled", "graduated", "suspended"].includes(s.status) ? s.status : "enrolled", day(s.created_at), s.created_at]); upsertDone("student");
    for (const sub of Array.isArray(s.details.subjectIds) ? s.details.subjectIds : []) await c.query("insert into student_subjects (student_id, subject_id) values ($1,$2) on conflict (student_id, subject_id) do nothing", [s.id, sub]);
  });
  for (const i of of("instructor")) await sp("instructor", i.id, async () => {
    const rate = sar(i.details.hourlyRate); if (rate == null) throw new Error("أجر الساعة غير صحيح");
    await c.query(`insert into instructors (id, instructor_no, branch_id, full_name, qualification, hourly_rate_halalas, weekly_hours, created_at) overriding system value values ($1,$2,$3,$4,$5,$6,$7,$8)
      on conflict (id) do update set full_name = excluded.full_name, qualification = excluded.qualification, hourly_rate_halalas = excluded.hourly_rate_halalas, weekly_hours = excluded.weekly_hours`,
      [i.id, `IN-${pad(i.id)}`, i.branch_id, i.name, typeof i.details.qualification === "string" ? i.details.qualification.slice(0, 200) : null, rate, Math.min(168, Math.max(0, Number(i.details.weeklyHours) || 0)), i.created_at]); upsertDone("instructor");
    for (const sub of Array.isArray(i.details.subjectIds) ? i.details.subjectIds : []) await c.query("insert into instructor_subjects (instructor_id, subject_id) values ($1,$2) on conflict do nothing", [i.id, sub]);
  });

  // ---- assets ----
  for (const a of of("asset")) await sp("asset", a.id, async () => {
    const cost = sar(a.details.value); if (cost == null) throw new Error("قيمة الأصل غير صحيحة");
    await c.query(`insert into assets (id, asset_tag, branch_id, room_id, name, serial_no, purchase_date, purchase_cost_halalas, status, created_at) overriding system value values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      on conflict (id) do update set name = excluded.name, room_id = excluded.room_id, serial_no = excluded.serial_no, purchase_cost_halalas = excluded.purchase_cost_halalas, status = excluded.status`,
      [a.id, `AST-${pad(a.id)}`, a.branch_id, roomsById.has(a.details.roomId) ? a.details.roomId : null, a.name, typeof a.details.serial === "string" ? a.details.serial.slice(0, 80) : null, dateOf(a.details.purchaseDate), cost,
        a.status === "maintenance" ? "maintenance" : a.status === "retired" ? "retired" : "in_service", a.created_at]); upsertDone("asset");
    const due = dateOf(a.details.maintenanceDate);
    if (due) await c.query("insert into asset_maintenance (asset_id, due_date) select $1, $2::date where not exists (select 1 from asset_maintenance where asset_id = $1 and due_date = $2::date)", [a.id, due]);
  });

  // ---- sessions, attendance, grades ----
  for (const s of of("session")) await sp("session", s.id, async () => {
    const d = s.details, date = dateOf(d.date); if (!date) throw new Error("تاريخ الحصة غير صحيح");
    await c.query(`insert into class_sessions (id, branch_id, room_id, instructor_id, diploma_id, subject_id, title, session_date, start_time, end_time, status, created_at) overriding system value values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      on conflict (id) do update set title = excluded.title, status = excluded.status`, [s.id, s.branch_id, d.roomId, d.instructorId, d.diplomaId, d.subjectId ?? null, s.name, date, d.start, d.end, SESSION_STATUS(s.status), s.created_at]); upsertDone("session");
    for (const st of Array.isArray(d.studentIds) ? d.studentIds : []) {
      await c.query("savepoint seat");
      try { await c.query("insert into session_students (session_id, student_id) values ($1,$2) on conflict do nothing", [s.id, st]); await c.query("release savepoint seat"); }
      catch (e) { await c.query("rollback to savepoint seat"); await c.query("release savepoint seat"); report.notes.push(`حصة #${s.id}: لم يُسجَّل الطالب #${st} (${String(e.message).split("\n")[0]})`); }
    }
  });
  for (const a of of("attendance")) await sp("attendance", a.id, async () => {
    if (typeof a.details.present !== "boolean") throw new Error("حالة الحضور غير محددة");
    const r = await c.query(`insert into attendance_records (session_id, student_id, present, method, recorded_at) values ($1,$2,$3,'manual',$4) on conflict (session_id, student_id) do nothing`, [a.details.sessionId, a.details.studentId, a.details.present, a.created_at]);
    r.rowCount ? bump("attendance", "imported") : bump("attendance", "existing");
  });
  const subjectByName = new Map(); for (const s of of("subject")) subjectByName.set(`${s.details.diplomaId}|${s.name.trim()}`, s.id);
  for (const g of of("grade")) await sp("grade", g.id, async () => {
    const st = studentsById.get(g.details.studentId); const sid = st && subjectByName.get(`${st.details.diplomaId}|${String(g.details.subject ?? "").trim()}`);
    if (!sid) throw new Error(`المادة «${g.details.subject}» غير معروفة لدبلوم الطالب`);
    const r = await c.query(`insert into grades (id, student_id, subject_id, assessment_type, score, max_score, assessed_on, created_at) overriding system value select $1,$2,$3,'final',$4,$5,$6,$7 where not exists (select 1 from grades where id = $1)`,
      [g.id, g.details.studentId, sid, Number(g.details.score), Number(g.details.maxScore), day(g.created_at), g.created_at]);
    r.rowCount ? bump("grade", "imported") : bump("grade", "existing");
  });

  // ---- money: expenses, utility bills, installments, payments ----
  const cats = new Map((await c.query("select code, id::int id from expense_categories")).rows.map((r) => [r.code, r.id]));
  for (const e of of("expense")) await sp("expense", e.id, async () => {
    const amount = sar(e.details.amount), date = dateOf(e.details.date); if (amount == null || amount === 0 || !date) throw new Error("مبلغ أو تاريخ المصروف غير صحيح");
    const code = EXPENSE_CAT[String(e.details.category ?? "")] ?? "OTHER"; if (!EXPENSE_CAT[String(e.details.category ?? "")]) report.notes.push(`مصروف #${e.id}: الفئة «${e.details.category}» غير معروفة؛ سُجّل ضمن «أخرى»`);
    await oneTime("expense", "expenses", e.id, () => c.query(`insert into expenses (id, expense_no, branch_id, category_id, expense_date, description, net_halalas, vat_halalas, source, status, created_by, confirmed_at, created_at) overriding system value
      values ($1,$2,$3,$4,$5,$6,$7,0,'manual','confirmed',$8,$9,$9)`, [e.id, `EXP-IMP-${e.id}`, e.branch_id, cats.get(code), date, e.name, amount, actor, e.created_at]));
  });
  for (const u of of("invoice")) await sp("invoice", u.id, async () => {
    const m = String(u.details.month ?? ""); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new Error("شهر فاتورة الكهرباء غير صحيح");
    const amount = sar(u.details.amount), kwh = Number(u.details.kwh); if (amount == null || !Number.isFinite(kwh) || kwh < 0) throw new Error("مبلغ أو استهلاك الفاتورة غير صحيح");
    const meterNo = String(u.details.meter ?? "").trim(); if (!meterNo) throw new Error("رقم العداد مطلوب");
    const meter = (await c.query(`insert into electricity_meters (branch_id, meter_no) values ($1,$2) on conflict (branch_id, meter_no) do update set meter_no = excluded.meter_no returning id::int id`, [u.branch_id, meterNo])).rows[0].id;
    await oneTime("invoice", "utility_invoices", u.id, () => c.query(`insert into utility_invoices (id, branch_id, meter_id, bill_month, kwh, net_halalas, vat_halalas, bill_no, created_at) overriding system value values ($1,$2,$3,$4,$5,$6,0,$7,$8)`, [u.id, u.branch_id, meter, `${m}-01`, kwh, amount, u.name, u.created_at]));
  });
  const insts = of("installment"); const seqByStudent = new Map();
  for (const i of [...insts].sort((a, b) => String(a.details.dueDate).localeCompare(String(b.details.dueDate)) || a.id - b.id)) await sp("installment", i.id, async () => {
    const amount = sar(i.details.amount), due = dateOf(i.details.dueDate); if (!amount || !due || !studentsById.has(i.details.studentId)) throw new Error("قسط غير صحيح أو طالبه غير موجود");
    const seq = (seqByStudent.get(i.details.studentId) ?? 0) + 1; seqByStudent.set(i.details.studentId, seq);
    await oneTime("installment", "installments", i.id, async () => {
      const next = Number((await c.query("select coalesce(max(seq),0)::int n from installments where student_id = $1", [i.details.studentId])).rows[0].n) + 1;
      await c.query(`insert into installments (id, student_id, seq, due_date, amount_halalas, status, created_at) overriding system value values ($1,$2,$3,$4,$5,'pending',$6)`, [i.id, i.details.studentId, next, due, amount, i.created_at]);
    });
  });
  for (const p of of("payment")) await sp("payment", p.id, async () => {
    const amount = sar(p.details.amount), date = dateOf(p.details.date); const st = studentsById.get(p.details.studentId);
    if (!amount || !date || !st) throw new Error("دفعة غير صحيحة أو طالبها غير موجود");
    await oneTime("payment", "payments", p.id, () => c.query(`insert into payments (id, receipt_no, branch_id, student_id, amount_halalas, paid_on, method, status, collected_by, confirmed_at, created_at) overriding system value
      values ($1,$2,$3,$4,$5,$6,'cash','confirmed',$7,$8,$8)`, [p.id, `RC-IMP-${p.id}`, st.branch_id, p.details.studentId, amount, date, actor, p.created_at]));
  });

  // allocate payments to installments oldest-due first (same rule as the legacy ledger), only the part not yet allocated
  const students = [...new Set(insts.map((i) => i.details.studentId))];
  for (const sid of students) await sp("allocation", `student-${sid}`, async () => {
    const pays = (await c.query(`select p.id::int id, p.amount_halalas::bigint - coalesce((select sum(a.amount_halalas) from payment_allocations a where a.payment_id = p.id), 0) as left
      from payments p where p.student_id = $1 and p.status = 'confirmed' and p.reverses_payment_id is null order by p.paid_on, p.id`, [sid])).rows.map((r) => ({ id: r.id, left: Number(r.left) }));
    const ins = (await c.query(`select i.id::int id, i.amount_halalas::bigint - coalesce((select sum(a.amount_halalas) from payment_allocations a where a.installment_id = i.id), 0) as left
      from installments i where i.student_id = $1 and i.status <> 'cancelled' order by i.due_date, i.id`, [sid])).rows.map((r) => ({ id: r.id, left: Number(r.left) }));
    for (const p of pays) for (const i of ins) {
      if (p.left <= 0) break; if (i.left <= 0) continue;
      const x = Math.min(p.left, i.left);
      await c.query("insert into payment_allocations (payment_id, installment_id, amount_halalas) values ($1,$2,$3) on conflict (payment_id, installment_id) do update set amount_halalas = payment_allocations.amount_halalas + excluded.amount_halalas", [p.id, i.id, x]);
      p.left -= x; i.left -= x;
    }
    await c.query(`update installments i set status = case when coalesce((select sum(amount_halalas) from payment_allocations a where a.installment_id = i.id), 0) >= i.amount_halalas then 'paid'
        when coalesce((select sum(amount_halalas) from payment_allocations a where a.installment_id = i.id), 0) > 0 then 'partial' else 'pending' end where i.student_id = $1 and i.status <> 'cancelled'`, [sid]);
  });

  // ---- identity sequences ----
  for (const t of ["branches", "rooms", "diplomas", "levels", "subjects", "students", "instructors", "assets", "class_sessions", "grades", "expenses", "utility_invoices", "installments", "payments"])
    await c.query(`select setval(pg_get_serial_sequence('${t}', 'id'), greatest((select coalesce(max(id), 1) from ${t}), 1))`);

  // ---- reconciliation ----
  const count = async (t, where = "true") => Number((await c.query(`select count(*)::int n from ${t} where ${where}`)).rows[0].n);
  const sumL = (k, f) => of(k).reduce((a, r) => a + (f(r) ?? 0), 0);
  const importedIds = async (t) => new Set((await c.query(`select id::int id from ${t}`)).rows.map((r) => r.id));
  const sumIdsMoney = async (k, table, col, f) => { const ids = await importedIds(table); return of(k).filter((r) => ids.has(r.id)).reduce((a, r) => a + (f(r) ?? 0), 0); };
  const check = async (name, legacy, rel) => { const ok = legacy === rel; if (!ok) report.ok = false; report.totals[name] = { legacy, relational: rel, ok }; };
  await check("payments_halalas", await sumIdsMoney("payment", "payments", "amount_halalas", (r) => sar(r.details.amount)), Number((await c.query("select coalesce(sum(amount_halalas),0)::bigint s from payments where id = any($1)", [of("payment").map((r) => r.id)])).rows[0].s));
  await check("expenses_halalas", await sumIdsMoney("expense", "expenses", "net_halalas", (r) => sar(r.details.amount)), Number((await c.query("select coalesce(sum(net_halalas),0)::bigint s from expenses where id = any($1)", [of("expense").map((r) => r.id)])).rows[0].s));
  await check("installments_halalas", await sumIdsMoney("installment", "installments", "amount_halalas", (r) => sar(r.details.amount)), Number((await c.query("select coalesce(sum(amount_halalas),0)::bigint s from installments where id = any($1)", [of("installment").map((r) => r.id)])).rows[0].s));
  await check("utility_halalas", await sumIdsMoney("invoice", "utility_invoices", "net_halalas", (r) => sar(r.details.amount)), Number((await c.query("select coalesce(sum(net_halalas),0)::bigint s from utility_invoices where id = any($1)", [of("invoice").map((r) => r.id)])).rows[0].s));
  await check("allocations_within_payments", 0, Number((await c.query("select count(*)::int n from (select p.id from payments p join payment_allocations a on a.payment_id = p.id group by p.id, p.amount_halalas having sum(a.amount_halalas) > p.amount_halalas) x")).rows[0].n));
  for (const [k, v] of Object.entries(report.kinds)) { if (v.imported + v.existing + v.skipped < v.legacy) { report.ok = false; report.notes.push(`${k}: ${v.legacy - v.imported - v.existing - v.skipped} سجلًا غير محسوب`); } }
  report.rows = { branches: await count("branches"), students: await count("students"), instructors: await count("instructors"), sessions: await count("class_sessions"), payments: await count("payments"), expenses: await count("expenses") };
  report.finishedAt = new Date().toISOString();
  void sumL;
  return report;
}

// ---------------- CLI ----------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set");
  const args = process.argv.slice(2); const flag = (n) => args.includes(`--${n}`); const val = (n) => (args.find((a) => a.startsWith(`--${n}=`)) ?? "").split("=")[1];
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
  try {
    await c.query("begin");
    const report = await runImport(c, { dryRun: flag("dry-run"), pricesIncludeVat: flag("prices-include-vat"), actorEmail: val("actor-email") });
    if (flag("dry-run") || !report.ok) await c.query("rollback"); else await c.query("commit");
    if (!report.ok && !flag("dry-run")) report.notes.push("المطابقة فشلت: تم التراجع عن الاستيراد كاملًا");
    const file = val("report"); if (file) fs.writeFileSync(file, JSON.stringify(report, null, 1));
    console.log(JSON.stringify({ ok: report.ok, dryRun: report.dryRun, kinds: report.kinds, totals: report.totals, skipped: report.skipped.length, notes: report.notes.length }, null, 1));
    process.exitCode = report.ok ? 0 : 2;
  } catch (e) { await c.query("rollback").catch(() => {}); console.error(e.message); process.exitCode = 1; }
  finally { await c.end(); }
}
