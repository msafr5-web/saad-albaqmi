import { pgTable, text, boolean, timestamp, uniqueIndex, index, check, integer, bigint } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { pk, fkCol, createdAt, updatedAt, memberFk } from "./_helpers";

/** Institute branches. The head office is a branch with is_head_office = true (exactly one, enforced below). */
export const branches = pgTable("branches", {
  id: pk(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  city: text("city").notNull(),
  isHeadOffice: boolean("is_head_office").notNull().default(false),
  status: text("status").notNull().default("active"),
  vatNumber: text("vat_number"),
  commercialRegNo: text("commercial_reg_no"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("branches_code_uq").on(t.code),
  uniqueIndex("branches_one_head_office_uq").on(t.isHeadOffice).where(sql`${t.isHeadOffice}`),
  check("branches_status_ck", sql`${t.status} in ('active','inactive')`),
  check("branches_vat_format_ck", sql`${t.vatNumber} is null or ${t.vatNumber} ~ '^3[0-9]{13}3$'`),
]);

/** Organization-wide settings, one row per key (VAT defaults, OTP policy, approval thresholds...). */
export const orgSettings = pgTable("org_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  description: text("description"),
  updatedBy: memberFk("updated_by"),
  updatedAt: updatedAt(),
});

/** Generic attachment registry: quotes, invoices, contracts. The file itself lives in object storage (storage_key). */
export const documents = pgTable("documents", {
  id: pk(),
  ownerType: text("owner_type").notNull(),
  ownerId: fkCol("owner_id").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  storageKey: text("storage_key").notNull(),
  sha256: text("sha256").notNull(),
  uploadedBy: memberFk("uploaded_by"),
  createdAt: createdAt(),
}, (t) => [
  index("documents_owner_idx").on(t.ownerType, t.ownerId),
  uniqueIndex("documents_storage_key_uq").on(t.storageKey),
  check("documents_size_ck", sql`${t.sizeBytes} > 0`),
  check("documents_sha256_ck", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
]);

/** Gap-free document numbering (PO-2026-000123). Always call next_doc_no(prefix) inside the business transaction. */
export const documentSequences = pgTable("document_sequences", {
  prefix: text("prefix").notNull(),
  year: integer("year").notNull(),
  lastValue: bigint("last_value", { mode: "number" }).notNull().default(0),
}, (t) => [uniqueIndex("document_sequences_pk").on(t.prefix, t.year)]);

/** In-app inbox (reorder alerts, approvals waiting, escalations). Email delivery is recorded in email_sent_at. */
export const notifications = pgTable("notifications", {
  id: pk(),
  memberId: memberFk("member_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  link: text("link"),
  subjectType: text("subject_type"),
  subjectId: fkCol("subject_id"),
  createdAt: createdAt(),
  readAt: timestamp("read_at", { withTimezone: true }),
  emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
}, (t) => [index("notifications_member_unread_idx").on(t.memberId, t.createdAt).where(sql`${t.readAt} is null`)]);

