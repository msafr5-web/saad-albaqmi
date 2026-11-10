import { Router, type IRouter, type Request, type Response } from "express";
import { accessOf, workspaceAccess } from "../middlewares/workspaceAccess";
import { DomainError } from "../lib/education-validation";
import {
  cancelRequest, canUseRequests, closeRequest, createRequest, listRequests, openRequest, requestDetail, requestsCatalogue, requestsStats, respondToRequest,
} from "../lib/requests";

const router: IRouter = Router();
router.use("/requests", workspaceAccess, (_req, res, next) => {
  const a = accessOf(res);
  if (a.kind !== "org" || !canUseRequests(a.member)) { res.status(403).json({ error: "الطلبات والمهام متاحة لموظفي الإدارة فقط" }); return; }
  next();
});
const member = (res: Response) => { const a = accessOf(res); if (a.kind !== "org") throw new DomainError("غير مصرح", 403); return a.member; };
const id = (req: Request) => { const n = Number(req.params.id); if (!Number.isInteger(n) || n <= 0) throw new DomainError("معرف غير صحيح"); return n; };

router.get("/requests/catalogue", async (_req, res) => { res.json(await requestsCatalogue(member(res))); });
router.get("/requests/stats", async (_req, res) => { res.json(await requestsStats(member(res))); });
router.get("/requests", async (req, res) => {
  const scope = req.query.scope === "managed" ? "managed" : "mine";
  res.json(await listRequests(member(res), scope, { status: req.query.status, assigneeId: req.query.assigneeId, q: req.query.q }));
});
router.post("/requests", async (req, res) => { res.status(201).json(await createRequest(member(res), req.body ?? {})); });
router.get("/requests/:id", async (req, res) => { res.json(await requestDetail(member(res), id(req))); });
router.post("/requests/:id/open", async (req, res) => { res.json(await openRequest(member(res), id(req))); });
router.post("/requests/:id/respond", async (req, res) => { res.json(await respondToRequest(member(res), id(req), req.body ?? {})); });
router.post("/requests/:id/close", async (req, res) => { res.json(await closeRequest(member(res), id(req), req.body ?? {})); });
router.post("/requests/:id/cancel", async (req, res) => { res.json(await cancelRequest(member(res), id(req), req.body ?? {})); });

export default router;
