import { Router, type IRouter, type Request } from "express";
import { getAuth } from "@clerk/express";
import { and, eq, sql } from "drizzle-orm";
import { db, educationRecords, educationAudit } from "@workspace/db";
import { CreateRecordBody, UpdateRecordBody, UpdateRecordParams, DeleteRecordParams, ListRecordsResponse, GetSummaryResponse, GetWorkspaceResponse, CreateRecordResponse, UpdateRecordResponse } from "@workspace/api-zod";
import { demoRecords, summarize, type EducationRow } from "../lib/education-demo";
import { DomainError, ensureDeletable, validateRecord } from "../lib/education-validation";

const router: IRouter = Router();
const owner = (req: Request) => getAuth(req).userId;
const serialize = (rows: (typeof educationRecords.$inferSelect)[]): EducationRow[] => rows.map(r => ({
  id: r.id, kind: r.kind, name: r.name, branchId: r.branchId, status: r.status,
  details: r.details, createdAt: r.createdAt.toISOString(),
}));
async function records(req: Request) {
  const id = owner(req);
  return id ? serialize(await db.select().from(educationRecords).where(eq(educationRecords.ownerId,id))) : demoRecords;
}
router.use(["/workspace","/records","/summary"], (req,res,next) => {
  res.set("Cache-Control","private, no-store");
  if (!["GET","HEAD","OPTIONS"].includes(req.method)) {
    const source = req.get("origin");
    const host = req.get("x-forwarded-host")?.split(",")[0]?.trim() || req.get("host");
    if (!source || new URL(source).host !== host) { res.status(403).json({error:"مصدر الطلب غير مسموح"}); return; }
    if (!owner(req)) { res.status(401).json({error:"سجّل الدخول لحفظ البيانات في مساحة العمل الخاصة"}); return; }
  }
  next();
});
router.get("/workspace", (req,res) => {
  const authenticated = !!owner(req);
  res.json(GetWorkspaceResponse.parse({ mode: authenticated ? "personal":"demo", canWrite:authenticated, label: authenticated ? "مساحة عمل خاصة — إدارة مشتركة وصلاحيات الفريق غير مفعلة" : "عرض توضيحي — جميع البيانات افتراضية" }));
});
router.get("/records", async(req,res): Promise<void> => { res.json(ListRecordsResponse.parse(await records(req))); });
router.get("/summary", async(req,res): Promise<void> => { res.json(GetSummaryResponse.parse(summarize(await records(req)))); });

router.post("/records", async(req,res): Promise<void> => {
  const parsed = CreateRecordBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({error:"تحقق من الحقول المطلوبة"}); return; }
  const ownerId = owner(req)!;
  const created = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ownerId}))`);
    const existing = serialize(await tx.select().from(educationRecords).where(eq(educationRecords.ownerId,ownerId)));
    validateRecord({...parsed.data,branchId:parsed.data.branchId ?? null}, existing);
    const [result] = await tx.insert(educationRecords).values({...parsed.data,name:parsed.data.name.trim(),ownerId}).returning();
    await tx.insert(educationAudit).values({ownerId,action:"create",recordId:result!.id});
    return serialize([result!])[0];
  });
  res.status(201).json(CreateRecordResponse.parse(created));
});
router.patch("/records/:id", async(req,res): Promise<void> => {
  const params = UpdateRecordParams.safeParse(req.params);
  const parsed = UpdateRecordBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({error:"بيانات السجل غير صحيحة"}); return; }
  const ownerId = owner(req)!;
  const updated = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ownerId}))`);
    const all = serialize(await tx.select().from(educationRecords).where(eq(educationRecords.ownerId,ownerId)));
    if (!all.some(r=>r.id === params.data.id)) throw new DomainError("السجل غير موجود",404);
    validateRecord({...parsed.data,branchId:parsed.data.branchId ?? null},all,params.data.id);
    // Revalidate dependents to prevent room capacity / student diploma edits invalidating sessions.
    const candidate = all.map(r => r.id === params.data.id ? {...r,...parsed.data,branchId:parsed.data.branchId ?? null} : r);
    for (const r of candidate.filter(r=>r.kind === "session")) validateRecord(r,candidate,r.id);
    const [result] = await tx.update(educationRecords).set({...parsed.data,name:parsed.data.name.trim()}).where(and(eq(educationRecords.id,params.data.id),eq(educationRecords.ownerId,ownerId))).returning();
    await tx.insert(educationAudit).values({ownerId,action:"update",recordId:params.data.id});
    return serialize([result!])[0];
  });
  res.json(UpdateRecordResponse.parse(updated));
});
router.delete("/records/:id", async(req,res): Promise<void> => {
  const params = DeleteRecordParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({error:"معرف غير صحيح"}); return; }
  const ownerId = owner(req)!;
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ownerId}))`);
    const all = serialize(await tx.select().from(educationRecords).where(eq(educationRecords.ownerId,ownerId)));
    if (!all.some(r=>r.id === params.data.id)) throw new DomainError("السجل غير موجود",404);
    ensureDeletable(params.data.id,all);
    await tx.delete(educationRecords).where(and(eq(educationRecords.id,params.data.id),eq(educationRecords.ownerId,ownerId)));
    await tx.insert(educationAudit).values({ownerId,action:"delete",recordId:params.data.id});
  });
  res.status(204).end();
});
export default router;
