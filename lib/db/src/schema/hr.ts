import { pgTable, text, boolean, integer, date, time, timestamp, uniqueIndex, index, check, primaryKey, numeric, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { pk, fkCol, halalas, createdAt, updatedAt, memberFk } from "./_helpers";
import { branches } from "./core";

export const departments = pgTable("departments", {
  id: pk(),
  branchId: fkCol("branch_id").references(() => branches.id),          // null = organization-wide department
  parentId: fkCol("parent_id").references((): AnyPgColumn => departments.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  managerEmployeeId: fkCol("manager_employee_id").references((): AnyPgColumn => employees.id),
  status: text("status").notNull().default("active"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("departments_code_uq").on(t.code),
  index("departments_branch_idx").on(t.branchId),
  check("departments_status_ck", sql`${t.status} in ('active','inactive')`),
  check("departments_parent_ck", sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
]);

export const jobTitles = pgTable("job_titles", {
  id: pk(),
  name: text("name").notNull(),
  grade: text("grade"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("job_titles_name_uq").on(t.name)]);

/** HR record of every staff member. PII columns (national_id, iban) must be encrypted at rest by the hosting provider. */
export const employees = pgTable("employees", {
  id: pk(),
  employeeNo: text("employee_no").notNull(),
  fullName: text("full_name").notNull(),
  branchId: fkCol("branch_id").notNull().references(() => branches.id),
  departmentId: fkCol("department_id").references(() => departments.id),
  jobTitleId: fkCol("job_title_id").references(() => jobTitles.id),
  orgMemberId: memberFk("org_member_id"),                              // login account, when the employee uses the system
  nationalId: text("national_id"),
  nationality: text("nationality"),
  email: text("email"),
  phone: text("phone"),
  iban: text("iban"),
  employmentType: text("employment_type").notNull().default("full_time"),
  hireDate: date("hire_date", { mode: "string" }).notNull(),
  terminationDate: date("termination_date", { mode: "string" }),
  status: text("status").notNull().default("active"),
  basicSalaryHalalas: halalas("basic_salary_halalas").notNull().default(0),
  housingAllowanceHalalas: halalas("housing_allowance_halalas").notNull().default(0),
  transportAllowanceHalalas: halalas("transport_allowance_halalas").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("employees_no_uq").on(t.employeeNo),
  uniqueIndex("employees_national_id_uq").on(t.nationalId).where(sql`${t.nationalId} is not null`),
  uniqueIndex("employees_member_uq").on(t.orgMemberId).where(sql`${t.orgMemberId} is not null`),
  index("employees_branch_idx").on(t.branchId),
  index("employees_department_idx").on(t.departmentId),
  check("employees_type_ck", sql`${t.employmentType} in ('full_time','part_time','contract','trainee')`),
  check("employees_status_ck", sql`${t.status} in ('active','on_leave','suspended','terminated')`),
  check("employees_salary_ck", sql`${t.basicSalaryHalalas} >= 0 and ${t.housingAllowanceHalalas} >= 0 and ${t.transportAllowanceHalalas} >= 0`),
  check("employees_dates_ck", sql`${t.terminationDate} is null or ${t.terminationDate} >= ${t.hireDate}`),
  check("employees_iban_ck", sql`${t.iban} is null or ${t.iban} ~ '^SA[0-9]{22}$'`),
]);

export const leaveTypes = pgTable("leave_types", {
  id: pk(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  isPaid: boolean("is_paid").notNull().default(true),
  annualDays: integer("annual_days"),
}, (t) => [uniqueIndex("leave_types_code_uq").on(t.code)]);

/** Overlapping approved leaves for one employee are rejected by an exclusion constraint (migration 0003). */
export const leaveRequests = pgTable("leave_requests", {
  id: pk(),
  employeeId: fkCol("employee_id").notNull().references(() => employees.id),
  leaveTypeId: fkCol("leave_type_id").notNull().references(() => leaveTypes.id),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  status: text("status").notNull().default("pending"),
  reason: text("reason"),
  requestedBy: memberFk("requested_by"),
  decidedBy: memberFk("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  index("leave_requests_employee_idx").on(t.employeeId, t.startDate),
  check("leave_requests_dates_ck", sql`${t.endDate} >= ${t.startDate}`),
  check("leave_requests_status_ck", sql`${t.status} in ('pending','approved','rejected','cancelled')`),
]);

/**
 * Temporary authority transfer (e.g. a branch manager on leave -> head-office procurement).
 * Proposed by HR, approved by the General Manager (business decision, Nov 2026). Active windows for the same
 * delegator and scope may not overlap (exclusion constraint, migration 0003).
 */
export const approvalDelegations = pgTable("approval_delegations", {
  id: pk(),
  delegatorMemberId: memberFk("delegator_member_id").notNull(),
  delegateMemberId: memberFk("delegate_member_id").notNull(),
  scope: text("scope").notNull().default("purchase_approval"),
  validFrom: date("valid_from", { mode: "string" }).notNull(),
  validTo: date("valid_to", { mode: "string" }).notNull(),
  leaveRequestId: fkCol("leave_request_id").references(() => leaveRequests.id),
  proposedBy: memberFk("proposed_by").notNull(),                       // HR
  approvedBy: memberFk("approved_by"),                                 // General Manager
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  status: text("status").notNull().default("proposed"),
  createdAt: createdAt(),
}, (t) => [
  index("approval_delegations_delegator_idx").on(t.delegatorMemberId, t.validFrom),
  check("approval_delegations_self_ck", sql`${t.delegatorMemberId} <> ${t.delegateMemberId}`),
  check("approval_delegations_dates_ck", sql`${t.validTo} >= ${t.validFrom}`),
  check("approval_delegations_scope_ck", sql`${t.scope} in ('purchase_approval','finance_approval','all')`),
  check("approval_delegations_status_ck", sql`${t.status} in ('proposed','approved','rejected','revoked','expired')`),
  check("approval_delegations_approved_ck", sql`${t.status} <> 'approved' or (${t.approvedBy} is not null and ${t.approvedBy} <> ${t.proposedBy})`),
]);

export const shifts = pgTable("shifts", {
  id: pk(),
  name: text("name").notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  graceMinutes: integer("grace_minutes").notNull().default(10),
}, (t) => [uniqueIndex("shifts_name_uq").on(t.name), check("shifts_grace_ck", sql`${t.graceMinutes} between 0 and 120`)]);

export const employeeShifts = pgTable("employee_shifts", {
  employeeId: fkCol("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  shiftId: fkCol("shift_id").notNull().references(() => shifts.id),
  validFrom: date("valid_from", { mode: "string" }).notNull(),
  validTo: date("valid_to", { mode: "string" }),
}, (t) => [primaryKey({ columns: [t.employeeId, t.validFrom] }), check("employee_shifts_dates_ck", sql`${t.validTo} is null or ${t.validTo} >= ${t.validFrom}`)]);

/** One run per branch per month; lines hold the computed pay. Locked runs are immutable (trigger, migration 0003). */
export const payrollRuns = pgTable("payroll_runs", {
  id: pk(),
  branchId: fkCol("branch_id").notNull().references(() => branches.id),
  periodMonth: date("period_month", { mode: "string" }).notNull(),     // first day of the month
  status: text("status").notNull().default("draft"),
  approvedBy: memberFk("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("payroll_runs_branch_month_uq").on(t.branchId, t.periodMonth),
  check("payroll_runs_month_ck", sql`extract(day from ${t.periodMonth}) = 1`),
  check("payroll_runs_status_ck", sql`${t.status} in ('draft','approved','paid')`),
]);

export const payrollLines = pgTable("payroll_lines", {
  id: pk(),
  runId: fkCol("run_id").notNull().references(() => payrollRuns.id, { onDelete: "cascade" }),
  employeeId: fkCol("employee_id").notNull().references(() => employees.id),
  basicHalalas: halalas("basic_halalas").notNull(),
  allowancesHalalas: halalas("allowances_halalas").notNull().default(0),
  deductionsHalalas: halalas("deductions_halalas").notNull().default(0),
  netHalalas: halalas("net_halalas").generatedAlwaysAs(sql`basic_halalas + allowances_halalas - deductions_halalas`),
  daysWorked: numeric("days_worked", { precision: 5, scale: 2, mode: "number" }),
}, (t) => [
  uniqueIndex("payroll_lines_run_employee_uq").on(t.runId, t.employeeId),
  check("payroll_lines_amounts_ck", sql`${t.basicHalalas} >= 0 and ${t.allowancesHalalas} >= 0 and ${t.deductionsHalalas} >= 0`),
]);
