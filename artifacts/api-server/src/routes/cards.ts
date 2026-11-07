import { Router, type IRouter, type Request, type Response } from "express";
import { accessOf, workspaceAccess } from "../middlewares/workspaceAccess";
import { clientIp, rateLimit } from "../middlewares/security";
import { DomainError } from "../lib/education-validation";
import { gateScan, issuePhysicalCard, listHolders, myCard, myPresence, mySessions, revokeCard, roomCheckIn, roomPayload, studentScan, todayPresence } from "../lib/cards";
import { db, rooms } from "@workspace/db";
import { eq } from "drizzle-orm";
import { syncOrganization } from "../lib/legacy-sync";

const router: IRouter = Router();
router.use(["/cards", "/presence"], workspaceAccess, rateLimit({ name: "cards", windowMs: 60_000, max: 120 }), (_req, res, next) => {
  if (accessOf(res).kind !== "org") { res.status(403).json({ error: "البطاقة لأعضاء المعهد فقط" }); return; }
  next();
});
const member = (res: Response) => { const a = accessOf(res); if (a.kind !== "org") throw new DomainError("غير مصرح", 403); return a.member; };
const id = (req: Request) => { const n = Number(req.params.id); if (!Number.isInteger(n) || n <= 0) throw new DomainError("معرف غير صحيح"); return n; };

router.get("/cards/mine", async (_req, res) => { res.json(await myCard(member(res))); });
router.get("/cards/mine/presence", async (_req, res) => { res.json(await myPresence(member(res))); });
router.get("/cards/holders", async (req, res) => { res.json(await listHolders(member(res), String(req.query.type) as "student")); });
router.post("/cards/issue", async (req, res) => { res.status(201).json(await issuePhysicalCard(member(res), req.body ?? {})); });
router.post("/cards/:id/revoke", async (req, res) => { res.json(await revokeCard(member(res), id(req), (req.body ?? {}).reason, (req.body ?? {}).lost ? "lost" : "revoked")); });
/** Signed room tags: print the QR or write the text to an NFC tag mounted at the room door. */
router.get("/cards/room-tags", async (_req, res) => {
  const m = member(res);
  if (!["super_admin", "branch_manager", "hr_officer"].includes(m.role)) throw new DomainError("ليست لديك صلاحية", 403);
  await syncOrganization();
  const rs = await db.select({ id: rooms.id, name: rooms.name, branchId: rooms.branchId }).from(rooms).where(eq(rooms.status, "active"));
  res.json(rs.filter((r) => m.role === "super_admin" || m.branchId == null || m.branchId === r.branchId).map((r) => ({ ...r, token: roomPayload(r.id) })));
});

const ip = (req: Request) => clientIp(req);
router.post("/presence/gate", async (req, res) => { res.json(await gateScan(member(res), req.body ?? {}, ip(req))); });
router.post("/presence/student", async (req, res) => { res.json(await studentScan(member(res), req.body ?? {}, ip(req))); });
router.post("/presence/room", async (req, res) => { res.json(await roomCheckIn(member(res), req.body ?? {}, ip(req))); });
router.get("/presence/sessions", async (_req, res) => { res.json(await mySessions(member(res))); });
router.get("/presence/today", async (req, res) => { res.json(await todayPresence(member(res), req.query.branchId)); });

export default router;
