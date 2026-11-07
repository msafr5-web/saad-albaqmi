import { Router, type IRouter, type Request, type Response } from "express";
import { accessOf, workspaceAccess } from "../middlewares/workspaceAccess";
import { DomainError } from "../lib/education-validation";
import {
  addQuotation, approveAward, approvePurchaseOrder, approveSupplier, canReadProcurement, createPurchaseRequest, createRfq, createSupplier, evaluateQuotation,
  getComparison, listPurchaseOrders, listPurchaseRequests, listSuppliers, preparePurchaseOrder, purchaseRequestDetail, recommendAward,
} from "../lib/procurement";
import { approveSupplierInvoice, createSupplierInvoice, listSupplierInvoices, orderDetail, paySupplierInvoice, receiveGoods, renderPoHtml, sendPurchaseOrder } from "../lib/procurement-fulfilment";

const router: IRouter = Router();

router.use("/procurement", workspaceAccess, (_req, res, next) => {
  const a = accessOf(res);
  if (a.kind !== "org" || !canReadProcurement(a.member)) { res.status(403).json({ error: "المشتريات متاحة لأعضاء المعهد المخوّلين" }); return; }
  next();
});
const member = (res: Response) => { const a = accessOf(res); if (a.kind !== "org") throw new DomainError("غير مصرح", 403); return a.member; };
const id = (req: Request) => { const n = Number(req.params.id); if (!Number.isInteger(n) || n <= 0) throw new DomainError("معرف غير صحيح"); return n; };
const otp = (req: Request) => ({ challengeId: req.get("x-otp-challenge") ?? undefined, userAgent: req.get("user-agent") });

router.get("/procurement/suppliers", async (_req, res) => { res.json(await listSuppliers(member(res))); });
router.post("/procurement/suppliers", async (req, res) => { res.status(201).json(await createSupplier(member(res), req.body ?? {})); });
router.post("/procurement/suppliers/:id/approve", async (req, res) => { res.json(await approveSupplier(member(res), id(req))); });

router.get("/procurement/requests", async (_req, res) => { res.json(await listPurchaseRequests(member(res))); });
router.post("/procurement/requests", async (req, res) => { res.status(201).json(await createPurchaseRequest(member(res), req.body ?? {})); });
router.get("/procurement/requests/:id", async (req, res) => { res.json(await purchaseRequestDetail(member(res), id(req))); });
router.post("/procurement/requests/:id/rfq", async (req, res) => { res.status(201).json(await createRfq(member(res), id(req), req.body ?? {})); });

router.post("/procurement/rfqs/:id/quotations", async (req, res) => { res.status(201).json(await addQuotation(member(res), id(req), req.body ?? {})); });
router.get("/procurement/rfqs/:id/comparison", async (req, res) => { res.json(await getComparison(member(res), id(req))); });
router.post("/procurement/quotations/:id/evaluate", async (req, res) => { res.json(await evaluateQuotation(member(res), id(req), req.body ?? {})); });
router.post("/procurement/rfqs/:id/award", async (req, res) => { res.status(201).json(await recommendAward(member(res), id(req), req.body ?? {})); });
router.post("/procurement/rfqs/:id/award/approve", async (req, res) => { res.json(await approveAward(member(res), id(req), otp(req))); });
router.post("/procurement/rfqs/:id/purchase-order", async (req, res) => { res.status(201).json(await preparePurchaseOrder(member(res), id(req), req.body ?? {}, otp(req))); });

router.get("/procurement/orders", async (_req, res) => { res.json(await listPurchaseOrders(member(res))); });
router.post("/procurement/orders/:id/approve", async (req, res) => { res.json(await approvePurchaseOrder(member(res), id(req), otp(req))); });

router.get("/procurement/orders/:id", async (req, res) => { res.json(await orderDetail(member(res), id(req))); });
/** Printable order (save as PDF from the browser). Inline styles are allowed for this one self-contained, fully escaped page. */
router.get("/procurement/orders/:id/print", async (req, res) => {
  const html = await renderPoHtml(member(res), id(req));
  res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'").type("html").send(html);
});
router.post("/procurement/orders/:id/send", async (req, res) => { res.json(await sendPurchaseOrder(member(res), id(req), otp(req))); });
router.post("/procurement/orders/:id/receipts", async (req, res) => { res.status(201).json(await receiveGoods(member(res), id(req), req.body ?? {}, otp(req))); });
router.post("/procurement/orders/:id/invoices", async (req, res) => { res.status(201).json(await createSupplierInvoice(member(res), id(req), req.body ?? {})); });
router.get("/procurement/invoices", async (_req, res) => { res.json(await listSupplierInvoices(member(res))); });
router.post("/procurement/invoices/:id/approve", async (req, res) => { res.json(await approveSupplierInvoice(member(res), id(req), req.body ?? {}, otp(req))); });
router.post("/procurement/invoices/:id/pay", async (req, res) => { res.status(201).json(await paySupplierInvoice(member(res), id(req), req.body ?? {}, otp(req))); });

export default router;
