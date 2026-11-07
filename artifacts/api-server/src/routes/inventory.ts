import { Router, type IRouter, type Request, type Response } from "express";
import { accessOf, workspaceAccess } from "../middlewares/workspaceAccess";
import { DomainError } from "../lib/education-validation";
import { canReadInventory, consumption, createItem, listAlerts, listBalances, listCatalogue, listNotifications, markNotificationRead, postMovement, setStockLevel } from "../lib/inventory";

const router: IRouter = Router();

/** Inventory and the in-app inbox belong to the shared organization; personal workspaces and demo have none. */
router.use(["/inventory", "/notifications"], workspaceAccess, (_req, res, next) => {
  const a = accessOf(res);
  if (a.kind !== "org" || !canReadInventory(a.member)) { res.status(403).json({ error: "المخزون متاح لأعضاء المعهد المخوّلين" }); return; }
  next();
});
const member = (res: Response) => { const a = accessOf(res); if (a.kind !== "org") throw new DomainError("غير مصرح", 403); return a.member; };

router.get("/inventory/catalogue", async (_req, res) => { res.json(await listCatalogue(member(res))); });
router.post("/inventory/items", async (req, res) => { res.status(201).json(await createItem(member(res), req.body ?? {})); });
router.put("/inventory/stock-levels", async (req, res) => { res.json(await setStockLevel(member(res), req.body ?? {})); });
router.post("/inventory/movements", async (req: Request, res) => {
  const out = await postMovement(member(res), req.body ?? {}, { challengeId: req.get("x-otp-challenge") ?? undefined, userAgent: req.get("user-agent") });
  res.status(201).json(out);
});
router.get("/inventory/balances", async (req, res) => { res.json(await listBalances(member(res), Number(req.query.warehouseId))); });
router.get("/inventory/alerts", async (_req, res) => { res.json(await listAlerts(member(res))); });
router.get("/inventory/consumption", async (req, res) => { res.json(await consumption(member(res), { warehouseId: Number(req.query.warehouseId), from: req.query.from, to: req.query.to })); });
router.get("/notifications", async (_req, res) => { res.json(await listNotifications(member(res))); });
router.post("/notifications/:id/read", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw new DomainError("معرف غير صحيح");
  await markNotificationRead(member(res), id);
  res.status(204).end();
});

export default router;
