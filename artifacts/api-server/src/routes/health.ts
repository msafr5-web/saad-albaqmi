import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/** Readiness: also proves the database answers (use for uptime monitors; /healthz stays a cheap liveness probe). */
router.get("/readyz", async (_req, res) => {
  try { await pool.query("select 1"); res.json({ status: "ok", database: "ok" }); }
  catch { res.status(503).json({ status: "degraded", database: "unreachable" }); }
});

export default router;
