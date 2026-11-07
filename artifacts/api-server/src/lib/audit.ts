import { db, auditEvents } from "@workspace/db";

type Executor = Pick<typeof db, "insert">;

export type AuditInput = {
  actorMemberId: number | null;
  actorRole: string | null;
  branchId?: number | null;
  action: string;
  subjectType: string;
  subjectId?: number | null;
  subjectNo?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  result?: "success" | "failure" | "denied" | "expired";
  otp?: { challengeId: string; sentAt: Date; verifiedAt: Date | null; sentIp: string | null; verifiedIp: string | null } | null;
  userAgent?: string | null;
  contentHash?: string | null;
};

/**
 * Appends one event to the hash-chained audit ledger (table audit_events). The database fills prev_hash/row_hash and
 * rejects any later UPDATE or DELETE. Pass the surrounding transaction so the event commits or rolls back with the action.
 */
export async function recordAudit(exec: Executor, e: AuditInput): Promise<void> {
  await exec.insert(auditEvents).values({
    actorMemberId: e.actorMemberId, actorRole: e.actorRole, branchId: e.branchId ?? null,
    action: e.action, subjectType: e.subjectType, subjectId: e.subjectId ?? null, subjectNo: e.subjectNo ?? null,
    beforeState: e.before ?? null, afterState: e.after ?? null, reason: e.reason ?? null, result: e.result ?? "success",
    otpChallengeId: e.otp?.challengeId ?? null, otpSentAt: e.otp?.sentAt ?? null, otpVerifiedAt: e.otp?.verifiedAt ?? null,
    ipSent: e.otp?.sentIp ?? null, ipVerified: e.otp?.verifiedIp ?? null,
    userAgent: e.userAgent?.slice(0, 300) ?? null, contentHash: e.contentHash ?? null,
  });
}
