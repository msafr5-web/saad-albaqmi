-- Baseline of the tables the running application already uses (created earlier with `drizzle-kit push`).
-- Every statement is IF NOT EXISTS so this migration is a no-op on an existing production database.
CREATE TABLE IF NOT EXISTS "cost_policies" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"draft" jsonb,
	"draft_version" integer DEFAULT 0 NOT NULL,
	"approved" jsonb,
	"approved_version" integer,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "education_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"record_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "education_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"branch_id" integer,
	"status" text NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "org_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_user_id" text,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"branch_id" integer,
	"linked_record_id" integer,
	"status" text NOT NULL,
	"invited_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "education_owner_kind_idx" ON "education_records" USING btree ("owner_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_members_live_email_idx" ON "org_members" USING btree (lower("email")) WHERE "org_members"."status" <> 'revoked';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_members_active_user_idx" ON "org_members" USING btree ("clerk_user_id") WHERE "org_members"."status" = 'active';