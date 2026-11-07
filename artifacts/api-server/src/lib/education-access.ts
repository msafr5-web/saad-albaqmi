import type { EducationRow } from "./education-demo";
import { DomainError } from "./education-validation";

export const ROLES = ["super_admin", "branch_manager", "finance", "coordinator", "instructor", "student", "warehouse_keeper", "procurement_officer", "hr_officer"] as const;
export type Role = (typeof ROLES)[number];

export type Member = { id: number; clerkUserId: string; email: string; role: Role; branchId: number | null; linkedRecordId: number | null };

const FINANCE_KINDS = ["expense", "invoice", "payment", "installment"];
const CATALOG_KINDS = ["diploma", "level", "subject"];
const GLOBAL_KINDS = ["branch", ...CATALOG_KINDS];
const BRANCH_KINDS = ["room", "asset", "student", "instructor", "session", "attendance", "grade", ...FINANCE_KINDS];

const WRITABLE: Record<Role, string[]> = {
  super_admin: [...GLOBAL_KINDS, ...BRANCH_KINDS],
  branch_manager: BRANCH_KINDS,
  finance: FINANCE_KINDS,
  coordinator: ["room", "asset", "student", "session", "attendance", "grade"],
  instructor: ["attendance", "grade"],
  student: [],
  warehouse_keeper: [],
  procurement_officer: [],
  hr_officer: [],
};

const PAGES: Record<Role, string[]> = {
  super_admin: ["dashboard", "branches", "rooms", "assets", "diplomas", "students", "instructors", "finance", "schedule", "reports", "nfc", "settings", "team", "audit", "inventory", "procurement", "hr", "fiscal"],
  branch_manager: ["dashboard", "branches", "rooms", "assets", "diplomas", "students", "instructors", "finance", "schedule", "reports", "nfc", "settings", "inventory", "procurement", "hr", "fiscal"],
  finance: ["dashboard", "branches", "students", "instructors", "finance", "reports", "settings", "inventory", "procurement", "hr", "fiscal"],
  coordinator: ["dashboard", "rooms", "assets", "diplomas", "students", "instructors", "schedule", "nfc", "settings", "inventory"],
  instructor: ["dashboard", "students", "schedule", "settings"],
  student: ["dashboard", "schedule", "finance", "settings"],
  warehouse_keeper: ["dashboard", "inventory", "settings"],
  procurement_officer: ["dashboard", "inventory", "procurement", "settings"],
  hr_officer: ["dashboard", "hr", "settings"],
};

/** Roles whose scope is a single branch (finance may also be organization-wide with a null branch). */
export const branchScoped = (r: Role) => r !== "super_admin";
/** Finance and procurement officers may work organization-wide (no branch); every other non-admin role belongs to one branch. */
export const needsBranch = (r: Role) => r !== "super_admin" && r !== "finance" && r !== "procurement_officer" && r !== "hr_officer";
export const needsLink = (r: Role) => r === "instructor" || r === "student";
export const sensitiveFinanceRead = (r: Role) => r === "super_admin" || r === "branch_manager" || r === "finance";
export const canViewPayroll = (r: Role) => sensitiveFinanceRead(r) || r === "instructor";
export const canViewLedger = (r: Role) => sensitiveFinanceRead(r) || r === "student";

export function capabilities(m: Member) {
  return {
    role: m.role,
    branchId: m.branchId,
    pages: PAGES[m.role],
    writableKinds: WRITABLE[m.role],
    canManageTeam: m.role === "super_admin",
    canViewPayroll: canViewPayroll(m.role),
    canViewLedger: canViewLedger(m.role),
  };
}

const ids = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is number => Number.isInteger(x)) : []);

/** Server-side row filter: every read endpoint must derive its data from this result only. */
export function visibleRows(m: Member, all: EducationRow[]): EducationRow[] {
  if (m.role === "super_admin") return all;
  const inBranch = (r: EducationRow) => m.branchId == null ? m.role === "finance" : r.branchId === m.branchId;
  const ownBranchRow = (r: EducationRow) => r.kind === "branch" && (m.branchId == null ? m.role === "finance" : r.id === m.branchId);
  let rows: EducationRow[];
  switch (m.role) {
    case "branch_manager":
      rows = all.filter(r => inBranch(r) || ownBranchRow(r) || CATALOG_KINDS.includes(r.kind)); break;
    case "finance":
      rows = all.filter(r => ownBranchRow(r) || CATALOG_KINDS.includes(r.kind) || (inBranch(r) && (["student", "instructor", "session"].includes(r.kind) || FINANCE_KINDS.includes(r.kind)))); break;
    case "coordinator":
      rows = all.filter(r => ownBranchRow(r) || CATALOG_KINDS.includes(r.kind) || (inBranch(r) && !FINANCE_KINDS.includes(r.kind))); break;
    case "instructor": {
      const me = m.linkedRecordId;
      const sessions = all.filter(r => r.kind === "session" && me != null && r.details.instructorId === me && inBranch(r));
      const sessionIds = new Set(sessions.map(s => s.id));
      const studentIds = new Set(sessions.flatMap(s => ids(s.details.studentIds)));
      const roomIds = new Set(sessions.map(s => s.details.roomId));
      rows = all.filter(r =>
        ownBranchRow(r) || CATALOG_KINDS.includes(r.kind) || sessionIds.has(r.id) ||
        (r.kind === "instructor" && r.id === me && inBranch(r)) ||
        (r.kind === "student" && studentIds.has(r.id)) || (r.kind === "room" && roomIds.has(r.id)) ||
        (r.kind === "attendance" && sessionIds.has(r.details.sessionId as number)) ||
        (r.kind === "grade" && studentIds.has(r.details.studentId as number) && inBranch(r)));
      break;
    }
    case "student": {
      const me = m.linkedRecordId;
      const self = all.find(r => r.kind === "student" && r.id === me && inBranch(r));
      if (!self) return [];
      const sessions = all.filter(r => r.kind === "session" && inBranch(r) && ids(r.details.studentIds).includes(self.id));
      const instructorIds = new Set(sessions.map(s => s.details.instructorId));
      const roomIds = new Set(sessions.map(s => s.details.roomId));
      const diploma = self.details.diplomaId;
      rows = all.filter(r =>
        ownBranchRow(r) || r.id === self.id || sessions.some(s => s.id === r.id) ||
        (r.kind === "instructor" && instructorIds.has(r.id)) || (r.kind === "room" && roomIds.has(r.id)) ||
        (r.kind === "diploma" && r.id === diploma) || (["level", "subject"].includes(r.kind) && r.details.diplomaId === diploma) ||
        (["installment", "payment", "attendance", "grade"].includes(r.kind) && r.details.studentId === self.id));
      break;
    }
    default: rows = [];
  }
  return rows.map(r => redact(m, r));
}

/** Strip pay rates and budgets from roles that must not see them. */
function redact(m: Member, r: EducationRow): EducationRow {
  if (sensitiveFinanceRead(m.role)) return r;
  if (r.kind === "branch") { const { budget: _b, ...rest } = r.details; return { ...r, details: rest }; }
  if (r.kind === "instructor" && !(m.role === "instructor" && r.id === m.linkedRecordId)) { const { hourlyRate: _h, ...rest } = r.details; return { ...r, details: rest }; }
  if (r.kind === "student" && m.role === "instructor") { const { fees: _f, ...rest } = r.details; return { ...r, details: rest }; }
  return r;
}

/**
 * Throws 403 unless the member may create/modify/delete this record. `all` is the full organization set
 * (never the redacted view) so ownership checks cannot be spoofed by client-supplied ids.
 */
export function assertCanWrite(m: Member, kind: string, branchId: number | null, details: Record<string, unknown>, all: EducationRow[]) {
  const deny = (msg = "ليست لديك صلاحية لهذه العملية") => { throw new DomainError(msg, 403); };
  if (!WRITABLE[m.role].includes(kind)) deny();
  if (m.role === "super_admin") return;
  if (GLOBAL_KINDS.includes(kind)) deny();
  if (m.branchId == null ? m.role !== "finance" : branchId !== m.branchId) deny("هذا الفرع خارج نطاق صلاحياتك");
  if (m.role === "instructor") {
    const mine = (sessionId: unknown) => all.some(r => r.kind === "session" && r.id === sessionId && r.details.instructorId === m.linkedRecordId && r.branchId === m.branchId);
    if (kind === "attendance" && !mine(details.sessionId)) deny("الحصة ليست من حصصك");
    if (kind === "grade" && !all.some(r => r.kind === "session" && r.details.instructorId === m.linkedRecordId && r.branchId === m.branchId && ids(r.details.studentIds).includes(details.studentId as number))) deny("الطالب ليس ضمن حصصك");
  }
}

export function assertCanWriteExisting(m: Member, existing: EducationRow, all: EducationRow[]) {
  assertCanWrite(m, existing.kind, existing.branchId, existing.details, all);
}

export function summaryFor<T extends { branchSummaries: { budget: number; spent: number; usage: number; alert: string; collected: number }[] }>(m: Member, s: T): T {
  if (sensitiveFinanceRead(m.role)) return s;
  return { ...s, branchSummaries: s.branchSummaries.map(b => ({ ...b, budget: 0, spent: 0, collected: 0, usage: 0, alert: "غير متاح لدورك" })) };
}
