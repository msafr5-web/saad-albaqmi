import { Router, type IRouter, type Request, type Response } from "express";
import { workspaceAccess, accessOf } from "../middlewares/workspaceAccess";
import { clientIp, inetOrNull, rateLimit } from "../middlewares/security";
import { DomainError } from "../lib/education-validation";
import { OTP_ACTIONS, inboxFor, issueChallenge, otpChannel, otpEnabled, otpTtlSeconds, verifyChallenge } from "../lib/otp";

const router: IRouter = Router();

/** Only members of the shared organization confirm operations; personal workspaces and demo mode never need an OTP. */
router.use("/otp", workspaceAccess, rateLimit({ name: "otp", windowMs: 60_000, max: 20, key: (req) => `${clientIp(req)}` }), (_req, res, next) => {
  if (accessOf(res).kind !== "org") { res.status(403).json({ error: "تأكيد العمليات متاح لأعضاء المعهد فقط" }); return; }
  next();
});

const ctx = (req: Request) => ({ ip: inetOrNull(clientIp(req)), userAgent: req.get("user-agent") ?? null });

/** Public configuration the web app needs to decide whether to show the confirmation dialog. */
router.get("/otp/config", (_req, res) => { res.json({ required: otpEnabled(), channel: otpChannel(), ttlSeconds: otpTtlSeconds(), actions: Object.keys(OTP_ACTIONS) }); });

router.get("/otp/inbox", async (_req: Request, res: Response): Promise<void> => {
  const a = accessOf(res);
  if (a.kind !== "org") return;
  res.set("Cache-Control", "private, no-store").json({ items: await inboxFor(a.member.id) });
});

router.post("/otp/challenges", async (req: Request, res: Response): Promise<void> => {
  const a = accessOf(res);
  if (a.kind !== "org") return;
  const { action, subjectType, subjectId, subject } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof action !== "string" || typeof subjectType !== "string" || subject === undefined || JSON.stringify(subject).length > 20_000) throw new DomainError("بيانات الطلب غير صحيحة");
  if (subjectId !== undefined && subjectId !== null && !Number.isInteger(subjectId)) throw new DomainError("بيانات الطلب غير صحيحة");
  const out = await issueChallenge({ member: { id: a.member.id, email: a.member.email }, action, subjectType: subjectType.slice(0, 40), subjectId: (subjectId as number | null | undefined) ?? null, subject, ctx: ctx(req) });
  res.status(201).json(out);
});

router.post("/otp/challenges/:id/verify", rateLimit({ name: "otp-verify", windowMs: 60_000, max: 10, key: (req) => `${clientIp(req)}:${req.params.id}` }), async (req: Request, res: Response): Promise<void> => {
  const a = accessOf(res);
  if (a.kind !== "org") return;
  const id = String(req.params.id);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new DomainError("طلب التأكيد غير موجود", 404);
  const code = String((req.body ?? {}).code ?? "");
  const result = await verifyChallenge({ challengeId: id, memberId: a.member.id, code, ctx: ctx(req) });
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.json({ verified: true });
});

export default router;
