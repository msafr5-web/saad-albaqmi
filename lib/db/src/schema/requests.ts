import { pgTable, text, timestamp, jsonb, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { pk, fkCol, createdAt, memberFk } from "./_helpers";
import { branches } from "./core";
import { employees } from "./hr";

/**
 * Internal requests and tasks: a manager sends a task to an employee (register on a site, upload a file, prepare a report...)
 * and the system timestamps the four stages itself: sent -> received (first time the employee opens it) -> responded -> closed
 * (the manager approves). Durations are derived in the view v_internal_requests, never typed by hand.
 */
export const internalRequests = pgTable("internal_requests", {
  id: pk(),
  requestNo: text("request_no").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  requestType: text("request_type").notNull().default("other"),
  priority: text("priority").notNull().default("normal"),
  branchId: fkCol("branch_id").notNull().references(() => branches.id),
  assigneeId: fkCol("assignee_id").notNull().references(() => employees.id),
  createdBy: memberFk("created_by").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }),
  status: text("status").notNull().default("sent"),
  sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  responseText: text("response_text"),
  responseLinks: jsonb("response_links").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  closeNote: text("close_note"),
  closedBy: memberFk("closed_by"),
}, (t) => [
  uniqueIndex("internal_requests_no_uq").on(t.requestNo),
  index("internal_requests_assignee_idx").on(t.assigneeId, t.status),
  index("internal_requests_branch_idx").on(t.branchId, t.status),
  index("internal_requests_creator_idx").on(t.createdBy),
  check("internal_requests_type_ck", sql`${t.requestType} in ('registration','upload','report','other')`),
  check("internal_requests_priority_ck", sql`${t.priority} in ('normal','high','urgent')`),
  check("internal_requests_status_ck", sql`${t.status} in ('sent','received','responded','closed','cancelled')`),
  // each stage needs its own timestamp, and the clock only moves forward
  check("internal_requests_stage_ck", sql`(${t.status} not in ('received','responded','closed') or ${t.receivedAt} is not null)
    and (${t.status} not in ('responded','closed') or ${t.respondedAt} is not null)
    and (${t.status} <> 'closed' or (${t.closedAt} is not null and ${t.closedBy} is not null))
    and (${t.status} <> 'cancelled' or ${t.cancelledAt} is not null)`),
  check("internal_requests_order_ck", sql`(${t.receivedAt} is null or ${t.receivedAt} >= ${t.sentAt})
    and (${t.respondedAt} is null or ${t.receivedAt} is null or ${t.respondedAt} >= ${t.receivedAt})
    and (${t.closedAt} is null or ${t.respondedAt} is null or ${t.closedAt} >= ${t.respondedAt})`),
]);

/** Append-only timeline of a request: who did what and when (the manager's audit trail for the task). */
export const internalRequestEvents = pgTable("internal_request_events", {
  id: pk(),
  requestId: fkCol("request_id").notNull().references(() => internalRequests.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  actorMemberId: memberFk("actor_member_id"),
  note: text("note"),
  createdAt: createdAt(),
}, (t) => [
  index("internal_request_events_req_idx").on(t.requestId, t.createdAt),
  check("internal_request_events_type_ck", sql`${t.eventType} in ('created','received','responded','closed','cancelled','reminder')`),
]);
