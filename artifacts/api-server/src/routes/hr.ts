import { Router, type IRouter, type Request, type Response } from "express";
import { accessOf, workspaceAccess } from "../middlewares/workspaceAccess";
import { DomainError } from "../lib/education-validation";
import { canReadHr, createDepartment, updateDepartment, createEmployee, createLeave, decideDelegation, decideLeave, hrCatalogue, listDelegations, listEmployees, listLeave, proposeDelegation, revokeDelegation, updateEmployee } from "../lib/hr";

const router: IRouter = Router();
router.use("/hr", workspaceAccess, (_req, res, next) => {
  const a = accessOf(res);
  if (a.kind !== "org" || !canReadHr(a.member)) { res.status(403).json({ error: "الموارد البشرية متاحة للمخوّلين فقط" }); return; }
  next();
});
const member = (res: Response) => { const a = accessOf(res); if (a.kind !== "org") throw new DomainError("غير مصرح", 403); return a.member; };
const id = (req: Request) => { const n = Number(req.params.id); if (!Number.isInteger(n) || n <= 0) throw new DomainError("معرف غير صحيح"); return n; };

router.get("/hr/catalogue", async (_req, res) => { res.json(await hrCatalogue(member(res))); });
router.post("/hr/departments", async (req, res) => { res.status(201).json(await createDepartment(member(res), req.body ?? {})); });
router.put("/hr/departments/:id", async (req, res) => { res.json(await updateDepartment(member(res), id(req), req.body ?? {})); });
router.get("/hr/employees", async (_req, res) => { res.json(await listEmployees(member(res))); });
router.post("/hr/employees", async (req, res) => { res.status(201).json(await createEmployee(member(res), req.body ?? {})); });
router.put("/hr/employees/:id", async (req, res) => { res.json(await updateEmployee(member(res), id(req), req.body ?? {})); });
router.get("/hr/leave", async (_req, res) => { res.json(await listLeave(member(res))); });
router.post("/hr/leave", async (req, res) => { res.status(201).json(await createLeave(member(res), req.body ?? {})); });
router.post("/hr/leave/:id/approve", async (req, res) => { res.json(await decideLeave(member(res), id(req), true)); });
router.post("/hr/leave/:id/reject", async (req, res) => { res.json(await decideLeave(member(res), id(req), false)); });
router.get("/hr/delegations", async (_req, res) => { res.json(await listDelegations(member(res))); });
router.post("/hr/delegations", async (req, res) => { res.status(201).json(await proposeDelegation(member(res), req.body ?? {})); });
router.post("/hr/delegations/:id/approve", async (req, res) => { res.json(await decideDelegation(member(res), id(req), true, { challengeId: req.get("x-otp-challenge") ?? undefined, userAgent: req.get("user-agent") })); });
router.post("/hr/delegations/:id/reject", async (req, res) => { res.json(await decideDelegation(member(res), id(req), false, {})); });
router.post("/hr/delegations/:id/revoke", async (req, res) => { res.json(await revokeDelegation(member(res), id(req))); });

export default router;
