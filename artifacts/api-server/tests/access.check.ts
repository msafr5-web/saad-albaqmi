import assert from "node:assert/strict";
import { eq, like } from "drizzle-orm";
import { db, orgMembers, pool } from "@workspace/db";
import { resolveMember } from "../src/lib/org-membership";
import { assertCanWrite, visibleRows, type Member } from "../src/lib/education-access";
import type { EducationRow } from "../src/lib/education-demo";

const T = "t1check-";
const E = (n: string) => `${T}${n}@example.test`;
process.env.ORG_OWNER_EMAIL = E("owner");
const lookup = (map: Record<string, string[]>) => async (id: string) => map[id] ?? [];

async function main() {
  await db.delete(orgMembers).where(like(orgMembers.email, `${T}%`));
  // Bootstrap: random sign-ups get nothing; owner's verified email gets super_admin exactly once.
  assert.equal(await resolveMember("u_rand", lookup({ u_rand: [E("rand")] })), null);
  assert.equal(await resolveMember("u_unverified", lookup({ u_unverified: [] })), null);
  const owner = await resolveMember("u_owner", lookup({ u_owner: [E("owner").toUpperCase().toLowerCase()] }));
  assert.equal(owner?.role, "super_admin");
  assert.equal((await resolveMember("u_owner", lookup({})))?.role, "super_admin");
  assert.equal(await resolveMember("u_impostor", lookup({ u_impostor: [E("owner")] })), null, "second user with owner email must not become admin");
  // Revoked owner is not silently restored.
  await db.update(orgMembers).set({ status: "revoked" }).where(eq(orgMembers.email, E("owner")));
  assert.equal(await resolveMember("u_owner", lookup({ u_owner: [E("owner")] })), null);
  // Invitation claimed once, by matching verified email only.
  await db.insert(orgMembers).values({ email: E("coord"), role: "coordinator", branchId: 2, status: "invited" });
  assert.equal(await resolveMember("u_x", lookup({ u_x: [E("other")] })), null);
  const c = await resolveMember("u_c", lookup({ u_c: [E("coord")] }));
  assert.deepEqual([c?.role, c?.branchId], ["coordinator", 2]);
  assert.equal(await resolveMember("u_c2", lookup({ u_c2: [E("coord")] })), null, "invite cannot be claimed twice");
  await db.delete(orgMembers).where(like(orgMembers.email, `${T}%`));

  // Scoping
  const r = (id: number, kind: string, branchId: number | null, details: Record<string, unknown> = {}): EducationRow => ({ id, kind, name: `${kind}${id}`, branchId, status: "active", details, createdAt: "2026-01-01T00:00:00Z" });
  const all = [
    r(1, "branch", null, { budget: 100 }), r(2, "branch", null, { budget: 200 }),
    r(10, "diploma", null), r(11, "level", null, { diplomaId: 10 }),
    r(20, "room", 1), r(21, "room", 2),
    r(30, "student", 1, { diplomaId: 10, fees: 100 }), r(31, "student", 1, { diplomaId: 10, fees: 50 }), r(32, "student", 2, { diplomaId: 10, fees: 70 }),
    r(40, "instructor", 1, { hourlyRate: 90 }), r(41, "instructor", 1, { hourlyRate: 80 }), r(42, "instructor", 2, { hourlyRate: 70 }),
    r(50, "session", 1, { roomId: 20, instructorId: 40, studentIds: [30], diplomaId: 10, date: "2026-02-02" }),
    r(51, "session", 1, { roomId: 20, instructorId: 41, studentIds: [31], diplomaId: 10, date: "2026-02-03" }),
    r(52, "session", 2, { roomId: 21, instructorId: 42, studentIds: [32], diplomaId: 10, date: "2026-02-02" }),
    r(60, "payment", 1, { studentId: 30, amount: 10 }), r(61, "payment", 1, { studentId: 31, amount: 5 }), r(62, "payment", 2, { studentId: 32, amount: 7 }),
    r(63, "expense", 1, { amount: 5 }), r(64, "expense", 2, { amount: 9 }),
    r(70, "grade", 1, { studentId: 30 }), r(71, "grade", 1, { studentId: 31 }),
  ];
  const mk = (role: Member["role"], branchId: number | null, linkedRecordId: number | null = null): Member => ({ id: 1, clerkUserId: "u", email: "e", role, branchId, linkedRecordId });
  const ids = (m: Member) => visibleRows(m, all).map(x => x.id);
  const none = (m: Member, bad: number[]) => assert.deepEqual(ids(m).filter(i => bad.includes(i)), [], `${m.role} leaked`);

  assert.equal(ids(mk("super_admin", null)).length, all.length);
  const bm = mk("branch_manager", 1);
  none(bm, [2, 21, 32, 42, 52, 62, 64]); assert.ok(ids(bm).includes(63) && ids(bm).includes(1));
  const co = mk("coordinator", 1);
  none(co, [2, 21, 32, 42, 52, 60, 61, 62, 63, 64]);
  assert.equal(visibleRows(co, all).find(x => x.id === 40)!.details.hourlyRate, undefined);
  assert.equal(visibleRows(co, all).find(x => x.id === 1)!.details.budget, undefined);
  const fin = mk("finance", 1);
  none(fin, [2, 21, 32, 62, 64, 20, 70]); assert.ok(ids(fin).includes(60));
  assert.ok(ids(mk("finance", null)).includes(64) && ids(mk("finance", null)).includes(62));
  const ins = mk("instructor", 1, 40);
  assert.deepEqual(ids(ins).filter(i => i >= 20 && i < 100).sort((a, b) => a - b), [20, 30, 40, 50, 70]);
  assert.equal(visibleRows(ins, all).find(x => x.id === 30)!.details.fees, undefined, "instructor must not see fees");
  const stu = mk("student", 1, 30);
  assert.deepEqual(ids(stu).filter(i => i >= 20 && i < 100).sort((a, b) => a - b), [20, 30, 40, 50, 60, 70]);
  assert.equal(visibleRows(stu, all).find(x => x.id === 40)!.details.hourlyRate, undefined);
  assert.deepEqual(visibleRows(mk("student", 1, 32), all), [], "student linked to another branch's record sees nothing");

  const code = (fn: () => void) => { try { fn(); return 200; } catch (e: any) { return e.status; } };
  assert.equal(code(() => assertCanWrite(bm, "room", 1, {}, all)), 200);
  assert.equal(code(() => assertCanWrite(bm, "room", 2, {}, all)), 403);
  assert.equal(code(() => assertCanWrite(bm, "branch", null, {}, all)), 403);
  assert.equal(code(() => assertCanWrite(bm, "diploma", null, {}, all)), 403);
  assert.equal(code(() => assertCanWrite(co, "payment", 1, {}, all)), 403);
  assert.equal(code(() => assertCanWrite(fin, "expense", 1, {}, all)), 200);
  assert.equal(code(() => assertCanWrite(fin, "expense", 2, {}, all)), 403);
  assert.equal(code(() => assertCanWrite(fin, "room", 1, {}, all)), 403);
  assert.equal(code(() => assertCanWrite(mk("finance", null), "expense", 2, {}, all)), 200);
  assert.equal(code(() => assertCanWrite(ins, "grade", 1, { studentId: 30 }, all)), 200);
  assert.equal(code(() => assertCanWrite(ins, "grade", 1, { studentId: 31 }, all)), 403);
  assert.equal(code(() => assertCanWrite(ins, "attendance", 1, { sessionId: 50 }, all)), 200);
  assert.equal(code(() => assertCanWrite(ins, "attendance", 1, { sessionId: 51 }, all)), 403);
  assert.equal(code(() => assertCanWrite(ins, "student", 1, {}, all)), 403);
  assert.equal(code(() => assertCanWrite(stu, "grade", 1, { studentId: 30 }, all)), 403);
  assert.equal(code(() => assertCanWrite(mk("super_admin", null), "branch", null, {}, all)), 200);
  console.log("access checks passed");
}
main().then(() => pool.end()).catch(e => { console.error(e); process.exit(1); });
