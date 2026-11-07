import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { CLERK_PROXY_PATH, clerkProxyMiddleware, getClerkProxyHost } from "./middlewares/clerkProxyMiddleware";
import { DomainError } from "./lib/education-validation";
import { corsOptions, rateLimit, securityHeaders } from "./middlewares/security";

const writeLimiter = rateLimit({ name: "api-write", windowMs: 60_000, max: Number(process.env.RATE_LIMIT_WRITES_PER_MINUTE ?? 60), message: "عمليات كتابة كثيرة؛ حاول بعد قليل" });
const app: Express = express();
// The platform proxy (Vercel/Replit) sets X-Forwarded-For; trust exactly one hop so req.ip is the real client address.
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? 1));
app.disable("x-powered-by");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());   // proxied Clerk assets keep their own headers
app.use(securityHeaders());
app.use(cors(corsOptions()));
app.use("/api", rateLimit({ name: "api", windowMs: 60_000, max: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 300) }));
app.use("/api", (req, res, next) => (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS" ? next() : writeLimiter(req, res, next)));
app.use(express.json({limit:"64kb"}));
app.use(express.urlencoded({ extended: true }));
app.use(clerkMiddleware((req) => ({
  publishableKey: publishableKeyFromHost(
    getClerkProxyHost(req) ?? "",
    process.env.CLERK_PUBLISHABLE_KEY,
  ),
})));

app.use("/api", router);
app.use((error: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof DomainError) {
    const otp = error as DomainError & { otpRequired?: boolean; otpAction?: string; otpSubject?: unknown; otpSubjectType?: string };
    res.status(error.status).json({ error: error.message, ...(otp.otpRequired ? { otpRequired: true, otpAction: otp.otpAction, otpSubject: otp.otpSubject, otpSubjectType: otp.otpSubjectType } : {}) });
    return;
  }
  req.log.error({err:error},"Request failed");
  res.status(500).json({error:"تعذر إتمام العملية؛ حاول مجددًا"});
});

export default app;
