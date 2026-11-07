import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { CorsOptions } from "cors";

/** Headers every API response carries. The API only returns JSON, so the CSP forbids everything. */
export function securityHeaders(): RequestHandler {
  const production = process.env.NODE_ENV === "production";
  return (_req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Resource-Policy": "same-site",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    });
    if (production) res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.removeHeader("X-Powered-By");
    next();
  };
}

/**
 * CORS allow-list. The web app and the API share one origin, so by default NO cross-origin access is granted.
 * Set CORS_ALLOWED_ORIGINS (comma separated, e.g. https://app.example.com) for any other trusted origin.
 * Outside production, localhost origins are allowed for development.
 */
export function corsOptions(): CorsOptions {
  const allowed = new Set((process.env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const dev = process.env.NODE_ENV !== "production";
  return {
    credentials: true,
    origin(origin, cb) {
      if (!origin) return cb(null, false);                      // same-origin or non-browser clients: no CORS headers needed
      if (allowed.has(origin)) return cb(null, true);
      if (dev && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
      return cb(null, false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    maxAge: 600,
  };
}

type Bucket = { count: number; resetAt: number };

/**
 * Fixed-window rate limiter keyed by client IP (and optionally by user).
 * NOTE: state is in memory, so on serverless platforms each instance counts separately. It stops bursts and brute force
 * from one client but is not a global guarantee; put a platform firewall rule in front for hard limits.
 */
export function rateLimit(opts: { windowMs: number; max: number; name: string; key?: (req: Request) => string; message?: string }): RequestHandler {
  const buckets = new Map<string, Bucket>();
  let lastSweep = Date.now();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    if (now - lastSweep > opts.windowMs) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
      lastSweep = now;
    }
    const key = opts.key ? opts.key(req) : clientIp(req);
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) { b = { count: 0, resetAt: now + opts.windowMs }; buckets.set(key, b); }
    b.count += 1;
    const remaining = Math.max(0, opts.max - b.count);
    res.set({ "RateLimit-Limit": String(opts.max), "RateLimit-Remaining": String(remaining), "RateLimit-Reset": String(Math.ceil((b.resetAt - now) / 1000)) });
    if (b.count > opts.max) {
      res.set("Retry-After", String(Math.ceil((b.resetAt - now) / 1000)));
      res.status(429).json({ error: opts.message ?? "طلبات كثيرة؛ حاول بعد قليل" });
      return;
    }
    next();
  };
}

/** Client address as seen through the platform proxy (`trust proxy` is configured in app.ts). */
export function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

/** Valid IPv4/IPv6 text for an `inet` column, or null. */
export function inetOrNull(ip: string | undefined): string | null {
  if (!ip) return null;
  const v = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  return /^[0-9a-fA-F:.]+$/.test(v) && v.length <= 45 ? v : null;
}
