import { Router, type IRouter, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, educationRecords, educationAudit, ORG_OWNER_ID } from "@workspace/db";
import { CreateRecordBody, UpdateRecordBody, UpdateRecordParams, DeleteRecordParams, ListRecordsResponse, GetSummaryResponse, GetWorkspaceResponse, GetPayrollQueryParams, GetPayrollResponse, GetLedgerResponse, CreateRecordResponse, UpdateRecordResponse } from "@workspace/api-zod";
import { demoRecords, summarize, type EducationRow } from "../lib/education-demo";
import { computeLedger, computePayroll } from "../lib/education-finance";
import { DomainError, ensureDeletable, validateRecord } from "../lib/education-validation";
import { assertCanWrite, assertCanWriteExisting, canViewLedger, canViewPayroll, capabilities, summaryFor, visibleRows } from "../lib/education-access";
import { accessOf, workspaceAccess } from "../middlewares/workspaceAccess";

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
const forbid = (res: Response, msg = "ليست لديك صلاحية لهذه البيانات") => { res.status(403).json({ error: msg }); };

router.use(["/workspace","/records","/summary","/payroll","/ledger"], workspaceAccess);
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
    const input = {...parsed.data,branchId:parsed.data.branchId ?? null};
    if (a.kind === "org") assertCanWrite(a.member, input.kind, input.branchId, input.details, all);
    validateRecord(input, all);
    const [result] = await tx.insert(educationRecords).values({...parsed.data,name:parsed.data.name.trim(),ownerId:key}).returning();
    await tx.insert(educationAudit).values({ownerId:key,actorId:actor(res),action:"create",recordId:result!.id});
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
    // Revalidate dependents to prevent room capacity / student diploma edits invalidating sessions.
    const candidate = all.map(r => r.id === params.data.id ? {...r,...parsed.data,branchId:parsed.data.branchId ?? null} : r);
    for (const r of candidate.filter(r=>["session","student","installment","payment","subject","level"].includes(r.kind))) validateRecord(r,candidate,r.id);
    const [result] = await tx.update(educationRecords).set({...parsed.data,name:parsed.data.name.trim()}).where(and(eq(educationRecords.id,params.data.id),eq(educationRecords.ownerId,key))).returning();
    await tx.insert(educationAudit).values({ownerId:key,actorId:actor(res),action:"update",recordId:params.data.id});
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
    await tx.delete(educationRecords).where(and(eq(educationRecords.id,params.data.id),eq(educationRecords.ownerId,key)));
    await tx.insert(educationAudit).values({ownerId:key,actorId:actor(res),action:"delete",recordId:params.data.id});
  });
  res.status(204).end();
});
export default router;
