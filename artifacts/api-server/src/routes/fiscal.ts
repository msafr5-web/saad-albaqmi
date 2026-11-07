import { Router, type IRouter, type Request, type Response } from "express";
import { accessOf, workspaceAccess } from "../middlewares/workspaceAccess";
import { DomainError } from "../lib/education-validation";
import { budgetStatus, canReadFiscal, createSalesInvoice, issueSalesInvoice, listSalesInvoices, setBudget, vatReport, weeklyExpenses } from "../lib/fiscal";

const router: IRouter = Router();
router.use("/fiscal", workspaceAccess, (_req, res, next) => {
  const a = accessOf(res);
  if (a.kind !== "org" || !canReadFiscal(a.member)) { res.status(403).json({ error: "الميزانية والضريبة للمخوّلين فقط" }); return; }
  next();
});
const member = (res: Response) => { const a = accessOf(res); if (a.kind !== "org") throw new DomainError("غير مصرح", 403); return a.member; };
const id = (req: Request) => { const n = Number(req.params.id); if (!Number.isInteger(n) || n <= 0) throw new DomainError("معرف غير صحيح"); return n; };

router.get("/fiscal/budgets", async (req, res) => { res.json(await budgetStatus(member(res), req.query.month)); });
router.put("/fiscal/budgets", async (req, res) => { res.json(await setBudget(member(res), req.body ?? {})); });
router.get("/fiscal/weekly-expenses", async (req, res) => { res.json(await weeklyExpenses(member(res), { branchId: req.query.branchId, from: req.query.from, to: req.query.to })); });
router.get("/fiscal/sales-invoices", async (_req, res) => { res.json(await listSalesInvoices(member(res))); });
router.post("/fiscal/sales-invoices", async (req, res) => { res.status(201).json(await createSalesInvoice(member(res), req.body ?? {})); });
router.post("/fiscal/sales-invoices/:id/issue", async (req, res) => { res.json(await issueSalesInvoice(member(res), id(req), { challengeId: req.get("x-otp-challenge") ?? undefined, userAgent: req.get("user-agent") })); });
router.get("/fiscal/vat", async (req, res) => { res.json(await vatReport(member(res), { from: req.query.from, to: req.query.to })); });

export default router;
