import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, educationRecords, educationAudit, costPolicies, ORG_OWNER_ID } from "@workspace/db";
import { CreateRecordBody, UpdateRecordBody, UpdateRecordParams, DeleteRecordParams, ListRecordsResponse, GetSummaryResponse, GetWorkspaceResponse, GetPayrollQueryParams, GetCostPolicyResponse, SaveCostPolicyDraftBody, SaveCostPolicyDraftResponse, ApproveCostPolicyBody, ApproveCostPolicyResponse, GetCostReportQueryParams, GetCostReportResponse, GetPayrollResponse, GetLedgerResponse, CreateRecordResponse, UpdateRecordResponse } from "@workspace/api-zod";
import { demoRecords, summarize, type EducationRow } from "../lib/education-demo";
import { computeLedger, computePayroll } from "../lib/education-finance";
import { computeCostReport, validatePolicy, type CostPolicy } from "../lib/education-costing";
import { DomainError, ensureDeletable, validateRecord } from "../lib/education-validation";
import { assertCanWrite, assertCanWriteExisting, canViewLedger, canViewPayroll, capabilities, summaryFor, visibleRows } from "../lib/education-access";
import { accessOf, workspaceAccess } from "../middlewares/workspaceAccess";
import { consumeChallenge, otpEnabled } from "../lib/otp";
import { recordAudit } from "../lib/audit";

const router: IRouter = Router();
const serialize = (rows: (typeof educationRecords.$inferSelect)[]): EducationRow[] => rows.map(r => ({
  id: r.id, kind: r.kind, name: r.name, branchId: r.branchId, status: r.status,
  details: r.details, createdAt: r.createdAt.toISOString(),
}));
const ownerKey = (res: Response) => { const a = accessOf(res); return a.kind === "org" ? ORG_OWNER_ID : a.kind === "personal" ? a.userId : null; };
async function records(res: Response) {
  const a = accessOf(res);
  if (a.kind === "demo") return demoRecords;
  const all = serialize(await db.select().from(educationRecords).where(eq(educationRecords.ownerId, ownerKey(res)!)));
  return a.kind === "org" ? visibleRows(a.member, all) : all;
}
/** Money records (revenue and expense) need an OTP confirmation from the executor when OTP_FINANCE_REQUIRED=true. */
const OTP_KINDS = ["payment", "expense", "invoice", "installment"];
const PERSONAL_RECORD_LIMIT = Number(process.env.PERSONAL_RECORD_LIMIT ?? 2000);
const needsOtp = (a: ReturnType<typeof accessOf>, kind: string) => a.kind === "org" && otpEnabled() && OTP_KINDS.includes(kind);
const otpChallengeOf = (req: Request) => req.get("x-otp-challenge") ?? undefined;
const evidence = (o: NonNullable<Awaited<ReturnType<typeof consumeChallenge>>>) => ({ challengeId: o.challengeId, sentAt: o.sentAt, verifiedAt: o.verifiedAt, sentIp: o.sentIp, verifiedIp: o.verifiedIp });
const forbid = (res: Response, msg = "ليست لديك صلاحية لهذه البيانات") => { res.status(403).json({ error: msg }); };

router.use(["/workspace","/records","/summary","/payroll","/ledger","/cost-policy","/cost-report"], workspaceAccess);
router.get("/workspace", (_req,res) => {
  const a = accessOf(res);
  const base = { pages: [] as string[], writableKinds: [] as string[], canManageTeam: false, canViewPayroll: true, canViewLedger: true, role: null as string | null, branchId: null as number | null };
  if (a.kind === "demo") { res.json(GetWorkspaceResponse.parse({ ...base, mode: "demo", canWrite: false, label: "عرض توضيحي — جميع البيانات افتراضية" })); return; }
  if (a.kind === "personal") { res.json(GetWorkspaceResponse.parse({ ...base, mode: "personal", canWrite: true, label: "مساحة عمل خاصة — لا تُشارك مع أي حساب آخر" })); return; }
  const c = capabilities(a.member);
  res.json(GetWorkspaceResponse.parse({ ...c, mode: "organization", canWrite: c.writableKinds.length > 0, label: "مساحة المعهد المشتركة" }));
});
router.get("/records", async(_req,res): Promise<void> => { res.json(ListRecordsResponse.parse(await records(res))); });
router.get("/summary", async(_req,res): Promise<void> => {
  const a = accessOf(res);
  const s = summarize(await records(res));
  res.json(GetSummaryResponse.parse(a.kind === "org" ? summaryFor(a.member, s) : s));
});

router.get("/payroll", async(req,res): Promise<void> => {
  const a = accessOf(res);
  if (a.kind === "org" && !canViewPayroll(a.member.role)) { forbid(res); return; }
  const q = GetPayrollQueryParams.safeParse(req.query);
  const valid = (v?: string) => v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (!q.success || !valid(q.data.from) || !valid(q.data.to)) { res.status(400).json({error:"نطاق التاريخ غير صحيح"}); return; }
  res.json(GetPayrollResponse.parse(computePayroll(await records(res), q.data.from || undefined, q.data.to || undefined)));
});
router.get("/ledger", async(_req,res): Promise<void> => {
  const a = accessOf(res);
  if (a.kind === "org" && !canViewLedger(a.member.role)) { forbid(res); return; }
  res.json(GetLedgerResponse.parse(computeLedger(await records(res))));
});

// ---- Cost policy and cost report -------------------------------------------------
// Viewing needs finance read access; editing the draft needs super_admin or finance; approving needs super_admin.
// Personal workspaces are single-user, so the owner can edit and approve. Demo has no policy at all.
const policyRoles = { view: ["super_admin","branch_manager","finance"], edit: ["super_admin","finance"], approve: ["super_admin"] };
const policyCaps = (res: Response) => {
  const a = accessOf(res);
  if (a.kind === "demo") return { view: true, edit: false, approve: false };
  if (a.kind === "personal") return { view: true, edit: true, approve: true };
  return { view: policyRoles.view.includes(a.member.role), edit: policyRoles.edit.includes(a.member.role), approve: policyRoles.approve.includes(a.member.role) };
};
/** Costs are computed from the whole organization, then scoped: branch-scoped members only get their own branch's data. */
async function costRecords(res: Response) {
  const a = accessOf(res);
  if (a.kind === "demo") return demoRecords;
  const all = serialize(await db.select().from(educationRecords).where(eq(educationRecords.ownerId, ownerKey(res)!)));
  if (a.kind === "org" && a.member.branchId != null) {
    const b = a.member.branchId;
    return all.filter(r => r.kind === "branch" ? r.id === b : r.branchId === b || r.branchId == null);
  }
  return all;
}
type PolicyRow = typeof costPolicies.$inferSelect;
const policyState = (row: PolicyRow | undefined, caps: ReturnType<typeof policyCaps>) => ({
  draft: (row?.draft ?? null) as CostPolicy | null, draftVersion: row?.draftVersion ?? 0,
  approved: (row?.approved ?? null) as CostPolicy | null, approvedVersion: row?.approvedVersion ?? null,
  approvedAt: row?.approvedAt?.toISOString() ?? null, approvedBy: row?.approvedBy ?? null,
  canEdit: caps.edit, canApprove: caps.approve,
  rooms: [] as { id: number; name: string; branchId: number | null }[],
  draftIsApproved: !!row?.approved && row.approvedVersion === row.draftVersion,
});
const policyRow = async (key: string) => (await db.select().from(costPolicies).where(eq(costPolicies.ownerId, key)))[0];

router.get("/cost-policy", async(_req,res): Promise<void> => {
  const caps = policyCaps(res);
  if (!caps.view) { forbid(res); return; }
  const key = ownerKey(res);
  const st = policyState(key ? await policyRow(key) : undefined, caps);
  st.rooms = (await costRecords(res)).filter(r => r.kind === "room").map(r => ({ id: r.id, name: r.name, branchId: r.branchId }));
  res.json(GetCostPolicyResponse.parse(st));
});
router.put("/cost-policy", async(req,res): Promise<void> => {
  const caps = policyCaps(res);
  if (!caps.edit) { forbid(res); return; }
  const parsed = SaveCostPolicyDraftBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({error:"بيانات السياسة غير مكتملة"}); return; }
  const out = await db.transaction(async tx => {
    const { key, all } = await lockedAll(tx, res);
    const draft = validatePolicy(parsed.data, all.filter(r => r.kind === "room"));
    const cur = (await tx.select().from(costPolicies).where(eq(costPolicies.ownerId,key)))[0];
    const version = (cur?.draftVersion ?? 0) + 1;
    const values = { draft: draft as unknown as Record<string, unknown>, draftVersion: version, updatedBy: actor(res), updatedAt: new Date() };
    const [row] = cur
      ? await tx.update(costPolicies).set(values).where(eq(costPolicies.ownerId,key)).returning()
      : await tx.insert(costPolicies).values({ ownerId: key, ...values }).returning();
    await tx.insert(educationAudit).values({ownerId:key,actorId:actor(res),action:`policy_draft_v${version}`,recordId:0});
    return row;
  });
  res.json(SaveCostPolicyDraftResponse.parse(policyState(out, caps)));
});
router.post("/cost-policy/approve", async(req,res): Promise<void> => {
  const caps = policyCaps(res);
  if (!caps.approve) { forbid(res); return; }
  const parsed = ApproveCostPolicyBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({error:"رقم نسخة المسودة مطلوب"}); return; }
  const out = await db.transaction(async tx => {
    const { key, all } = await lockedAll(tx, res);
    const cur = (await tx.select().from(costPolicies).where(eq(costPolicies.ownerId,key)))[0];
    if (!cur?.draft) throw new DomainError("لا توجد مسودة سياسة للاعتماد", 409);
    if (cur.draftVersion !== parsed.data.version) throw new DomainError("تغيرت المسودة؛ حدّث الصفحة وراجعها قبل الاعتماد", 409);
    const approved = validatePolicy(cur.draft, all.filter(r => r.kind === "room"));
    const [row] = await tx.update(costPolicies).set({ approved: approved as unknown as Record<string, unknown>, approvedVersion: cur.draftVersion, approvedBy: actor(res), approvedAt: new Date() }).where(eq(costPolicies.ownerId,key)).returning();
    await tx.insert(educationAudit).values({ownerId:key,actorId:actor(res),action:`policy_approve_v${cur.draftVersion}`,recordId:0});
    return row;
  });
  res.json(ApproveCostPolicyResponse.parse(policyState(out, caps)));
});
router.get("/cost-report", async(req,res): Promise<void> => {
  if (!policyCaps(res).view) { forbid(res); return; }
  const q = GetCostReportQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({error:"نطاق التاريخ غير صحيح"}); return; }
  const key = ownerKey(res);
  const row = key ? await policyRow(key) : undefined;
  const policy = (row?.approved ?? null) as CostPolicy | null;
  if (!policy) {
    res.json(GetCostReportResponse.parse({ status: "no_approved_policy", policyVersion: null, policy: null, period: null, branches: [], diplomas: [], rooms: [], totals: { revenue: 0, totalCost: 0 }, warnings: [] }));
    return;
  }
  const report = computeCostReport(await costRecords(res), policy, q.data.from || undefined, q.data.to || undefined);
  res.json(GetCostReportResponse.parse({ status: "approved", policyVersion: row!.approvedVersion, policy, ...report }));
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function lockedAll(tx: Tx, res: Response) {
  const key = ownerKey(res)!;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
  return { key, all: serialize(await tx.select().from(educationRecords).where(eq(educationRecords.ownerId,key))) };
}
const actor = (res: Response) => { const a = accessOf(res); return a.kind === "demo" ? null : a.userId; };

router.post("/records", async(req,res): Promise<void> => {
  const parsed = CreateRecordBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({error:"تحقق من الحقول المطلوبة"}); return; }
  const a = accessOf(res);
  const created = await db.transaction(async tx => {
    const { key, all } = await lockedAll(tx, res);
    // Registration is open, so one account must not be able to fill the database: cap personal workspaces.
    if (a.kind === "personal" && all.length >= PERSONAL_RECORD_LIMIT) throw new DomainError("بلغت الحد الأقصى لعدد السجلات في المساحة الشخصية", 429);
    const input = {...parsed.data,branchId:parsed.data.branchId ?? null};
    if (a.kind === "org") assertCanWrite(a.member, input.kind, input.branchId, input.details, all);
    validateRecord(input, all);
    const subject = { kind: input.kind, name: input.name.trim(), branchId: input.branchId, status: input.status, details: input.details };
    const otp = a.kind === "org" && needsOtp(a, input.kind) ? await consumeChallenge(tx, { challengeId: otpChallengeOf(req), memberId: a.member.id, action: "record.create", subject }) : null;
    const [result] = await tx.insert(educationRecords).values({...parsed.data,name:parsed.data.name.trim(),ownerId:key}).returning();
    await tx.insert(educationAudit).values({ownerId:key,actorId:actor(res),action:"create",recordId:result!.id});
    if (otp && a.kind === "org") await recordAudit(tx, { actorMemberId: a.member.id, actorRole: a.member.role, branchId: input.branchId, action: "record.create", subjectType: input.kind, subjectId: result!.id, subjectNo: input.name.trim(), after: subject, otp: evidence(otp), userAgent: req.get("user-agent"), contentHash: otp.subjectHash });
    return serialize([result!])[0];
  });
  res.status(201).json(CreateRecordResponse.parse(created));
});
router.patch("/records/:id", async(req,res): Promise<void> => {
  const params = UpdateRecordParams.safeParse(req.params);
  const parsed = UpdateRecordBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({error:"بيانات السجل غير صحيحة"}); return; }
  const a = accessOf(res);
  const updated = await db.transaction(async tx => {
    const { key, all } = await lockedAll(tx, res);
    const current = all.find(r=>r.id === params.data.id);
    // Records outside the caller's scope are reported as missing so ids cannot be probed across branches.
    if (!current || (a.kind === "org" && !visibleRows(a.member, all).some(r => r.id === current.id))) throw new DomainError("السجل غير موجود",404);
    if (a.kind === "org") {
      assertCanWriteExisting(a.member, current, all);
      assertCanWrite(a.member, parsed.data.kind, parsed.data.branchId ?? null, parsed.data.details, all);
    }
    validateRecord({...parsed.data,branchId:parsed.data.branchId ?? null},all,params.data.id);
    const subject = { id: params.data.id, kind: parsed.data.kind, name: parsed.data.name.trim(), branchId: parsed.data.branchId ?? null, status: parsed.data.status, details: parsed.data.details };
    const otp = a.kind === "org" && needsOtp(a, current.kind) ? await consumeChallenge(tx, { challengeId: otpChallengeOf(req), memberId: a.member.id, action: "record.update", subject }) : null;
    // Revalidate dependents to prevent room capacity / student diploma edits invalidating sessions.
    const candidate = all.map(r => r.id === params.data.id ? {...r,...parsed.data,branchId:parsed.data.branchId ?? null} : r);
    for (const r of candidate.filter(r=>["session","student","installment","payment","subject","level"].includes(r.kind))) validateRecord(r,candidate,r.id);
    const [result] = await tx.update(educationRecords).set({...parsed.data,name:parsed.data.name.trim()}).where(and(eq(educationRecords.id,params.data.id),eq(educationRecords.ownerId,key))).returning();
    await tx.insert(educationAudit).values({ownerId:key,actorId:actor(res),action:"update",recordId:params.data.id});
    if (otp && a.kind === "org") await recordAudit(tx, { actorMemberId: a.member.id, actorRole: a.member.role, branchId: current.branchId, action: "record.update", subjectType: current.kind, subjectId: current.id, subjectNo: current.name, before: { name: current.name, status: current.status, details: current.details }, after: subject, otp: evidence(otp), userAgent: req.get("user-agent"), contentHash: otp.subjectHash });
    return serialize([result!])[0];
  });
  res.json(UpdateRecordResponse.parse(updated));
});
router.delete("/records/:id", async(req,res): Promise<void> => {
  const params = DeleteRecordParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({error:"معرف غير صحيح"}); return; }
  const a = accessOf(res);
  await db.transaction(async tx => {
    const { key, all } = await lockedAll(tx, res);
    const current = all.find(r=>r.id === params.data.id);
    if (!current || (a.kind === "org" && !visibleRows(a.member, all).some(r => r.id === current.id))) throw new DomainError("السجل غير موجود",404);
    if (a.kind === "org") assertCanWriteExisting(a.member, current, all);
    ensureDeletable(params.data.id,all);
    const otp = a.kind === "org" && needsOtp(a, current.kind) ? await consumeChallenge(tx, { challengeId: otpChallengeOf(req), memberId: a.member.id, action: "record.delete", subject: { id: current.id } }) : null;
    await tx.delete(educationRecords).where(and(eq(educationRecords.id,params.data.id),eq(educationRecords.ownerId,key)));
    await tx.insert(educationAudit).values({ownerId:key,actorId:actor(res),action:"delete",recordId:params.data.id});
    if (otp && a.kind === "org") await recordAudit(tx, { actorMemberId: a.member.id, actorRole: a.member.role, branchId: current.branchId, action: "record.delete", subjectType: current.kind, subjectId: current.id, subjectNo: current.name, before: { name: current.name, status: current.status, details: current.details }, otp: evidence(otp), userAgent: req.get("user-agent"), contentHash: otp.subjectHash });
  });
  res.status(204).end();
});
export default router;
