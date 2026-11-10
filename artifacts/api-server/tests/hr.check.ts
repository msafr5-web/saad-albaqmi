import assert from "node:assert/strict";
import { db, branches, orgMembers, jobTitles, pool } from "@workspace/db";
import { updateDepartment, createDepartment, createEmployee, createLeave, decideDelegation, decideLeave, listDelegations, listEmployees, listLeave, proposeDelegation, revokeDelegation, updateEmployee, hrCatalogue } from "../src/lib/hr";
import { DomainError } from "../src/lib/education-validation";
import type { Member } from "../src/lib/education-access";

/** HR and delegation integration test on a MIGRATED scratch/CI database (ALLOW_DB_TESTS=1). */
if (process.env.ALLOW_DB_TESTS !== "1") { console.log("skipped: set ALLOW_DB_TESTS=1 (scratch/CI database only)"); process.exit(0); }
delete process.env.OTP_FINANCE_REQUIRED;
const stamp = Date.now();
const fails = async (p: Promise<unknown>, status: number, label: string) => {
  try { await p; } catch (e) { assert.ok(e instanceof DomainError, `${label}: not a DomainError (${(e as Error).message})`); assert.equal(e.status, status, `${label}: expected ${status}, got ${e.status} (${e.message})`); return e as DomainError; }
  assert.fail(`${label}: expected failure ${status}`);
};
const mk = async (n: string, role: string, branchId: number | null): Promise<Member> => {
  const [r] = await db.insert(orgMembers).values({ email: `hr-${n}-${stamp}@example.test`, role, status: "active", branchId, clerkUserId: `u_${n}_${stamp}` }).returning();
  return { id: r!.id, clerkUserId: r!.clerkUserId!, email: r!.email, role: role as Member["role"], branchId, linkedRecordId: null };
};

async function main() {
  const [brA] = await db.insert(branches).values({ code: `HA${stamp}`, name: "فرع أ", city: "الرياض" }).returning();
  const [brB] = await db.insert(branches).values({ code: `HB${stamp}`, name: "فرع ب", city: "جدة" }).returning();
  const hr = await mk("hr", "hr_officer", null), gm = await mk("gm", "super_admin", null), gm2 = await mk("gm2", "super_admin", null), mgrA = await mk("mgrA", "branch_manager", brA!.id), mgrB = await mk("mgrB", "branch_manager", brB!.id);
  const buyer = await mk("buyer", "procurement_officer", null), fin = await mk("fin", "finance", null), keeper = await mk("keeper", "warehouse_keeper", brA!.id);
  const [title] = await db.insert(jobTitles).values({ name: `محاسب ${stamp}` }).returning();

  // departments and employees: HR writes; others cannot; salaries are hidden from branch managers
  await fails(createDepartment(mgrA, { name: "x" }), 403, "manager cannot create departments");
  await fails(hrCatalogue(keeper), 403, "keeper has no HR access");
  const dep = await createDepartment(hr, { name: `الحسابات ${stamp}`, branchId: brA!.id });
  await fails(updateDepartment(mgrA, dep.id, { name: "x", code: "X1" }), 403, "managers cannot rename departments");
  await fails(updateDepartment(hr, 999999999, { name: "x", code: "X1" }), 404, "unknown department");
  const dep2 = await updateDepartment(hr, dep.id, { name: `المالية ${stamp}`, code: dep.code, branchId: brA!.id });
  assert.equal(dep2.name, `المالية ${stamp}`); assert.equal(dep2.id, dep.id);
  const e1 = await createEmployee(hr, { fullName: "سارة", branchId: brA!.id, departmentId: dep.id, jobTitleId: title!.id, hireDate: "2026-01-01", nationalId: `1${String(stamp).slice(-9)}`, iban: "SA0380000000608010167519", basicSalaryHalalas: 900000, housingAllowanceHalalas: 250000, transportAllowanceHalalas: 50000 });
  const e2 = await createEmployee(hr, { fullName: "خالد", branchId: brB!.id, hireDate: "2026-02-01", basicSalaryHalalas: 700000 });
  assert.match(e1.employeeNo, /^EMP-\d{4}$/); assert.equal(Number(e2.employeeNo.slice(-4)), Number(e1.employeeNo.slice(-4)) + 1);
  await fails(createEmployee(hr, { fullName: "مكرر", branchId: brA!.id, hireDate: "2026-02-01", nationalId: e1.nationalId }), 409, "duplicate national id");
  await fails(createEmployee(hr, { fullName: "آيبان", branchId: brA!.id, hireDate: "2026-02-01", iban: "SA123" }), 400, "bad IBAN");
  const asHr = await listEmployees(hr); assert.equal(asHr.find((e) => e.id === e1.id)!.basicSalaryHalalas, 900000);
  const asMgr = await listEmployees(mgrA); const seen = asMgr.find((e) => e.id === e1.id)!;
  assert.equal(seen.basicSalaryHalalas, null, "salary hidden from branch managers"); assert.equal(seen.nationalId, null); assert.ok(!asMgr.some((e) => e.id === e2.id), "other branch not visible");
  assert.equal((await listEmployees(fin)).find((e) => e.id === e1.id)!.basicSalaryHalalas, 900000, "finance sees salaries");
  await updateEmployee(hr, e1.id, { fullName: "سارة", branchId: brA!.id, hireDate: "2026-01-01", basicSalaryHalalas: 950000, status: "active" });
  const audit = (await pool.query("select before_state->>'basic' b, after_state->>'basic' a from audit_events where subject_type='employee' and subject_id=$1 and action='employee.update'", [e1.id])).rows[0];
  assert.deepEqual([audit.b, audit.a], ["900000", "950000"], "salary change audited with the previous value");

  // leave: HR records, manager of that branch decides, never the recorder, overlaps refused
  const [lt] = (await pool.query("select id::int from leave_types where code='ANNUAL'")).rows;
  const l1 = await createLeave(hr, { employeeId: e1.id, leaveTypeId: lt.id, startDate: "2026-12-01", endDate: "2026-12-10" });
  await fails(createLeave(hr, { employeeId: e1.id, leaveTypeId: lt.id, startDate: "2026-12-05", endDate: "2026-12-12" }), 409, "overlapping leave");
  await fails(createLeave(hr, { employeeId: e1.id, leaveTypeId: lt.id, startDate: "2026-12-12", endDate: "2026-12-01" }), 400, "end before start");
  await fails(createLeave(mgrA, { employeeId: e1.id, leaveTypeId: lt.id, startDate: "2027-01-01", endDate: "2027-01-02" }), 403, "managers do not record leave");
  await fails(decideLeave(mgrB, l1.id, true), 403, "other branch manager");
  await fails(decideLeave(hr, l1.id, true), 403, "HR cannot approve");
  assert.equal((await decideLeave(mgrA, l1.id, true)).status, "approved");
  await fails(decideLeave(mgrA, l1.id, true), 404, "already decided");
  assert.ok((await listLeave(mgrA)).some((l) => (l as { id: number }).id === l1.id)); assert.ok(!(await listLeave(mgrB)).some((l) => (l as { id: number }).id === l1.id));

  // delegation: HR proposes, the General Manager approves, windows cannot overlap
  await fails(proposeDelegation(mgrA, { delegatorMemberId: mgrA.id, delegateMemberId: buyer.id, validFrom: "2026-12-01", validTo: "2026-12-10" }), 403, "managers cannot propose");
  await fails(proposeDelegation(hr, { delegatorMemberId: keeper.id, delegateMemberId: buyer.id, validFrom: "2026-12-01", validTo: "2026-12-10" }), 400, "delegator must be a branch manager");
  await fails(proposeDelegation(hr, { delegatorMemberId: mgrA.id, delegateMemberId: buyer.id, validFrom: "2026-12-10", validTo: "2026-12-01" }), 400, "bad dates");
  const d1 = await proposeDelegation(hr, { delegatorMemberId: mgrA.id, delegateMemberId: buyer.id, validFrom: "2026-12-01", validTo: "2026-12-10", leaveRequestId: l1.id });
  await fails(proposeDelegation(hr, { delegatorMemberId: mgrA.id, delegateMemberId: fin.id, validFrom: "2026-12-05", validTo: "2026-12-15" }), 409, "overlapping delegation");
  await fails(decideDelegation(hr, d1.id, true, {}), 403, "HR cannot approve");
  await fails(decideDelegation(mgrA, d1.id, true, {}), 403, "manager cannot approve own delegation");
  assert.equal((await listDelegations(mgrA)).length >= 1, true); assert.ok(!(await listDelegations(mgrB)).some((d) => (d as { id: number }).id === d1.id));
  assert.equal((await decideDelegation(gm, d1.id, true, {})).status, "approved");
  await fails(decideDelegation(gm2, d1.id, true, {}), 404, "already decided");
  const used = (await pool.query("select status from approval_delegations where id=$1", [d1.id])).rows[0]; assert.equal(used.status, "approved");
  assert.equal((await revokeDelegation(gm, d1.id)).status, "revoked");
  await fails(revokeDelegation(gm, d1.id), 404, "cannot revoke twice");

  // a GM-proposed delegation cannot be approved by the same GM (separate people)
  const d2 = await proposeDelegation(gm, { delegatorMemberId: mgrB.id, delegateMemberId: buyer.id, validFrom: "2027-01-01", validTo: "2027-01-05" });
  await fails(decideDelegation(gm, d2.id, true, {}), 403, "proposer cannot approve");
  assert.equal((await decideDelegation(gm2, d2.id, true, {})).status, "approved");

  // the audit chain is intact after all of this
  assert.equal((await pool.query("select * from verify_audit_chain()")).rowCount, 0);
  console.log("hr.check passed");
}
main().then(() => pool.end(), (e) => { console.error(e); pool.end().finally(() => process.exit(1)); });
