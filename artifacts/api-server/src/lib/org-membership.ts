import { and, eq, isNull, sql } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import { db, orgMembers } from "@workspace/db";
import type { Member, Role } from "./education-access";

type Row = typeof orgMembers.$inferSelect;
const toMember = (r: Row): Member => ({ id: r.id, clerkUserId: r.clerkUserId!, email: r.email, role: r.role as Role, branchId: r.branchId, linkedRecordId: r.linkedRecordId });

/** Owner-configured identity of the first administrator (never a Clerk user id; resolved per environment). */
export const ownerEmail = () => process.env.ORG_OWNER_EMAIL?.trim().toLowerCase() || null;

type Identity = { emails: string[] };
const identityCache = new Map<string, { at: number; value: Identity }>();
const TTL_MS = 5 * 60_000;

/** Only emails Clerk has verified may claim an invitation or the owner role. */
export async function verifiedEmails(userId: string): Promise<string[]> {
  const hit = identityCache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value.emails;
  const user = await clerkClient.users.getUser(userId);
  const emails = user.emailAddresses.filter(e => e.verification?.status === "verified").map(e => e.emailAddress.trim().toLowerCase());
  identityCache.set(userId, { at: Date.now(), value: { emails } });
  return emails;
}

export function clearIdentityCache(userId?: string) { userId ? identityCache.delete(userId) : identityCache.clear(); }

/**
 * Resolve the signed-in user's organization membership.
 * 1. Existing active membership by Clerk id.
 * 2. Pending invitation matching a verified email (claimed atomically, once).
 * 3. First administrator: verified email equals the owner-configured email and that email has never had
 *    a membership row (so revoking the owner is never silently undone by a re-run).
 * Anyone else gets null and keeps only a private personal workspace — registration grants nothing.
 */
export async function resolveMember(userId: string, lookupEmails: (id: string) => Promise<string[]> = verifiedEmails): Promise<Member | null> {
  const [active] = await db.select().from(orgMembers).where(and(eq(orgMembers.clerkUserId, userId), eq(orgMembers.status, "active")));
  if (active) return toMember(active);
  const [revoked] = await db.select().from(orgMembers).where(and(eq(orgMembers.clerkUserId, userId), eq(orgMembers.status, "revoked")));
  const emails = await lookupEmails(userId);
  if (!emails.length) return null;

  for (const email of emails) {
    const [claimed] = await db.update(orgMembers)
      .set({ clerkUserId: userId, status: "active", activatedAt: new Date() })
      .where(and(sql`lower(${orgMembers.email}) = ${email}`, eq(orgMembers.status, "invited"), isNull(orgMembers.clerkUserId)))
      .returning();
    if (claimed) return toMember(claimed);
  }

  const owner = ownerEmail();
  if (owner && !revoked && emails.includes(owner)) {
    return db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('org-bootstrap'))`);
      const [existing] = await tx.select().from(orgMembers).where(sql`lower(${orgMembers.email}) = ${owner}`);
      if (existing) return existing.status === "active" && existing.clerkUserId === userId ? toMember(existing) : null;
      const [created] = await tx.insert(orgMembers).values({ clerkUserId: userId, email: owner, role: "super_admin", status: "active", activatedAt: new Date(), invitedBy: "owner-bootstrap" }).returning();
      return toMember(created!);
    });
  }
  return null;
}
