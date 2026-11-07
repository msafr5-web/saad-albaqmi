import { pgTable, text, integer, timestamp, uniqueIndex, index, check, uuid, jsonb, inet, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { pk, fkCol, createdAt, memberFk } from "./_helpers";
import { branches } from "./core";
import { rooms } from "./academic";
import { classSessions } from "./academic";

/**
 * One-time confirmation codes. The code itself is never stored: only an HMAC of (code, challenge id, subject hash).
 * A challenge is bound to the exact document (subject_hash), the action and the user, so a code cannot be replayed on a
 * different or modified document. The IPs/user agents recorded here feed the audit workflow.
 */
export const otpChallenges = pgTable("otp_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  memberId: memberFk("member_id").notNull(),
  action: text("action").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: fkCol("subject_id"),
  subjectHash: text("subject_hash").notNull(),
  codeHmac: text("code_hmac").notNull(),
  channel: text("channel").notNull().default("email"),
  destinationMasked: text("destination_masked").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),          // a verified code can authorise exactly one operation
  sentIp: inet("sent_ip"),
  verifiedIp: inet("verified_ip"),
  sentUserAgent: text("sent_user_agent"),
  verifiedUserAgent: text("verified_user_agent"),
}, (t) => [
  index("otp_challenges_member_idx").on(t.memberId, t.sentAt),
  index("otp_challenges_subject_idx").on(t.subjectType, t.subjectId),
  check("otp_challenges_channel_ck", sql`${t.channel} in ('email','sms','app','totp')`),
  check("otp_challenges_status_ck", sql`${t.status} in ('pending','verified','expired','failed','cancelled')`),
  check("otp_challenges_attempts_ck", sql`${t.attempts} >= 0 and ${t.attempts} <= ${t.maxAttempts}`),
  check("otp_challenges_expiry_ck", sql`${t.expiresAt} > ${t.sentAt}`),
  check("otp_challenges_verified_ck", sql`(${t.status} = 'verified') = (${t.verifiedAt} is not null)`),
  check("otp_challenges_consumed_ck", sql`${t.consumedAt} is null or ${t.status} = 'verified'`),
]);

/**
 * Append-only, hash-chained audit ledger. UPDATE, DELETE and TRUNCATE are rejected by triggers and each row stores
 * the hash of the previous row, so any tampering is detectable with verify_audit_chain().
 */
export const auditEvents = pgTable("audit_events", {
  id: pk(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  actorMemberId: memberFk("actor_member_id"),
  actorRole: text("actor_role"),
  branchId: fkCol("branch_id").references(() => branches.id),
  action: text("action").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: fkCol("subject_id"),
  subjectNo: text("subject_no"),
  beforeState: jsonb("before_state").$type<Record<string, unknown>>(),
  afterState: jsonb("after_state").$type<Record<string, unknown>>(),
  reason: text("reason"),
  result: text("result").notNull().default("success"),
  otpChallengeId: uuid("otp_challenge_id").references(() => otpChallenges.id),
  otpSentAt: timestamp("otp_sent_at", { withTimezone: true }),
  otpVerifiedAt: timestamp("otp_verified_at", { withTimezone: true }),
  ipSent: inet("ip_sent"),
  ipVerified: inet("ip_verified"),
  userAgent: text("user_agent"),
  contentHash: text("content_hash"),
  prevHash: text("prev_hash"),
  rowHash: text("row_hash").notNull().default(""),
}, (t) => [
  index("audit_events_subject_idx").on(t.subjectType, t.subjectId, t.occurredAt),
  index("audit_events_actor_idx").on(t.actorMemberId, t.occurredAt),
  index("audit_events_time_idx").on(t.occurredAt),
  check("audit_events_result_ck", sql`${t.result} in ('success','failure','denied','expired')`),
]);

// ---------- NFC / QR identity card and presence ---------------------------------------------------------------------
/**
 * A card identifies a person only by an opaque token; no personal data is stored on the tag. Loss or suspicion is handled
 * by revoking the card (status) which takes effect immediately on the server. A holder has at most one active card.
 */
export const identityCards = pgTable("identity_cards", {
  id: pk(),
  tokenHash: text("token_hash").notNull(),
  holderType: text("holder_type").notNull(),
  holderId: fkCol("holder_id").notNull(),
  cardType: text("card_type").notNull().default("nfc"),
  status: text("status").notNull().default("active"),
  keyVersion: integer("key_version").notNull().default(1),
  issuedBy: memberFk("issued_by"),
  issuedAt: timestamp("issued_at", { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedReason: text("revoked_reason"),
}, (t) => [
  uniqueIndex("identity_cards_token_uq").on(t.tokenHash),
  uniqueIndex("identity_cards_one_active_uq").on(t.holderType, t.holderId).where(sql`${t.status} = 'active'`),
  check("identity_cards_holder_ck", sql`${t.holderType} in ('student','employee','instructor')`),
  check("identity_cards_type_ck", sql`${t.cardType} in ('nfc','qr','virtual')`),
  check("identity_cards_status_ck", sql`${t.status} in ('active','suspended','revoked','lost')`),
  check("identity_cards_revoked_ck", sql`${t.status} = 'active' or ${t.revokedAt} is not null`),
]);

/** Check-in/out events: employee attendance, instructor presence in a room, student attendance at a session. */
export const presenceEvents = pgTable("presence_events", {
  id: pk(),
  cardId: fkCol("card_id").references(() => identityCards.id),
  holderType: text("holder_type").notNull(),
  holderId: fkCol("holder_id").notNull(),
  branchId: fkCol("branch_id").notNull().references(() => branches.id),
  eventType: text("event_type").notNull(),
  roomId: fkCol("room_id").references(() => rooms.id),
  sessionId: fkCol("session_id").references(() => classSessions.id),
  method: text("method").notNull(),
  deviceMemberId: memberFk("device_member_id"),
  verified: boolean("verified").notNull().default(false),
  ip: inet("ip"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("presence_events_holder_idx").on(t.holderType, t.holderId, t.occurredAt),
  index("presence_events_session_idx").on(t.sessionId).where(sql`${t.sessionId} is not null`),
  check("presence_events_holder_ck", sql`${t.holderType} in ('student','employee','instructor')`),
  check("presence_events_type_ck", sql`${t.eventType} in ('check_in','check_out')`),
  check("presence_events_method_ck", sql`${t.method} in ('nfc','qr','manual','geofence')`),
]);

