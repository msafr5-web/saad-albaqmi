CREATE TABLE "internal_request_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "internal_request_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"request_id" bigint NOT NULL,
	"event_type" text NOT NULL,
	"actor_member_id" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "internal_request_events_type_ck" CHECK ("internal_request_events"."event_type" in ('created','received','responded','closed','cancelled','reminder'))
);
--> statement-breakpoint
CREATE TABLE "internal_requests" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "internal_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"request_no" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"request_type" text DEFAULT 'other' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"branch_id" bigint NOT NULL,
	"assignee_id" bigint NOT NULL,
	"created_by" integer NOT NULL,
	"due_at" timestamp with time zone,
	"status" text DEFAULT 'sent' NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"response_text" text,
	"response_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"close_note" text,
	"closed_by" integer,
	CONSTRAINT "internal_requests_type_ck" CHECK ("internal_requests"."request_type" in ('registration','upload','report','other')),
	CONSTRAINT "internal_requests_priority_ck" CHECK ("internal_requests"."priority" in ('normal','high','urgent')),
	CONSTRAINT "internal_requests_status_ck" CHECK ("internal_requests"."status" in ('sent','received','responded','closed','cancelled')),
	CONSTRAINT "internal_requests_stage_ck" CHECK (("internal_requests"."status" not in ('received','responded','closed') or "internal_requests"."received_at" is not null)
    and ("internal_requests"."status" not in ('responded','closed') or "internal_requests"."responded_at" is not null)
    and ("internal_requests"."status" <> 'closed' or ("internal_requests"."closed_at" is not null and "internal_requests"."closed_by" is not null))
    and ("internal_requests"."status" <> 'cancelled' or "internal_requests"."cancelled_at" is not null)),
	CONSTRAINT "internal_requests_order_ck" CHECK (("internal_requests"."received_at" is null or "internal_requests"."received_at" >= "internal_requests"."sent_at")
    and ("internal_requests"."responded_at" is null or "internal_requests"."received_at" is null or "internal_requests"."responded_at" >= "internal_requests"."received_at")
    and ("internal_requests"."closed_at" is null or "internal_requests"."responded_at" is null or "internal_requests"."closed_at" >= "internal_requests"."responded_at"))
);
--> statement-breakpoint
ALTER TABLE "internal_request_events" ADD CONSTRAINT "internal_request_events_request_id_internal_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."internal_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_request_events" ADD CONSTRAINT "internal_request_events_actor_member_id_org_members_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_requests" ADD CONSTRAINT "internal_requests_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_requests" ADD CONSTRAINT "internal_requests_assignee_id_employees_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_requests" ADD CONSTRAINT "internal_requests_created_by_org_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_requests" ADD CONSTRAINT "internal_requests_closed_by_org_members_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "internal_request_events_req_idx" ON "internal_request_events" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "internal_requests_no_uq" ON "internal_requests" USING btree ("request_no");--> statement-breakpoint
CREATE INDEX "internal_requests_assignee_idx" ON "internal_requests" USING btree ("assignee_id","status");--> statement-breakpoint
CREATE INDEX "internal_requests_branch_idx" ON "internal_requests" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "internal_requests_creator_idx" ON "internal_requests" USING btree ("created_by");
--> statement-breakpoint
CREATE TRIGGER trg_internal_request_events_append_only BEFORE UPDATE OR DELETE ON internal_request_events FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE VIEW v_internal_requests AS
SELECT r.*,
       e.full_name AS assignee_name, jt.name AS assignee_job_title, e.email AS assignee_email, e.phone AS assignee_phone,
       b.name AS branch_name,
       extract(epoch FROM (r.received_at - r.sent_at))::bigint AS receive_seconds,
       extract(epoch FROM (r.responded_at - r.received_at))::bigint AS response_seconds,
       extract(epoch FROM (r.closed_at - r.sent_at))::bigint AS total_seconds,
       (r.due_at IS NOT NULL AND r.status <> 'cancelled'
         AND coalesce(r.responded_at, CASE WHEN r.status IN ('sent','received') THEN now() END) > r.due_at) AS is_late
  FROM internal_requests r
  JOIN employees e ON e.id = r.assignee_id
  LEFT JOIN job_titles jt ON jt.id = e.job_title_id
  JOIN branches b ON b.id = r.branch_id;
--> statement-breakpoint
COMMENT ON TABLE internal_requests IS 'طلبات ومهام الإدارة من المدير إلى الموظف، بأربع مراحل زمنية يسجلها النظام: الإرسال، الاستقبال، الرد، الإغلاق';
--> statement-breakpoint
COMMENT ON TABLE internal_request_events IS 'سجل أحداث الطلب (إضافة فقط): من فعل ماذا ومتى';
