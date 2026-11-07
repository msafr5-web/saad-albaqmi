import type { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import type { Member } from "../lib/education-access";
import { resolveMember } from "../lib/org-membership";
import { SESSION_COOKIE, localAuthEnabled, localEmails, parseCookie, sessionAccount, userIdOf } from "../lib/local-auth";

export type Access =
  | { kind: "demo" }
  | { kind: "personal"; userId: string }
  | { kind: "org"; userId: string; member: Member };

export const accessOf = (res: Response) => res.locals.access as Access;

export function sameOrigin(req: Request): boolean {
  const source = req.get("origin");
  const host = req.get("x-forwarded-host")?.split(",")[0]?.trim() || req.get("host");
  try { return !!source && new URL(source).host === host; } catch { return false; }
}

/** Same-origin check for state-changing requests, then resolve who the caller is for this request. */
export async function workspaceAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.set("Cache-Control", "private, no-store");
    let userId: string | null | undefined;
    if (localAuthEnabled()) {
      const acc = await sessionAccount(parseCookie(req.get("cookie"), SESSION_COOKIE));
      if (acc?.mustChange) { res.status(403).json({ error: "غيّر كلمة المرور المؤقتة أولًا", mustChange: true }); return; }
      userId = acc ? userIdOf(acc.id) : null;
    } else userId = getAuth(req).userId;
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const source = req.get("origin");
      const host = req.get("x-forwarded-host")?.split(",")[0]?.trim() || req.get("host");
      let sameOrigin = false;
      try { sameOrigin = !!source && new URL(source).host === host; } catch { sameOrigin = false; }
      if (!sameOrigin) { res.status(403).json({ error: "مصدر الطلب غير مسموح" }); return; }
      if (!userId) { res.status(401).json({ error: "سجّل الدخول لحفظ البيانات" }); return; }
    }
    if (!userId) res.locals.access = { kind: "demo" } satisfies Access;
    else {
      const member = await resolveMember(userId, localAuthEnabled() ? localEmails : undefined);
      res.locals.access = (member ? { kind: "org", userId, member } : { kind: "personal", userId }) satisfies Access;
    }
    next();
  } catch (e) { next(e); }
}
