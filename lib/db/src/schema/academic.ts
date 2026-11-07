import { pgTable, text, boolean, integer, date, time, timestamp, uniqueIndex, index, check, primaryKey, numeric, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { pk, fkCol, halalas, rate, createdAt, updatedAt, memberFk, vatNet, vatGross } from "./_helpers";
import { branches } from "./core";
import { employees } from "./hr";

// ---------- Facilities ----------------------------------------------------------------------------------------------
export const electricityMeters = pgTable("electricity_meters", {
  id: pk(),
  branchId: fkCol("branch_id").notNull().references(() => branches.id),
  meterNo: text("meter_no").notNull(),
  description: text("description"),
  isSubMeter: boolean("is_sub_meter").notNull().default(false),
  status: text("status").notNull().default("active"),
}, (t) => [
  uniqueIndex("electricity_meters_branch_no_uq").on(t.branchId, t.meterNo),
  check("electricity_meters_status_ck", sql`${t.status} in ('active','inactive')`),
]);

export const rooms = pgTable("rooms", {
  id: pk(),
  branchId: fkCol("branch_id").notNull().references(() => branches.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  roomType: text("room_type").notNull(),
  areaM2: numeric("area_m2", { precision: 10, scale: 2, mode: "number" }).notNull(),
  capacity: integer("capacity").notNull(),
  powerKw: numeric("power_kw", { precision: 8, scale: 2, mode: "number" }),
  meterId: fkCol("meter_id").references(() => electricityMeters.id),
  status: text("status").notNull().default("active"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("rooms_branch_code_uq").on(t.branchId, t.code),
  index("rooms_meter_idx").on(t.meterId),
  check("rooms_type_ck", sql`${t.roomType} in ('classroom','lab','workshop','office')`),
  check("rooms_dimensions_ck", sql`${t.areaM2} > 0 and ${t.capacity} > 0 and (${t.powerKw} is null or ${t.powerKw} >= 0)`),
  check("rooms_status_ck", sql`${t.status} in ('active','maintenance','inactive')`),
]);

export const assetCategories = pgTable("asset_categories", {
  id: pk(),
  parentId: fkCol("parent_id").references((): AnyPgColumn => assetCategories.id),
  name: text("name").notNull(),
  defaultUsefulLifeMonths: integer("default_useful_life_months"),
}, (t) => [uniqueIndex("asset_categories_name_uq").on(t.parentId, t.name)]);

export const assets = pgTable("assets", {
  id: pk(),
  assetTag: text("asset_tag").notNull(),
  branchId: fkCol("branch_id").notNull().references(() => branches.id),
  roomId: fkCol("room_id").references(() => rooms.id),
  categoryId: fkCol("category_id").references(() => assetCategories.id),
  name: text("name").notNull(),
  serialNo: text("serial_no"),
  specifications: text("specifications"),
  purchaseDate: date("purchase_date", { mode: "string" }),
  purchaseCostHalalas: halalas("purchase_cost_halalas").notNull(),
  salvagePercent: rate("salvage_percent").notNull().default(0),
  usefulLifeMonths: integer("useful_life_months"),
  sourceSupplierInvoiceLineId: fkCol("source_supplier_invoice_line_id"),   // FK added in procurement.ts (cycle)
  status: text("status").notNull().default("in_service"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("assets_tag_uq").on(t.assetTag),
  index("assets_room_idx").on(t.roomId),
  index("assets_branch_idx").on(t.branchId),
  check("assets_cost_ck", sql`${t.purchaseCostHalalas} >= 0`),
  check("assets_salvage_ck", sql`${t.salvagePercent} between 0 and 100`),
  check("assets_life_ck", sql`${t.usefulLifeMonths} is null or ${t.usefulLifeMonths} between 1 and 600`),
  check("assets_status_ck", sql`${t.status} in ('in_service','maintenance','retired','lost')`),
]);

export const assetMaintenance = pgTable("asset_maintenance", {
  id: pk(),
  assetId: fkCol("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  dueDate: date("due_date", { mode: "string" }).notNull(),
  performedAt: date("performed_at", { mode: "string" }),
  costHalalas: halalas("cost_halalas").notNull().default(0),
  notes: text("notes"),
  status: text("status").notNull().default("scheduled"),
}, (t) => [
  index("asset_maintenance_due_idx").on(t.dueDate).where(sql`${t.status} = 'scheduled'`),
  check("asset_maintenance_status_ck", sql`${t.status} in ('scheduled','done','cancelled')`),
  check("asset_maintenance_cost_ck", sql`${t.costHalalas} >= 0`),
]);

// ---------- Curriculum ----------------------------------------------------------------------------------------------
export const diplomas = pgTable("diplomas", {
  id: pk(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  durationMonths: integer("duration_months").notNull(),
  totalHours: numeric("total_hours", { precision: 8, scale: 1, mode: "number" }).notNull(),
  admissionRequirements: text("admission_requirements"),
  // Pricing: the specialist chooses inclusive/exclusive when defining the diploma; the three amounts are always derived.
  priceHalalas: halalas("price_halalas").notNull(),
  priceIncludesVat: boolean("price_includes_vat").notNull(),
  vatRate: rate("vat_rate").notNull().default(15),
  netPriceHalalas: halalas("net_price_halalas").generatedAlwaysAs(vatNet("price_halalas", "vat_rate", "price_includes_vat")),
  grossPriceHalalas: halalas("gross_price_halalas").generatedAlwaysAs(vatGross("price_halalas", "vat_rate", "price_includes_vat")),
  status: text("status").notNull().default("active"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("diplomas_code_uq").on(t.code),
  check("diplomas_duration_ck", sql`${t.durationMonths} > 0 and ${t.totalHours} > 0`),
  check("diplomas_price_ck", sql`${t.priceHalalas} >= 0 and ${t.vatRate} between 0 and 100`),
  check("diplomas_status_ck", sql`${t.status} in ('active','closed','draft')`),
]);

export const levels = pgTable("levels", {
  id: pk(),
  diplomaId: fkCol("diploma_id").notNull().references(() => diplomas.id),
  levelNo: integer("level_no").notNull(),
  name: text("name").notNull(),
}, (t) => [uniqueIndex("levels_diploma_no_uq").on(t.diplomaId, t.levelNo), check("levels_no_ck", sql`${t.levelNo} >= 1`)]);

export const subjects = pgTable("subjects", {
  id: pk(),
  code: text("code").notNull(),
  diplomaId: fkCol("diploma_id").notNull().references(() => diplomas.id),
  levelId: fkCol("level_id").notNull().references(() => levels.id),
  name: text("name").notNull(),
  priceHalalas: halalas("price_halalas").notNull(),
  priceIncludesVat: boolean("price_includes_vat").notNull(),
  vatRate: rate("vat_rate").notNull().default(15),
  netPriceHalalas: halalas("net_price_halalas").generatedAlwaysAs(vatNet("price_halalas", "vat_rate", "price_includes_vat")),
  grossPriceHalalas: halalas("gross_price_halalas").generatedAlwaysAs(vatGross("price_halalas", "vat_rate", "price_includes_vat")),
  hours: numeric("hours", { precision: 6, scale: 1, mode: "number" }).notNull(),
  status: text("status").notNull().default("active"),
}, (t) => [
  uniqueIndex("subjects_code_uq").on(t.code),
  uniqueIndex("subjects_diploma_name_uq").on(t.diplomaId, t.name),
  index("subjects_level_idx").on(t.levelId),
  check("subjects_amounts_ck", sql`${t.priceHalalas} >= 0 and ${t.hours} >= 0.5 and ${t.vatRate} between 0 and 100`),
  check("subjects_status_ck", sql`${t.status} in ('active','closed')`),
]);

/** Prerequisite level ordering is enforced by a trigger (prerequisite must belong to the same diploma and an earlier level). */
export const subjectPrerequisites = pgTable("subject_prerequisites", {
  subjectId: fkCol("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  prerequisiteId: fkCol("prerequisite_id").notNull().references(() => subjects.id),
}, (t) => [primaryKey({ columns: [t.subjectId, t.prerequisiteId] }), check("subject_prerequisites_self_ck", sql`${t.subjectId} <> ${t.prerequisiteId}`)]);

// ---------- People --------------------------------------------------------------------------------------------------
export const students = pgTable("students", {
  id: pk(),
  studentNo: text("student_no").notNull(),
  branchId: fkCol("branch_id").notNull().references(() => branches.id),
  diplomaId: fkCol("diploma_id").notNull().references(() => diplomas.id),
  currentLevelId: fkCol("current_level_id").references(() => levels.id),
  fullName: text("full_name").notNull(),
  nationalId: text("national_id"),
  nationality: text("nationality"),
  dateOfBirth: date("date_of_birth", { mode: "string" }),
  email: text("email"),
  phone: text("phone"),
  guardianName: text("guardian_name"),
  guardianPhone: text("guardian_phone"),
  orgMemberId: memberFk("org_member_id"),                              // student portal login
  status: text("status").notNull().default("enrolled"),
  enrolledAt: date("enrolled_at", { mode: "string" }).notNull().default(sql`current_date`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("students_no_uq").on(t.studentNo),
  uniqueIndex("students_national_id_uq").on(t.nationalId).where(sql`${t.nationalId} is not null`),
  uniqueIndex("students_member_uq").on(t.orgMemberId).where(sql`${t.orgMemberId} is not null`),
  index("students_branch_diploma_idx").on(t.branchId, t.diplomaId),
  check("students_status_ck", sql`${t.status} in ('enrolled','graduated','suspended','withdrawn')`),
  check("students_email_ck", sql`${t.email} is null or ${t.email} ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'`),
]);

export const studentSubjects = pgTable("student_subjects", {
  id: pk(),
  studentId: fkCol("student_id").notNull().references(() => students.id),
  subjectId: fkCol("subject_id").notNull().references(() => subjects.id),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true }).defaultNow().notNull(),
  status: text("status").notNull().default("enrolled"),
}, (t) => [
  uniqueIndex("student_subjects_uq").on(t.studentId, t.subjectId),
  check("student_subjects_status_ck", sql`${t.status} in ('enrolled','passed','failed','withdrawn')`),
]);

export const instructors = pgTable("instructors", {
  id: pk(),
  instructorNo: text("instructor_no").notNull(),
  branchId: fkCol("branch_id").notNull().references(() => branches.id),
  employeeId: fkCol("employee_id").references(() => employees.id),
  fullName: text("full_name").notNull(),
  qualification: text("qualification"),
  hourlyRateHalalas: halalas("hourly_rate_halalas").notNull(),
  weeklyHours: numeric("weekly_hours", { precision: 5, scale: 1, mode: "number" }).notNull(),
  orgMemberId: memberFk("org_member_id"),
  status: text("status").notNull().default("active"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("instructors_no_uq").on(t.instructorNo),
  uniqueIndex("instructors_member_uq").on(t.orgMemberId).where(sql`${t.orgMemberId} is not null`),
  index("instructors_branch_idx").on(t.branchId),
  check("instructors_amounts_ck", sql`${t.hourlyRateHalalas} >= 0 and ${t.weeklyHours} between 0 and 168`),
  check("instructors_status_ck", sql`${t.status} in ('active','inactive')`),
]);

export const instructorSubjects = pgTable("instructor_subjects", {
  instructorId: fkCol("instructor_id").notNull().references(() => instructors.id, { onDelete: "cascade" }),
  subjectId: fkCol("subject_id").notNull().references(() => subjects.id),
}, (t) => [primaryKey({ columns: [t.instructorId, t.subjectId] })]);

export const instructorEvaluations = pgTable("instructor_evaluations", {
  id: pk(),
  instructorId: fkCol("instructor_id").notNull().references(() => instructors.id),
  periodStart: date("period_start", { mode: "string" }).notNull(),
  periodEnd: date("period_end", { mode: "string" }).notNull(),
  teachingScore: integer("teaching_score").notNull(),
  punctualityScore: integer("punctuality_score").notNull(),
  studentFeedbackScore: integer("student_feedback_score"),
  notes: text("notes"),
  evaluatedBy: memberFk("evaluated_by").notNull(),
  createdAt: createdAt(),
}, (t) => [
  index("instructor_evaluations_idx").on(t.instructorId, t.periodEnd),
  check("instructor_evaluations_scores_ck", sql`${t.teachingScore} between 0 and 100 and ${t.punctualityScore} between 0 and 100 and (${t.studentFeedbackScore} is null or ${t.studentFeedbackScore} between 0 and 100)`),
  check("instructor_evaluations_period_ck", sql`${t.periodEnd} >= ${t.periodStart}`),
]);

// ---------- Timetable -----------------------------------------------------------------------------------------------
/** Weekly timetable pattern (e.g. Sun/Tue 09:00-11:00 for a term). Concrete sessions are generated from it. */
export const sessionRecurrences = pgTable("session_recurrences", {
  id: pk(),
  branchId: fkCol("branch_id").notNull().references(() => branches.id),
  roomId: fkCol("room_id").notNull().references(() => rooms.id),
  instructorId: fkCol("instructor_id").notNull().references(() => instructors.id),
  diplomaId: fkCol("diploma_id").notNull().references(() => diplomas.id),
  subjectId: fkCol("subject_id").references(() => subjects.id),
  weekdays: integer("weekdays").array().notNull(),                      // ISO weekdays 1 (Mon) .. 7 (Sun)
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  validFrom: date("valid_from", { mode: "string" }).notNull(),
  validTo: date("valid_to", { mode: "string" }).notNull(),
  createdBy: memberFk("created_by"),
  createdAt: createdAt(),
}, (t) => [
  check("session_recurrences_time_ck", sql`${t.endTime} > ${t.startTime}`),
  check("session_recurrences_dates_ck", sql`${t.validTo} >= ${t.validFrom}`),
  check("session_recurrences_weekdays_ck", sql`cardinality(${t.weekdays}) between 1 and 7 and ${t.weekdays} <@ array[1,2,3,4,5,6,7]`),
]);

/**
 * One concrete session. Double-booking of a room or an instructor is rejected by exclusion constraints on the
 * session time range (migration 0003); room capacity by a trigger on session_students.
 */
export const classSessions = pgTable("class_sessions", {
  id: pk(),
  branchId: fkCol("branch_id").notNull().references(() => branches.id),
  roomId: fkCol("room_id").notNull().references(() => rooms.id),
  instructorId: fkCol("instructor_id").notNull().references(() => instructors.id),
  diplomaId: fkCol("diploma_id").notNull().references(() => diplomas.id),
  subjectId: fkCol("subject_id").references(() => subjects.id),
  title: text("title").notNull(),
  sessionDate: date("session_date", { mode: "string" }).notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  status: text("status").notNull().default("scheduled"),
  recurrenceId: fkCol("recurrence_id").references(() => sessionRecurrences.id),   // sessions generated from one weekly pattern
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("class_sessions_date_idx").on(t.sessionDate, t.branchId),
  index("class_sessions_room_idx").on(t.roomId, t.sessionDate),
  index("class_sessions_instructor_idx").on(t.instructorId, t.sessionDate),
  check("class_sessions_time_ck", sql`${t.endTime} > ${t.startTime}`),
  check("class_sessions_status_ck", sql`${t.status} in ('scheduled','done','cancelled')`),
]);

export const sessionStudents = pgTable("session_students", {
  sessionId: fkCol("session_id").notNull().references(() => classSessions.id, { onDelete: "cascade" }),
  studentId: fkCol("student_id").notNull().references(() => students.id),
}, (t) => [primaryKey({ columns: [t.sessionId, t.studentId] }), index("session_students_student_idx").on(t.studentId)]);

export const attendanceRecords = pgTable("attendance_records", {
  id: pk(),
  sessionId: fkCol("session_id").notNull().references(() => classSessions.id),
  studentId: fkCol("student_id").notNull().references(() => students.id),
  present: boolean("present").notNull(),
  method: text("method").notNull().default("manual"),
  recordedBy: memberFk("recorded_by"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("attendance_records_uq").on(t.sessionId, t.studentId),
  check("attendance_records_method_ck", sql`${t.method} in ('manual','nfc','qr')`),
]);

export const grades = pgTable("grades", {
  id: pk(),
  studentId: fkCol("student_id").notNull().references(() => students.id),
  subjectId: fkCol("subject_id").notNull().references(() => subjects.id),
  assessmentType: text("assessment_type").notNull(),
  score: numeric("score", { precision: 6, scale: 2, mode: "number" }).notNull(),
  maxScore: numeric("max_score", { precision: 6, scale: 2, mode: "number" }).notNull(),
  assessedOn: date("assessed_on", { mode: "string" }).notNull(),
  recordedBy: memberFk("recorded_by"),
  createdAt: createdAt(),
}, (t) => [
  index("grades_student_subject_idx").on(t.studentId, t.subjectId),
  check("grades_type_ck", sql`${t.assessmentType} in ('quiz','midterm','final','practical','project')`),
  check("grades_score_ck", sql`${t.maxScore} > 0 and ${t.score} >= 0 and ${t.score} <= ${t.maxScore}`),
]);

