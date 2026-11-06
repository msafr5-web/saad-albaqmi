import { Router, type IRouter, type Response } from "express";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { db, educationRecords, educationAudit, orgMembers, ORG_OWNER_ID } from "@workspace/db";
import { InviteMemberBody, UpdateMemberBody, UpdateMemberParams, ListTeamResponse, ListAuditResponse, InviteMemberResponse, UpdateMemberResponse } from "@workspace/api-zod";
import { needsBranch, needsLink, ROLES, type Role } from "../lib/education-access";
import { DomainError } from "../lib/education-validation";
import { sendInviteEmail } from "../lib/invite-mail";
import { accessOf, workspaceAccess } from "../middlewares/workspaceAccess";

const router: IRouter = Router();
const present = (r: typeof orgMembers.$inferSelect) => ({
  id: r.id, email: r.email, role: r.role as Role, branchId: r.branchId, linkedRecordId: r.linkedRecordId,
  status: r.status, createdAt: r.createdAt.toISOString(), activatedAt: r.activatedAt?.toISOString() ?? null,
});

/** Team management is limited to active top-level administrators of the shared organization. */
router.use("/team", workspaceAccess, (_req, res, next) => {
  const a = accessOf(res);
  if (a.kind !== "org" || a.member.role !== "super_admin") { res.status(403).json({ error: "إدارة الفريق متاحة للإدارة العليا فقط" }); return; }
  next();
});

type Scope = { role: Role; branchId: number | null; linkedRecordId: number | null };
async function validateScope(s: Scope, selfId?: number) {
  const records = await db.select().from(educationRecords).where(eq(educationRecords.ownerId, ORG_OWNER_ID));
  if (!ROLES.includes(s.role)) throw new DomainError("دور غير صحيح");
  if (s.role === "super_admin" && (s.branchId != null || s.linkedRecordId != null)) throw new DomainError("الإدارة العليا تشمل كل الفروع ولا تُربط بفرع");
  if (s.branchId != null && !records.some(r => r.id === s.branchId && r.kind === "branch")) throw new DomainError("الفرع غير موجود في المؤسسة");
  if (needsBranch(s.role) && s.branchId == null) throw new DomainError("حدد الفرع لهذا الدور");
  if (needsLink(s.role)) {
    const kind = s.role === "student" ? "student" : "instructor";
    const target = records.find(r => r.id === s.linkedRecordId && r.kind === kind && r.branchId === s.branchId);
    if (!target) throw new DomainError(s.role === "student" ? "اربط الحساب بسجل طالب في الفرع نفسه" : "اربط الحساب بسجل مدرب في الفرع نفسه");
    const taken = await db.select().from(orgMembers).where(and(eq(orgMembers.linkedRecordId, target.id), ne(orgMembers.status, "revoked")));
    if (taken.some(t => t.id !== selfId)) throw new DomainError("هذا السجل مرتبط بحساب آخر", 409);
  } else if (s.linkedRecordId != null) throw new DomainError("هذا الدور لا يُربط بسجل");
}

router.get("/team", async (_req, res: Response) => {
  const rows = await db.select().from(orgMembers).orderBy(asc(orgMembers.id));
  res.json(ListTeamResponse.parse(rows.map(present)));
});

router.get("/team/audit", async (_req, res: Response) => {
  const rows = await db.select({ id: educationAudit.id, action: educationAudit.action, recordId: educationAudit.recordId, actorId: educationAudit.actorId, createdAt: educationAudit.createdAt, actorEmail: orgMembers.email })
    .from(educationAudit).leftJoin(orgMembers, eq(orgMembers.clerkUserId, educationAudit.actorId))
    .where(eq(educationAudit.ownerId, ORG_OWNER_ID)).orderBy(desc(educationAudit.id)).limit(200);
  res.json(ListAuditResponse.parse(rows.map(r => ({ ...r, actorEmail: r.actorEmail ?? null, createdAt: r.createdAt.toISOString() }))));
});

router.post("/team/invitations", async (req, res: Response) => {
  const parsed = InviteMemberBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "تحقق من البريد والدور" }); return; }
  const email = parsed.data.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { res.status(400).json({ error: "البريد الإلكتروني غير صحيح" }); return; }
  const scope: Scope = { role: parsed.data.role, branchId: parsed.data.branchId ?? null, linkedRecordId: parsed.data.linkedRecordId ?? null };
  const a = accessOf(res);
  const created = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('org-team'))`);
    await validateScope(scope);
    const [dup] = await tx.select().from(orgMembers).where(and(sql`lower(${orgMembers.email}) = ${email}`, ne(orgMembers.status, "revoked")));
    if (dup) throw new DomainError("يوجد عضو أو دعوة قائمة بهذا البريد", 409);
    const [row] = await tx.insert(orgMembers).values({ email, ...scope, status: "invited", invitedBy: a.kind === "org" ? a.userId : null }).returning();
    await tx.insert(educationAudit).values({ ownerId: ORG_OWNER_ID, actorId: a.kind === "org" ? a.userId : null, action: `invite:${email}:${scope.role}`, recordId: row!.id });
    return row!;
  });
  const mail = await sendInviteEmail(created.email, created.role as Role);
  res.status(201).json(InviteMemberResponse.parse({ ...present(created), emailSent: mail.sent, emailError: mail.sent ? null : mail.error }));
});

router.patch("/team/:id", async (req, res: Response) => {
  const params = UpdateMemberParams.safeParse(req.params);
  const parsed = UpdateMemberBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ error: "بيانات العضو غير صحيحة" }); return; }
  const updated = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('org-team'))`);
    const [current] = await tx.select().from(orgMembers).where(eq(orgMembers.id, params.data.id));
    if (!current || current.status === "revoked") throw new DomainError("العضو غير موجود", 404);
    const revoke = parsed.data.status === "revoked";
    const next: Scope = revoke ? { role: current.role as Role, branchId: current.branchId, linkedRecordId: current.linkedRecordId } : {
      role: parsed.data.role ?? (current.role as Role),
      branchId: parsed.data.branchId === undefined ? current.branchId : parsed.data.branchId,
      linkedRecordId: parsed.data.linkedRecordId === undefined ? current.linkedRecordId : parsed.data.linkedRecordId,
    };
    if (!revoke) await validateScope(next, current.id);
    if (current.role === "super_admin" && current.status === "active" && (revoke || next.role !== "super_admin")) {
      const [{ n }] = (await tx.execute(sql`SELECT count(*)::int AS n FROM org_members WHERE role='super_admin' AND status='active' AND id <> ${current.id}`)).rows as { n: number }[];
      if (n === 0) throw new DomainError("لا يمكن إزالة آخر مدير للإدارة العليا", 409);
    }
    const [row] = await tx.update(orgMembers).set(revoke ? { status: "revoked", revokedAt: new Date() } : next).where(eq(orgMembers.id, current.id)).returning();
    return row!;
  });
  res.json(UpdateMemberResponse.parse(present(updated)));
});

export default router;
