import { pgTable, serial, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";

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
  action: text("action").notNull(),
  recordId: integer("record_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
