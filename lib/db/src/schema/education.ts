import { pgTable, serial, text, integer, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const educationRecords = pgTable("education_records", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  branchId: integer("branch_id"),
  status: text("status").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("education_owner_kind_idx").on(t.ownerId, t.kind)]);

export const educationAudit = pgTable("education_audit", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  actorId: text("actor_id"),
  action: text("action").notNull(),
  recordId: integer("record_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Shared institute workspace. All organization records use this single owner id. */
export const ORG_OWNER_ID = "org:main";

export const orgMembers = pgTable("org_members", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id"),
  email: text("email").notNull(),
  role: text("role").notNull(),
  branchId: integer("branch_id"),
  linkedRecordId: integer("linked_record_id"),
  status: text("status").notNull(),
  invitedBy: text("invited_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("org_members_live_email_idx").on(sql`lower(${t.email})`).where(sql`${t.status} <> 'revoked'`),
  uniqueIndex("org_members_active_user_idx").on(t.clerkUserId).where(sql`${t.status} = 'active'`),
]);

/** Cost-allocation policy per workspace: an editable draft and the last approved (frozen) version. */
export const costPolicies = pgTable("cost_policies", {
  ownerId: text("owner_id").primaryKey(),
  draft: jsonb("draft").$type<Record<string, unknown>>(),
  draftVersion: integer("draft_version").notNull().default(0),
  approved: jsonb("approved").$type<Record<string, unknown>>(),
  approvedVersion: integer("approved_version"),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
