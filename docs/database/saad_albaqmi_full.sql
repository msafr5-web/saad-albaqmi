-- saad_albaqmi: complete schema (tables, constraints, triggers, views, reference data, Arabic table comments).
-- Generated from lib/db/drizzle by lib/db/scripts/bundle-sql.mjs. Requires PostgreSQL 15+ with the pgcrypto and btree_gist extensions.
-- Run inside the database "saad_albaqmi" (CREATE DATABASE saad_albaqmi ENCODING 'UTF8' TEMPLATE template0).
\set ON_ERROR_STOP on
BEGIN;
-- ===== 0000_baseline_legacy =====
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

CREATE TABLE IF NOT EXISTS "education_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"record_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

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

CREATE INDEX IF NOT EXISTS "education_owner_kind_idx" ON "education_records" USING btree ("owner_id","kind");
CREATE UNIQUE INDEX IF NOT EXISTS "org_members_live_email_idx" ON "org_members" USING btree (lower("email")) WHERE "org_members"."status" <> 'revoked';
CREATE UNIQUE INDEX IF NOT EXISTS "org_members_active_user_idx" ON "org_members" USING btree ("clerk_user_id") WHERE "org_members"."status" = 'active';
-- ===== 0001_extensions_and_functions =====
-- Extensions and pure functions required by the relational schema (applied BEFORE the tables are created).
-- pgcrypto: SHA-256 for the audit hash chain. btree_gist: exclusion constraints (no double booking).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Saudi VAT split. All three amounts are integers in halalas and share one rounding rule (half away from zero).
--   inclusive = true : `price` already contains VAT  -> net = price / (1 + rate), gross = price
--   inclusive = false: `price` is the net price       -> net = price,            gross = price + VAT
CREATE OR REPLACE FUNCTION vat_net(price bigint, vat_rate numeric, inclusive boolean)
RETURNS bigint LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN inclusive THEN round(price::numeric / (1 + vat_rate / 100.0))::bigint ELSE price END
$$;

CREATE OR REPLACE FUNCTION vat_gross(price bigint, vat_rate numeric, inclusive boolean)
RETURNS bigint LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN inclusive THEN price ELSE price + round(price::numeric * vat_rate / 100.0)::bigint END
$$;

-- Gap-free document numbers such as PO-2026-000123. The row lock is held until the calling transaction ends,
-- so a rolled-back transaction never burns a number.
CREATE OR REPLACE FUNCTION next_doc_no(p_prefix text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  y int := extract(year FROM now())::int;
  n bigint;
BEGIN
  INSERT INTO document_sequences (prefix, year, last_value) VALUES (p_prefix, y, 1)
  ON CONFLICT (prefix, year) DO UPDATE SET last_value = document_sequences.last_value + 1
  RETURNING last_value INTO n;
  RETURN p_prefix || '-' || y || '-' || lpad(n::text, 6, '0');
END
$$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: this table is append-only', TG_OP, TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END
$$;

-- ===== 0002_relational_schema =====
CREATE TABLE "branches" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "branches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"is_head_office" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"vat_number" text,
	"commercial_reg_no" text,
	"address" text,
	"phone" text,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "branches_status_ck" CHECK ("branches"."status" in ('active','inactive')),
	CONSTRAINT "branches_vat_format_ck" CHECK ("branches"."vat_number" is null or "branches"."vat_number" ~ '^3[0-9]{13}3$')
);

CREATE TABLE "document_sequences" (
	"prefix" text NOT NULL,
	"year" integer NOT NULL,
	"last_value" bigint DEFAULT 0 NOT NULL
);

CREATE TABLE "documents" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "documents_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"owner_type" text NOT NULL,
	"owner_id" bigint NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_size_ck" CHECK ("documents"."size_bytes" > 0),
	CONSTRAINT "documents_sha256_ck" CHECK ("documents"."sha256" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "notifications" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notifications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"member_id" integer NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"subject_type" text,
	"subject_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"email_sent_at" timestamp with time zone
);

CREATE TABLE "org_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"description" text,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "approval_delegations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "approval_delegations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"delegator_member_id" integer NOT NULL,
	"delegate_member_id" integer NOT NULL,
	"scope" text DEFAULT 'purchase_approval' NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"leave_request_id" bigint,
	"proposed_by" integer NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"status" text DEFAULT 'proposed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_delegations_self_ck" CHECK ("approval_delegations"."delegator_member_id" <> "approval_delegations"."delegate_member_id"),
	CONSTRAINT "approval_delegations_dates_ck" CHECK ("approval_delegations"."valid_to" >= "approval_delegations"."valid_from"),
	CONSTRAINT "approval_delegations_scope_ck" CHECK ("approval_delegations"."scope" in ('purchase_approval','finance_approval','all')),
	CONSTRAINT "approval_delegations_status_ck" CHECK ("approval_delegations"."status" in ('proposed','approved','rejected','revoked','expired')),
	CONSTRAINT "approval_delegations_approved_ck" CHECK ("approval_delegations"."status" <> 'approved' or ("approval_delegations"."approved_by" is not null and "approval_delegations"."approved_by" <> "approval_delegations"."proposed_by"))
);

CREATE TABLE "departments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "departments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"branch_id" bigint,
	"parent_id" bigint,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"manager_employee_id" bigint,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_status_ck" CHECK ("departments"."status" in ('active','inactive')),
	CONSTRAINT "departments_parent_ck" CHECK ("departments"."parent_id" is null or "departments"."parent_id" <> "departments"."id")
);

CREATE TABLE "employee_shifts" (
	"employee_id" bigint NOT NULL,
	"shift_id" bigint NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	CONSTRAINT "employee_shifts_employee_id_valid_from_pk" PRIMARY KEY("employee_id","valid_from"),
	CONSTRAINT "employee_shifts_dates_ck" CHECK ("employee_shifts"."valid_to" is null or "employee_shifts"."valid_to" >= "employee_shifts"."valid_from")
);

CREATE TABLE "employees" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "employees_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"employee_no" text NOT NULL,
	"full_name" text NOT NULL,
	"branch_id" bigint NOT NULL,
	"department_id" bigint,
	"job_title_id" bigint,
	"org_member_id" integer,
	"national_id" text,
	"nationality" text,
	"email" text,
	"phone" text,
	"iban" text,
	"employment_type" text DEFAULT 'full_time' NOT NULL,
	"hire_date" date NOT NULL,
	"termination_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"basic_salary_halalas" bigint DEFAULT 0 NOT NULL,
	"housing_allowance_halalas" bigint DEFAULT 0 NOT NULL,
	"transport_allowance_halalas" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_type_ck" CHECK ("employees"."employment_type" in ('full_time','part_time','contract','trainee')),
	CONSTRAINT "employees_status_ck" CHECK ("employees"."status" in ('active','on_leave','suspended','terminated')),
	CONSTRAINT "employees_salary_ck" CHECK ("employees"."basic_salary_halalas" >= 0 and "employees"."housing_allowance_halalas" >= 0 and "employees"."transport_allowance_halalas" >= 0),
	CONSTRAINT "employees_dates_ck" CHECK ("employees"."termination_date" is null or "employees"."termination_date" >= "employees"."hire_date"),
	CONSTRAINT "employees_iban_ck" CHECK ("employees"."iban" is null or "employees"."iban" ~ '^SA[0-9]{22}$')
);

CREATE TABLE "job_titles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "job_titles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"grade" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "leave_requests" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "leave_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"employee_id" bigint NOT NULL,
	"leave_type_id" bigint NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"requested_by" integer,
	"decided_by" integer,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_requests_dates_ck" CHECK ("leave_requests"."end_date" >= "leave_requests"."start_date"),
	CONSTRAINT "leave_requests_status_ck" CHECK ("leave_requests"."status" in ('pending','approved','rejected','cancelled'))
);

CREATE TABLE "leave_types" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "leave_types_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_paid" boolean DEFAULT true NOT NULL,
	"annual_days" integer
);

CREATE TABLE "payroll_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payroll_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"run_id" bigint NOT NULL,
	"employee_id" bigint NOT NULL,
	"basic_halalas" bigint NOT NULL,
	"allowances_halalas" bigint DEFAULT 0 NOT NULL,
	"deductions_halalas" bigint DEFAULT 0 NOT NULL,
	"net_halalas" bigint GENERATED ALWAYS AS (basic_halalas + allowances_halalas - deductions_halalas) STORED,
	"days_worked" numeric(5, 2),
	CONSTRAINT "payroll_lines_amounts_ck" CHECK ("payroll_lines"."basic_halalas" >= 0 and "payroll_lines"."allowances_halalas" >= 0 and "payroll_lines"."deductions_halalas" >= 0)
);

CREATE TABLE "payroll_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payroll_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"branch_id" bigint NOT NULL,
	"period_month" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_runs_month_ck" CHECK (extract(day from "payroll_runs"."period_month") = 1),
	CONSTRAINT "payroll_runs_status_ck" CHECK ("payroll_runs"."status" in ('draft','approved','paid'))
);

CREATE TABLE "shifts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "shifts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"grace_minutes" integer DEFAULT 10 NOT NULL,
	CONSTRAINT "shifts_grace_ck" CHECK ("shifts"."grace_minutes" between 0 and 120)
);

CREATE TABLE "asset_categories" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "asset_categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"parent_id" bigint,
	"name" text NOT NULL,
	"default_useful_life_months" integer
);

CREATE TABLE "asset_maintenance" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "asset_maintenance_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"asset_id" bigint NOT NULL,
	"due_date" date NOT NULL,
	"performed_at" date,
	"cost_halalas" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	CONSTRAINT "asset_maintenance_status_ck" CHECK ("asset_maintenance"."status" in ('scheduled','done','cancelled')),
	CONSTRAINT "asset_maintenance_cost_ck" CHECK ("asset_maintenance"."cost_halalas" >= 0)
);

CREATE TABLE "assets" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "assets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"asset_tag" text NOT NULL,
	"branch_id" bigint NOT NULL,
	"room_id" bigint,
	"category_id" bigint,
	"name" text NOT NULL,
	"serial_no" text,
	"specifications" text,
	"purchase_date" date,
	"purchase_cost_halalas" bigint NOT NULL,
	"salvage_percent" numeric(6, 3) DEFAULT 0 NOT NULL,
	"useful_life_months" integer,
	"source_supplier_invoice_line_id" bigint,
	"status" text DEFAULT 'in_service' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_cost_ck" CHECK ("assets"."purchase_cost_halalas" >= 0),
	CONSTRAINT "assets_salvage_ck" CHECK ("assets"."salvage_percent" between 0 and 100),
	CONSTRAINT "assets_life_ck" CHECK ("assets"."useful_life_months" is null or "assets"."useful_life_months" between 1 and 600),
	CONSTRAINT "assets_status_ck" CHECK ("assets"."status" in ('in_service','maintenance','retired','lost'))
);

CREATE TABLE "attendance_records" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "attendance_records_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"session_id" bigint NOT NULL,
	"student_id" bigint NOT NULL,
	"present" boolean NOT NULL,
	"method" text DEFAULT 'manual' NOT NULL,
	"recorded_by" integer,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_records_method_ck" CHECK ("attendance_records"."method" in ('manual','nfc','qr'))
);

CREATE TABLE "class_sessions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "class_sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"branch_id" bigint NOT NULL,
	"room_id" bigint NOT NULL,
	"instructor_id" bigint NOT NULL,
	"diploma_id" bigint NOT NULL,
	"subject_id" bigint,
	"title" text NOT NULL,
	"session_date" date NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"recurrence_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_sessions_time_ck" CHECK ("class_sessions"."end_time" > "class_sessions"."start_time"),
	CONSTRAINT "class_sessions_status_ck" CHECK ("class_sessions"."status" in ('scheduled','done','cancelled'))
);

CREATE TABLE "diplomas" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "diplomas_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"duration_months" integer NOT NULL,
	"total_hours" numeric(8, 1) NOT NULL,
	"admission_requirements" text,
	"price_halalas" bigint NOT NULL,
	"price_includes_vat" boolean NOT NULL,
	"vat_rate" numeric(6, 3) DEFAULT 15 NOT NULL,
	"net_price_halalas" bigint GENERATED ALWAYS AS (vat_net(price_halalas, vat_rate, price_includes_vat)) STORED,
	"gross_price_halalas" bigint GENERATED ALWAYS AS (vat_gross(price_halalas, vat_rate, price_includes_vat)) STORED,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diplomas_duration_ck" CHECK ("diplomas"."duration_months" > 0 and "diplomas"."total_hours" > 0),
	CONSTRAINT "diplomas_price_ck" CHECK ("diplomas"."price_halalas" >= 0 and "diplomas"."vat_rate" between 0 and 100),
	CONSTRAINT "diplomas_status_ck" CHECK ("diplomas"."status" in ('active','closed','draft'))
);

CREATE TABLE "electricity_meters" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "electricity_meters_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"branch_id" bigint NOT NULL,
	"meter_no" text NOT NULL,
	"description" text,
	"is_sub_meter" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "electricity_meters_status_ck" CHECK ("electricity_meters"."status" in ('active','inactive'))
);

CREATE TABLE "grades" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "grades_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"student_id" bigint NOT NULL,
	"subject_id" bigint NOT NULL,
	"assessment_type" text NOT NULL,
	"score" numeric(6, 2) NOT NULL,
	"max_score" numeric(6, 2) NOT NULL,
	"assessed_on" date NOT NULL,
	"recorded_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grades_type_ck" CHECK ("grades"."assessment_type" in ('quiz','midterm','final','practical','project')),
	CONSTRAINT "grades_score_ck" CHECK ("grades"."max_score" > 0 and "grades"."score" >= 0 and "grades"."score" <= "grades"."max_score")
);

CREATE TABLE "instructor_evaluations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "instructor_evaluations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"instructor_id" bigint NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"teaching_score" integer NOT NULL,
	"punctuality_score" integer NOT NULL,
	"student_feedback_score" integer,
	"notes" text,
	"evaluated_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instructor_evaluations_scores_ck" CHECK ("instructor_evaluations"."teaching_score" between 0 and 100 and "instructor_evaluations"."punctuality_score" between 0 and 100 and ("instructor_evaluations"."student_feedback_score" is null or "instructor_evaluations"."student_feedback_score" between 0 and 100)),
	CONSTRAINT "instructor_evaluations_period_ck" CHECK ("instructor_evaluations"."period_end" >= "instructor_evaluations"."period_start")
);

CREATE TABLE "instructor_subjects" (
	"instructor_id" bigint NOT NULL,
	"subject_id" bigint NOT NULL,
	CONSTRAINT "instructor_subjects_instructor_id_subject_id_pk" PRIMARY KEY("instructor_id","subject_id")
);

CREATE TABLE "instructors" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "instructors_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"instructor_no" text NOT NULL,
	"branch_id" bigint NOT NULL,
	"employee_id" bigint,
	"full_name" text NOT NULL,
	"qualification" text,
	"hourly_rate_halalas" bigint NOT NULL,
	"weekly_hours" numeric(5, 1) NOT NULL,
	"org_member_id" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instructors_amounts_ck" CHECK ("instructors"."hourly_rate_halalas" >= 0 and "instructors"."weekly_hours" between 0 and 168),
	CONSTRAINT "instructors_status_ck" CHECK ("instructors"."status" in ('active','inactive'))
);

CREATE TABLE "levels" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "levels_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"diploma_id" bigint NOT NULL,
	"level_no" integer NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "levels_no_ck" CHECK ("levels"."level_no" >= 1)
);

CREATE TABLE "rooms" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rooms_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"branch_id" bigint NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"room_type" text NOT NULL,
	"area_m2" numeric(10, 2) NOT NULL,
	"capacity" integer NOT NULL,
	"power_kw" numeric(8, 2),
	"meter_id" bigint,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rooms_type_ck" CHECK ("rooms"."room_type" in ('classroom','lab','workshop','office')),
	CONSTRAINT "rooms_dimensions_ck" CHECK ("rooms"."area_m2" > 0 and "rooms"."capacity" > 0 and ("rooms"."power_kw" is null or "rooms"."power_kw" >= 0)),
	CONSTRAINT "rooms_status_ck" CHECK ("rooms"."status" in ('active','maintenance','inactive'))
);

CREATE TABLE "session_recurrences" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "session_recurrences_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"branch_id" bigint NOT NULL,
	"room_id" bigint NOT NULL,
	"instructor_id" bigint NOT NULL,
	"diploma_id" bigint NOT NULL,
	"subject_id" bigint,
	"weekdays" integer[] NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_recurrences_time_ck" CHECK ("session_recurrences"."end_time" > "session_recurrences"."start_time"),
	CONSTRAINT "session_recurrences_dates_ck" CHECK ("session_recurrences"."valid_to" >= "session_recurrences"."valid_from"),
	CONSTRAINT "session_recurrences_weekdays_ck" CHECK (cardinality("session_recurrences"."weekdays") between 1 and 7 and "session_recurrences"."weekdays" <@ array[1,2,3,4,5,6,7])
);

CREATE TABLE "session_students" (
	"session_id" bigint NOT NULL,
	"student_id" bigint NOT NULL,
	CONSTRAINT "session_students_session_id_student_id_pk" PRIMARY KEY("session_id","student_id")
);

CREATE TABLE "student_subjects" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "student_subjects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"student_id" bigint NOT NULL,
	"subject_id" bigint NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'enrolled' NOT NULL,
	CONSTRAINT "student_subjects_status_ck" CHECK ("student_subjects"."status" in ('enrolled','passed','failed','withdrawn'))
);

CREATE TABLE "students" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "students_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"student_no" text NOT NULL,
	"branch_id" bigint NOT NULL,
	"diploma_id" bigint NOT NULL,
	"current_level_id" bigint,
	"full_name" text NOT NULL,
	"national_id" text,
	"nationality" text,
	"date_of_birth" date,
	"email" text,
	"phone" text,
	"guardian_name" text,
	"guardian_phone" text,
	"org_member_id" integer,
	"status" text DEFAULT 'enrolled' NOT NULL,
	"enrolled_at" date DEFAULT current_date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "students_status_ck" CHECK ("students"."status" in ('enrolled','graduated','suspended','withdrawn')),
	CONSTRAINT "students_email_ck" CHECK ("students"."email" is null or "students"."email" ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);

CREATE TABLE "subject_prerequisites" (
	"subject_id" bigint NOT NULL,
	"prerequisite_id" bigint NOT NULL,
	CONSTRAINT "subject_prerequisites_subject_id_prerequisite_id_pk" PRIMARY KEY("subject_id","prerequisite_id"),
	CONSTRAINT "subject_prerequisites_self_ck" CHECK ("subject_prerequisites"."subject_id" <> "subject_prerequisites"."prerequisite_id")
);

CREATE TABLE "subjects" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "subjects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"diploma_id" bigint NOT NULL,
	"level_id" bigint NOT NULL,
	"name" text NOT NULL,
	"price_halalas" bigint NOT NULL,
	"price_includes_vat" boolean NOT NULL,
	"vat_rate" numeric(6, 3) DEFAULT 15 NOT NULL,
	"net_price_halalas" bigint GENERATED ALWAYS AS (vat_net(price_halalas, vat_rate, price_includes_vat)) STORED,
	"gross_price_halalas" bigint GENERATED ALWAYS AS (vat_gross(price_halalas, vat_rate, price_includes_vat)) STORED,
	"hours" numeric(6, 1) NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "subjects_amounts_ck" CHECK ("subjects"."price_halalas" >= 0 and "subjects"."hours" >= 0.5 and "subjects"."vat_rate" between 0 and 100),
	CONSTRAINT "subjects_status_ck" CHECK ("subjects"."status" in ('active','closed'))
);

CREATE TABLE "branch_budgets" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "branch_budgets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"branch_id" bigint NOT NULL,
	"period_month" date NOT NULL,
	"category_id" bigint,
	"amount_halalas" bigint NOT NULL,
	"warn_at_percent" integer DEFAULT 80 NOT NULL,
	"approved_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_budgets_uq" UNIQUE NULLS NOT DISTINCT("branch_id","period_month","category_id"),
	CONSTRAINT "branch_budgets_month_ck" CHECK (extract(day from "branch_budgets"."period_month") = 1),
	CONSTRAINT "branch_budgets_amount_ck" CHECK ("branch_budgets"."amount_halalas" >= 0 and "branch_budgets"."warn_at_percent" between 1 and 100)
);

CREATE TABLE "cost_report_snapshots" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cost_report_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"policy_version" integer NOT NULL,
	"result" jsonb NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "expense_categories" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "expense_categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"parent_id" bigint,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_petty" boolean DEFAULT false NOT NULL
);

CREATE TABLE "expenses" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "expenses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"expense_no" text NOT NULL,
	"branch_id" bigint NOT NULL,
	"category_id" bigint NOT NULL,
	"expense_date" date NOT NULL,
	"description" text NOT NULL,
	"net_halalas" bigint NOT NULL,
	"vat_halalas" bigint DEFAULT 0 NOT NULL,
	"gross_halalas" bigint GENERATED ALWAYS AS (net_halalas + vat_halalas) STORED,
	"source" text DEFAULT 'manual' NOT NULL,
	"supplier_invoice_id" bigint,
	"status" text DEFAULT 'pending_otp' NOT NULL,
	"created_by" integer NOT NULL,
	"confirmed_at" timestamp with time zone,
	"reverses_expense_id" bigint,
	"reversal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_amounts_ck" CHECK ("expenses"."net_halalas" >= 0 and "expenses"."vat_halalas" >= 0),
	CONSTRAINT "expenses_source_ck" CHECK ("expenses"."source" in ('manual','supplier_invoice','payroll','utility')),
	CONSTRAINT "expenses_status_ck" CHECK ("expenses"."status" in ('pending_otp','confirmed','reversed','rejected')),
	CONSTRAINT "expenses_confirmed_ck" CHECK ("expenses"."status" <> 'confirmed' or "expenses"."confirmed_at" is not null)
);

CREATE TABLE "installments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "installments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"student_id" bigint NOT NULL,
	"sales_invoice_id" bigint,
	"seq" integer NOT NULL,
	"due_date" date NOT NULL,
	"amount_halalas" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installments_amount_ck" CHECK ("installments"."amount_halalas" > 0),
	CONSTRAINT "installments_status_ck" CHECK ("installments"."status" in ('pending','partial','paid','cancelled'))
);

CREATE TABLE "payment_allocations" (
	"payment_id" bigint NOT NULL,
	"installment_id" bigint NOT NULL,
	"amount_halalas" bigint NOT NULL,
	CONSTRAINT "payment_allocations_payment_id_installment_id_pk" PRIMARY KEY("payment_id","installment_id"),
	CONSTRAINT "payment_allocations_amount_ck" CHECK ("payment_allocations"."amount_halalas" > 0)
);

CREATE TABLE "payments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"receipt_no" text NOT NULL,
	"branch_id" bigint NOT NULL,
	"student_id" bigint NOT NULL,
	"amount_halalas" bigint NOT NULL,
	"paid_on" date NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"status" text DEFAULT 'pending_otp' NOT NULL,
	"collected_by" integer NOT NULL,
	"confirmed_at" timestamp with time zone,
	"reverses_payment_id" bigint,
	"reversal_reason" text,
	"receipt_emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_ck" CHECK ("payments"."amount_halalas" > 0),
	CONSTRAINT "payments_method_ck" CHECK ("payments"."method" in ('cash','bank_transfer','card','pos')),
	CONSTRAINT "payments_status_ck" CHECK ("payments"."status" in ('pending_otp','confirmed','reversed','rejected')),
	CONSTRAINT "payments_confirmed_ck" CHECK ("payments"."status" <> 'confirmed' or "payments"."confirmed_at" is not null),
	CONSTRAINT "payments_reversal_ck" CHECK ("payments"."reverses_payment_id" is null or "payments"."reversal_reason" is not null)
);

CREATE TABLE "sales_invoice_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_invoice_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"invoice_id" bigint NOT NULL,
	"line_no" integer NOT NULL,
	"description" text NOT NULL,
	"diploma_id" bigint,
	"subject_id" bigint,
	"quantity" numeric(14, 3) DEFAULT 1 NOT NULL,
	"unit_price_halalas" bigint NOT NULL,
	"discount_halalas" bigint DEFAULT 0 NOT NULL,
	"vat_rate" numeric(6, 3) DEFAULT 15 NOT NULL,
	"net_halalas" bigint GENERATED ALWAYS AS (round(quantity * unit_price_halalas)::bigint - discount_halalas) STORED,
	"vat_halalas" bigint GENERATED ALWAYS AS (round((round(quantity * unit_price_halalas)::bigint - discount_halalas) * vat_rate / 100)::bigint) STORED,
	CONSTRAINT "sales_invoice_lines_amounts_ck" CHECK ("sales_invoice_lines"."quantity" > 0 and "sales_invoice_lines"."unit_price_halalas" >= 0 and "sales_invoice_lines"."discount_halalas" >= 0 and "sales_invoice_lines"."vat_rate" between 0 and 100)
);

CREATE TABLE "sales_invoices" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_invoices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"invoice_no" text NOT NULL,
	"invoice_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" bigint NOT NULL,
	"student_id" bigint,
	"customer_name" text NOT NULL,
	"customer_vat_number" text,
	"invoice_type" text DEFAULT 'simplified' NOT NULL,
	"issue_date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"net_halalas" bigint DEFAULT 0 NOT NULL,
	"vat_halalas" bigint DEFAULT 0 NOT NULL,
	"gross_halalas" bigint GENERATED ALWAYS AS (net_halalas + vat_halalas) STORED,
	"zatca_status" text DEFAULT 'not_submitted' NOT NULL,
	"zatca_hash" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_invoices_type_ck" CHECK ("sales_invoices"."invoice_type" in ('standard','simplified','credit_note')),
	CONSTRAINT "sales_invoices_status_ck" CHECK ("sales_invoices"."status" in ('draft','issued','cancelled')),
	CONSTRAINT "sales_invoices_amounts_ck" CHECK ("sales_invoices"."invoice_type" = 'credit_note' or ("sales_invoices"."net_halalas" >= 0 and "sales_invoices"."vat_halalas" >= 0)),
	CONSTRAINT "sales_invoices_vat_ck" CHECK ("sales_invoices"."customer_vat_number" is null or "sales_invoices"."customer_vat_number" ~ '^3[0-9]{13}3$'),
	CONSTRAINT "sales_invoices_standard_ck" CHECK ("sales_invoices"."invoice_type" <> 'standard' or "sales_invoices"."customer_vat_number" is not null),
	CONSTRAINT "sales_invoices_zatca_ck" CHECK ("sales_invoices"."zatca_status" in ('not_submitted','reported','cleared','rejected'))
);

CREATE TABLE "tax_rates" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tax_rates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"rate" numeric(6, 3) NOT NULL,
	"category" text DEFAULT 'standard' NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	CONSTRAINT "tax_rates_rate_ck" CHECK ("tax_rates"."rate" between 0 and 100),
	CONSTRAINT "tax_rates_category_ck" CHECK ("tax_rates"."category" in ('standard','zero_rated','exempt')),
	CONSTRAINT "tax_rates_dates_ck" CHECK ("tax_rates"."valid_to" is null or "tax_rates"."valid_to" >= "tax_rates"."valid_from")
);

CREATE TABLE "utility_invoices" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "utility_invoices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"branch_id" bigint NOT NULL,
	"meter_id" bigint NOT NULL,
	"bill_month" date NOT NULL,
	"kwh" numeric(14, 2) NOT NULL,
	"net_halalas" bigint NOT NULL,
	"vat_halalas" bigint DEFAULT 0 NOT NULL,
	"bill_no" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "utility_invoices_month_ck" CHECK (extract(day from "utility_invoices"."bill_month") = 1),
	CONSTRAINT "utility_invoices_amounts_ck" CHECK ("utility_invoices"."kwh" >= 0 and "utility_invoices"."net_halalas" >= 0 and "utility_invoices"."vat_halalas" >= 0)
);

CREATE TABLE "item_categories" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "item_categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"parent_id" bigint,
	"code" text NOT NULL,
	"name" text NOT NULL
);

CREATE TABLE "items" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"item_code" text NOT NULL,
	"name" text NOT NULL,
	"category_id" bigint NOT NULL,
	"unit_id" bigint NOT NULL,
	"item_type" text DEFAULT 'consumable' NOT NULL,
	"valuation_method" text DEFAULT 'weighted_average' NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_type_ck" CHECK ("items"."item_type" in ('consumable','asset','service')),
	CONSTRAINT "items_valuation_ck" CHECK ("items"."valuation_method" in ('weighted_average','fifo'))
);

CREATE TABLE "reorder_alerts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reorder_alerts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"warehouse_id" bigint NOT NULL,
	"item_id" bigint NOT NULL,
	"qty_at_trigger" numeric(14, 3) NOT NULL,
	"min_qty" numeric(14, 3) NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"escalated_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"purchase_request_id" bigint,
	CONSTRAINT "reorder_alerts_status_ck" CHECK ("reorder_alerts"."status" in ('open','in_progress','closed','dismissed'))
);

CREATE TABLE "stock_count_lines" (
	"count_id" bigint NOT NULL,
	"item_id" bigint NOT NULL,
	"system_qty" numeric(14, 3) NOT NULL,
	"counted_qty" numeric(14, 3) NOT NULL,
	"reason" text,
	CONSTRAINT "stock_count_lines_count_id_item_id_pk" PRIMARY KEY("count_id","item_id"),
	CONSTRAINT "stock_count_lines_ck" CHECK ("stock_count_lines"."counted_qty" >= 0 and ("stock_count_lines"."counted_qty" = "stock_count_lines"."system_qty" or "stock_count_lines"."reason" is not null))
);

CREATE TABLE "stock_counts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stock_counts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"warehouse_id" bigint NOT NULL,
	"count_date" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"counted_by" integer NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "stock_counts_status_ck" CHECK ("stock_counts"."status" in ('open','closed','cancelled'))
);

CREATE TABLE "stock_levels" (
	"warehouse_id" bigint NOT NULL,
	"item_id" bigint NOT NULL,
	"min_qty" numeric(14, 3) NOT NULL,
	"max_qty" numeric(14, 3),
	"reorder_qty" numeric(14, 3),
	"lead_time_days" integer,
	"set_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_levels_warehouse_id_item_id_pk" PRIMARY KEY("warehouse_id","item_id"),
	CONSTRAINT "stock_levels_qty_ck" CHECK ("stock_levels"."min_qty" >= 0 and ("stock_levels"."max_qty" is null or "stock_levels"."max_qty" >= "stock_levels"."min_qty") and ("stock_levels"."reorder_qty" is null or "stock_levels"."reorder_qty" > 0))
);

CREATE TABLE "stock_movements" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stock_movements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"movement_no" text NOT NULL,
	"warehouse_id" bigint NOT NULL,
	"item_id" bigint NOT NULL,
	"movement_type" text NOT NULL,
	"qty_delta" numeric(14, 3) NOT NULL,
	"unit_cost_halalas" bigint,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ref_type" text,
	"ref_id" bigint,
	"issued_to_room_id" bigint,
	"issued_to_department_id" bigint,
	"purpose" text,
	"created_by" integer NOT NULL,
	"otp_challenge_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_type_ck" CHECK ("stock_movements"."movement_type" in ('opening','receipt','issue','transfer_out','transfer_in','adjustment','return_to_supplier','return_from_room')),
	CONSTRAINT "stock_movements_delta_ck" CHECK ("stock_movements"."qty_delta" <> 0),
	CONSTRAINT "stock_movements_sign_ck" CHECK (("stock_movements"."movement_type" in ('opening','receipt','transfer_in','return_from_room') and "stock_movements"."qty_delta" > 0) or ("stock_movements"."movement_type" in ('issue','transfer_out','return_to_supplier') and "stock_movements"."qty_delta" < 0) or "stock_movements"."movement_type" = 'adjustment'),
	CONSTRAINT "stock_movements_issue_target_ck" CHECK ("stock_movements"."movement_type" <> 'issue' or "stock_movements"."issued_to_room_id" is not null or "stock_movements"."issued_to_department_id" is not null),
	CONSTRAINT "stock_movements_cost_ck" CHECK ("stock_movements"."unit_cost_halalas" is null or "stock_movements"."unit_cost_halalas" >= 0)
);

CREATE TABLE "stock_transfer_lines" (
	"transfer_id" bigint NOT NULL,
	"item_id" bigint NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"received_qty" numeric(14, 3),
	CONSTRAINT "stock_transfer_lines_transfer_id_item_id_pk" PRIMARY KEY("transfer_id","item_id"),
	CONSTRAINT "stock_transfer_lines_qty_ck" CHECK ("stock_transfer_lines"."qty" > 0 and ("stock_transfer_lines"."received_qty" is null or "stock_transfer_lines"."received_qty" >= 0))
);

CREATE TABLE "stock_transfers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stock_transfers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"transfer_no" text NOT NULL,
	"from_warehouse_id" bigint NOT NULL,
	"to_warehouse_id" bigint NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"requested_by" integer NOT NULL,
	"shipped_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_transfers_wh_ck" CHECK ("stock_transfers"."from_warehouse_id" <> "stock_transfers"."to_warehouse_id"),
	CONSTRAINT "stock_transfers_status_ck" CHECK ("stock_transfers"."status" in ('draft','in_transit','received','cancelled'))
);

CREATE TABLE "units" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "units_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL
);

CREATE TABLE "warehouses" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "warehouses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"branch_id" bigint NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"keeper_member_id" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouses_status_ck" CHECK ("warehouses"."status" in ('active','inactive'))
);

CREATE TABLE "direct_purchase_policies" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "direct_purchase_policies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"max_amount_halalas" bigint NOT NULL,
	"max_qty" numeric(14, 3),
	"monthly_cap_halalas" bigint,
	"anti_split_window_days" integer DEFAULT 30 NOT NULL,
	"conditions" text,
	"valid_from" date NOT NULL,
	"set_by" integer NOT NULL,
	CONSTRAINT "direct_purchase_policies_ck" CHECK ("direct_purchase_policies"."max_amount_halalas" > 0 and "direct_purchase_policies"."anti_split_window_days" between 1 and 365)
);

CREATE TABLE "goods_receipt_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "goods_receipt_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"grn_id" bigint NOT NULL,
	"po_line_id" bigint NOT NULL,
	"qty_received" numeric(14, 3) NOT NULL,
	"qty_accepted" numeric(14, 3) NOT NULL,
	"qty_rejected" numeric(14, 3) GENERATED ALWAYS AS (qty_received - qty_accepted) STORED,
	"quality_result" text DEFAULT 'accepted' NOT NULL,
	"quality_notes" text,
	CONSTRAINT "goods_receipt_lines_qty_ck" CHECK ("goods_receipt_lines"."qty_received" > 0 and "goods_receipt_lines"."qty_accepted" >= 0 and "goods_receipt_lines"."qty_accepted" <= "goods_receipt_lines"."qty_received"),
	CONSTRAINT "goods_receipt_lines_quality_ck" CHECK ("goods_receipt_lines"."quality_result" in ('accepted','accepted_with_notes','rejected')),
	CONSTRAINT "goods_receipt_lines_rejected_ck" CHECK ("goods_receipt_lines"."quality_result" <> 'rejected' or "goods_receipt_lines"."qty_accepted" = 0)
);

CREATE TABLE "goods_receipts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "goods_receipts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"grn_no" text NOT NULL,
	"po_id" bigint NOT NULL,
	"warehouse_id" bigint NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"received_by" integer NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivery_note_no" text,
	"notes" text,
	CONSTRAINT "goods_receipts_status_ck" CHECK ("goods_receipts"."status" in ('draft','confirmed','cancelled'))
);

CREATE TABLE "match_tolerances" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "match_tolerances_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"category_id" bigint,
	"price_percent" numeric(6, 3) DEFAULT 0 NOT NULL,
	"qty_percent" numeric(6, 3) DEFAULT 0 NOT NULL,
	"valid_from" date NOT NULL,
	"set_by" integer,
	CONSTRAINT "match_tolerances_uq" UNIQUE NULLS NOT DISTINCT("category_id","valid_from"),
	CONSTRAINT "match_tolerances_ck" CHECK ("match_tolerances"."price_percent" between 0 and 100 and "match_tolerances"."qty_percent" between 0 and 100)
);

CREATE TABLE "procurement_exceptions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "procurement_exceptions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"pr_id" bigint NOT NULL,
	"exception_type" text NOT NULL,
	"reason" text NOT NULL,
	"requested_by" integer NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "procurement_exceptions_type_ck" CHECK ("procurement_exceptions"."exception_type" in ('single_source','late_responses','direct_small','emergency')),
	CONSTRAINT "procurement_exceptions_reason_ck" CHECK (length(trim("procurement_exceptions"."reason")) >= 10),
	CONSTRAINT "procurement_exceptions_approver_ck" CHECK ("procurement_exceptions"."approved_by" is null or "procurement_exceptions"."approved_by" <> "procurement_exceptions"."requested_by")
);

CREATE TABLE "purchase_limits" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_limits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"branch_id" bigint,
	"period" text NOT NULL,
	"max_amount_halalas" bigint NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"set_by" integer NOT NULL,
	CONSTRAINT "purchase_limits_period_ck" CHECK ("purchase_limits"."period" in ('weekly','monthly')),
	CONSTRAINT "purchase_limits_amount_ck" CHECK ("purchase_limits"."max_amount_halalas" > 0)
);

CREATE TABLE "purchase_order_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_order_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"po_id" bigint NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" bigint NOT NULL,
	"description" text,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_price_halalas" bigint NOT NULL,
	"vat_rate" numeric(6, 3) DEFAULT 15 NOT NULL,
	"net_halalas" bigint GENERATED ALWAYS AS (round(quantity * unit_price_halalas)::bigint) STORED,
	"vat_halalas" bigint GENERATED ALWAYS AS (round(round(quantity * unit_price_halalas) * vat_rate / 100)::bigint) STORED,
	CONSTRAINT "purchase_order_lines_amounts_ck" CHECK ("purchase_order_lines"."quantity" > 0 and "purchase_order_lines"."unit_price_halalas" >= 0 and "purchase_order_lines"."vat_rate" between 0 and 100)
);

CREATE TABLE "purchase_orders" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_orders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"po_no" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_po_id" bigint,
	"pr_id" bigint NOT NULL,
	"rfq_id" bigint,
	"exception_id" bigint,
	"branch_id" bigint NOT NULL,
	"warehouse_id" bigint NOT NULL,
	"supplier_id" bigint NOT NULL,
	"entity_name" text NOT NULL,
	"entity_vat_number" text NOT NULL,
	"supplier_vat_number" text NOT NULL,
	"issue_date" date NOT NULL,
	"delivery_date" date,
	"terms" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"net_halalas" bigint DEFAULT 0 NOT NULL,
	"vat_halalas" bigint DEFAULT 0 NOT NULL,
	"gross_halalas" bigint GENERATED ALWAYS AS (net_halalas + vat_halalas) STORED,
	"prepared_by" integer NOT NULL,
	"prepared_at" timestamp with time zone,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"approved_via_delegation_id" bigint,
	"sent_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"document_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_status_ck" CHECK ("purchase_orders"."status" in ('draft','prepared','approved','sent','acknowledged','partially_received','received','closed','cancelled')),
	CONSTRAINT "purchase_orders_supplier_vat_ck" CHECK ("purchase_orders"."supplier_vat_number" ~ '^3[0-9]{13}3$'),
	CONSTRAINT "purchase_orders_entity_vat_ck" CHECK ("purchase_orders"."entity_vat_number" ~ '^3[0-9]{13}3$'),
	CONSTRAINT "purchase_orders_amounts_ck" CHECK ("purchase_orders"."net_halalas" >= 0 and "purchase_orders"."vat_halalas" >= 0),
	CONSTRAINT "purchase_orders_segregation_ck" CHECK ("purchase_orders"."approved_by" is null or "purchase_orders"."approved_by" <> "purchase_orders"."prepared_by"),
	CONSTRAINT "purchase_orders_approval_ck" CHECK ("purchase_orders"."status" not in ('approved','sent','acknowledged','partially_received','received','closed') or ("purchase_orders"."approved_by" is not null and "purchase_orders"."approved_at" is not null)),
	CONSTRAINT "purchase_orders_source_ck" CHECK ("purchase_orders"."rfq_id" is not null or "purchase_orders"."exception_id" is not null),
	CONSTRAINT "purchase_orders_version_ck" CHECK ("purchase_orders"."version" >= 1 and ("purchase_orders"."version" = 1) = ("purchase_orders"."supersedes_po_id" is null))
);

CREATE TABLE "purchase_request_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_request_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"pr_id" bigint NOT NULL,
	"item_id" bigint NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"notes" text,
	CONSTRAINT "purchase_request_lines_qty_ck" CHECK ("purchase_request_lines"."qty" > 0)
);

CREATE TABLE "purchase_requests" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"pr_no" text NOT NULL,
	"branch_id" bigint NOT NULL,
	"warehouse_id" bigint NOT NULL,
	"path" text DEFAULT 'standard' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"alert_id" bigint,
	"reason" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"requested_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_requests_path_ck" CHECK ("purchase_requests"."path" in ('standard','direct_small')),
	CONSTRAINT "purchase_requests_source_ck" CHECK ("purchase_requests"."source" in ('alert','manual')),
	CONSTRAINT "purchase_requests_status_ck" CHECK ("purchase_requests"."status" in ('draft','submitted','rfq','awarded','po_issued','closed','cancelled'))
);

CREATE TABLE "quotation_evaluations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "quotation_evaluations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"quotation_id" bigint NOT NULL,
	"evaluated_by" integer NOT NULL,
	"technical_score" integer NOT NULL,
	"quality_score" integer NOT NULL,
	"commercial_score" integer NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotation_evaluations_scores_ck" CHECK ("quotation_evaluations"."technical_score" between 0 and 100 and "quotation_evaluations"."quality_score" between 0 and 100 and "quotation_evaluations"."commercial_score" between 0 and 100)
);

CREATE TABLE "quotation_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "quotation_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"quotation_id" bigint NOT NULL,
	"item_id" bigint NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_price_halalas" bigint NOT NULL,
	"vat_rate" numeric(6, 3) DEFAULT 15 NOT NULL,
	"net_halalas" bigint GENERATED ALWAYS AS (round(quantity * unit_price_halalas)::bigint) STORED,
	"vat_halalas" bigint GENERATED ALWAYS AS (round(round(quantity * unit_price_halalas) * vat_rate / 100)::bigint) STORED,
	CONSTRAINT "quotation_lines_amounts_ck" CHECK ("quotation_lines"."quantity" > 0 and "quotation_lines"."unit_price_halalas" >= 0 and "quotation_lines"."vat_rate" between 0 and 100)
);

CREATE TABLE "quotations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "quotations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"rfq_id" bigint NOT NULL,
	"supplier_id" bigint NOT NULL,
	"supplier_vat_number" text NOT NULL,
	"quote_ref" text,
	"quote_date" date NOT NULL,
	"valid_until" date,
	"delivery_days" integer,
	"payment_terms" text,
	"quality_notes" text,
	"entered_by" integer NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotations_vat_ck" CHECK ("quotations"."supplier_vat_number" ~ '^3[0-9]{13}3$'),
	CONSTRAINT "quotations_status_ck" CHECK ("quotations"."status" in ('submitted','withdrawn','disqualified')),
	CONSTRAINT "quotations_delivery_ck" CHECK ("quotations"."delivery_days" is null or "quotations"."delivery_days" >= 0)
);

CREATE TABLE "rfq_awards" (
	"rfq_id" bigint PRIMARY KEY NOT NULL,
	"quotation_id" bigint NOT NULL,
	"is_lowest_price" boolean NOT NULL,
	"justification" text,
	"exception_id" bigint,
	"recommended_by" integer NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rfq_awards_justification_ck" CHECK ("rfq_awards"."is_lowest_price" or length(trim(coalesce("rfq_awards"."justification", ''))) >= 10),
	CONSTRAINT "rfq_awards_approver_ck" CHECK ("rfq_awards"."approved_by" is null or "rfq_awards"."approved_by" <> "rfq_awards"."recommended_by")
);

CREATE TABLE "rfq_suppliers" (
	"rfq_id" bigint NOT NULL,
	"supplier_id" bigint NOT NULL,
	"sent_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	CONSTRAINT "rfq_suppliers_rfq_id_supplier_id_pk" PRIMARY KEY("rfq_id","supplier_id")
);

CREATE TABLE "rfqs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rfqs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"rfq_no" text NOT NULL,
	"pr_id" bigint NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rfqs_status_ck" CHECK ("rfqs"."status" in ('open','evaluating','awarded','cancelled'))
);

CREATE TABLE "supplier_categories" (
	"supplier_id" bigint NOT NULL,
	"category_id" bigint NOT NULL,
	CONSTRAINT "supplier_categories_supplier_id_category_id_pk" PRIMARY KEY("supplier_id","category_id")
);

CREATE TABLE "supplier_invoice_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "supplier_invoice_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"invoice_id" bigint NOT NULL,
	"po_line_id" bigint,
	"item_id" bigint,
	"description" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_price_halalas" bigint NOT NULL,
	"vat_rate" numeric(6, 3) DEFAULT 15 NOT NULL,
	"net_halalas" bigint GENERATED ALWAYS AS (round(quantity * unit_price_halalas)::bigint) STORED,
	"vat_halalas" bigint GENERATED ALWAYS AS (round(round(quantity * unit_price_halalas) * vat_rate / 100)::bigint) STORED,
	"classification" text DEFAULT 'expense' NOT NULL,
	CONSTRAINT "supplier_invoice_lines_amounts_ck" CHECK ("supplier_invoice_lines"."quantity" > 0 and "supplier_invoice_lines"."unit_price_halalas" >= 0 and "supplier_invoice_lines"."vat_rate" between 0 and 100),
	CONSTRAINT "supplier_invoice_lines_class_ck" CHECK ("supplier_invoice_lines"."classification" in ('expense','stock','asset'))
);

CREATE TABLE "supplier_invoices" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "supplier_invoices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"supplier_id" bigint NOT NULL,
	"supplier_invoice_no" text NOT NULL,
	"supplier_vat_number" text NOT NULL,
	"po_id" bigint,
	"branch_id" bigint NOT NULL,
	"invoice_date" date NOT NULL,
	"net_halalas" bigint NOT NULL,
	"vat_halalas" bigint NOT NULL,
	"gross_halalas" bigint GENERATED ALWAYS AS (net_halalas + vat_halalas) STORED,
	"status" text DEFAULT 'received' NOT NULL,
	"match_result" jsonb,
	"matched_at" timestamp with time zone,
	"approved_by" integer,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_invoices_vat_ck" CHECK ("supplier_invoices"."supplier_vat_number" ~ '^3[0-9]{13}3$'),
	CONSTRAINT "supplier_invoices_amounts_ck" CHECK ("supplier_invoices"."net_halalas" >= 0 and "supplier_invoices"."vat_halalas" >= 0),
	CONSTRAINT "supplier_invoices_status_ck" CHECK ("supplier_invoices"."status" in ('received','matched','mismatch','approved','paid','disputed')),
	CONSTRAINT "supplier_invoices_approved_ck" CHECK ("supplier_invoices"."status" not in ('approved','paid') or "supplier_invoices"."approved_by" is not null)
);

CREATE TABLE "supplier_payments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "supplier_payments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"supplier_invoice_id" bigint NOT NULL,
	"amount_halalas" bigint NOT NULL,
	"paid_on" date NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"status" text DEFAULT 'pending_otp' NOT NULL,
	"paid_by" integer NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "supplier_payments_amount_ck" CHECK ("supplier_payments"."amount_halalas" > 0),
	CONSTRAINT "supplier_payments_method_ck" CHECK ("supplier_payments"."method" in ('bank_transfer','cheque','cash')),
	CONSTRAINT "supplier_payments_status_ck" CHECK ("supplier_payments"."status" in ('pending_otp','confirmed','reversed'))
);

CREATE TABLE "suppliers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "suppliers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"supplier_no" text NOT NULL,
	"legal_name" text NOT NULL,
	"vat_number" text,
	"commercial_reg_no" text,
	"address" text,
	"city" text,
	"email" text,
	"phone" text,
	"iban" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"rating" numeric(3, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_status_ck" CHECK ("suppliers"."status" in ('pending','approved','suspended','blocked')),
	CONSTRAINT "suppliers_vat_format_ck" CHECK ("suppliers"."vat_number" is null or "suppliers"."vat_number" ~ '^3[0-9]{13}3$'),
	CONSTRAINT "suppliers_approved_ck" CHECK ("suppliers"."status" <> 'approved' or ("suppliers"."vat_number" is not null and "suppliers"."approved_by" is not null)),
	CONSTRAINT "suppliers_rating_ck" CHECK ("suppliers"."rating" is null or "suppliers"."rating" between 0 and 5),
	CONSTRAINT "suppliers_iban_ck" CHECK ("suppliers"."iban" is null or "suppliers"."iban" ~ '^SA[0-9]{22}$')
);

CREATE TABLE "audit_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_member_id" integer,
	"actor_role" text,
	"branch_id" bigint,
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" bigint,
	"subject_no" text,
	"before_state" jsonb,
	"after_state" jsonb,
	"reason" text,
	"result" text DEFAULT 'success' NOT NULL,
	"otp_challenge_id" uuid,
	"otp_sent_at" timestamp with time zone,
	"otp_verified_at" timestamp with time zone,
	"ip_sent" "inet",
	"ip_verified" "inet",
	"user_agent" text,
	"content_hash" text,
	"prev_hash" text,
	"row_hash" text DEFAULT '' NOT NULL,
	CONSTRAINT "audit_events_result_ck" CHECK ("audit_events"."result" in ('success','failure','denied','expired'))
);

CREATE TABLE "identity_cards" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "identity_cards_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"token_hash" text NOT NULL,
	"holder_type" text NOT NULL,
	"holder_id" bigint NOT NULL,
	"card_type" text DEFAULT 'nfc' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"issued_by" integer,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	CONSTRAINT "identity_cards_holder_ck" CHECK ("identity_cards"."holder_type" in ('student','employee','instructor')),
	CONSTRAINT "identity_cards_type_ck" CHECK ("identity_cards"."card_type" in ('nfc','qr','virtual')),
	CONSTRAINT "identity_cards_status_ck" CHECK ("identity_cards"."status" in ('active','suspended','revoked','lost')),
	CONSTRAINT "identity_cards_revoked_ck" CHECK ("identity_cards"."status" = 'active' or "identity_cards"."revoked_at" is not null)
);

CREATE TABLE "otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" integer NOT NULL,
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" bigint,
	"subject_hash" text NOT NULL,
	"code_hmac" text NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"destination_masked" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"sent_ip" "inet",
	"verified_ip" "inet",
	"sent_user_agent" text,
	"verified_user_agent" text,
	CONSTRAINT "otp_challenges_channel_ck" CHECK ("otp_challenges"."channel" in ('email','sms','app','totp')),
	CONSTRAINT "otp_challenges_status_ck" CHECK ("otp_challenges"."status" in ('pending','verified','expired','failed','cancelled')),
	CONSTRAINT "otp_challenges_attempts_ck" CHECK ("otp_challenges"."attempts" >= 0 and "otp_challenges"."attempts" <= "otp_challenges"."max_attempts"),
	CONSTRAINT "otp_challenges_expiry_ck" CHECK ("otp_challenges"."expires_at" > "otp_challenges"."sent_at"),
	CONSTRAINT "otp_challenges_verified_ck" CHECK (("otp_challenges"."status" = 'verified') = ("otp_challenges"."verified_at" is not null)),
	CONSTRAINT "otp_challenges_consumed_ck" CHECK ("otp_challenges"."consumed_at" is null or "otp_challenges"."status" = 'verified')
);

CREATE TABLE "presence_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "presence_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"card_id" bigint,
	"holder_type" text NOT NULL,
	"holder_id" bigint NOT NULL,
	"branch_id" bigint NOT NULL,
	"event_type" text NOT NULL,
	"room_id" bigint,
	"session_id" bigint,
	"method" text NOT NULL,
	"device_member_id" integer,
	"verified" boolean DEFAULT false NOT NULL,
	"ip" "inet",
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "presence_events_holder_ck" CHECK ("presence_events"."holder_type" in ('student','employee','instructor')),
	CONSTRAINT "presence_events_type_ck" CHECK ("presence_events"."event_type" in ('check_in','check_out')),
	CONSTRAINT "presence_events_method_ck" CHECK ("presence_events"."method" in ('nfc','qr','manual','geofence'))
);

ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_org_members_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_member_id_org_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_updated_by_org_members_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_delegator_member_id_org_members_id_fk" FOREIGN KEY ("delegator_member_id") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_delegate_member_id_org_members_id_fk" FOREIGN KEY ("delegate_member_id") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_leave_request_id_leave_requests_id_fk" FOREIGN KEY ("leave_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_proposed_by_org_members_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_approved_by_org_members_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "departments" ADD CONSTRAINT "departments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_id_departments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "departments" ADD CONSTRAINT "departments_manager_employee_id_employees_id_fk" FOREIGN KEY ("manager_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "employee_shifts" ADD CONSTRAINT "employee_shifts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "employee_shifts" ADD CONSTRAINT "employee_shifts_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "employees" ADD CONSTRAINT "employees_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "employees" ADD CONSTRAINT "employees_job_title_id_job_titles_id_fk" FOREIGN KEY ("job_title_id") REFERENCES "public"."job_titles"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "employees" ADD CONSTRAINT "employees_org_member_id_org_members_id_fk" FOREIGN KEY ("org_member_id") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_requested_by_org_members_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decided_by_org_members_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_approved_by_org_members_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_parent_id_asset_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."asset_categories"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "asset_maintenance" ADD CONSTRAINT "asset_maintenance_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "assets" ADD CONSTRAINT "assets_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "assets" ADD CONSTRAINT "assets_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "assets" ADD CONSTRAINT "assets_category_id_asset_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."asset_categories"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_session_id_class_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."class_sessions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_recorded_by_org_members_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_instructor_id_instructors_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_diploma_id_diplomas_id_fk" FOREIGN KEY ("diploma_id") REFERENCES "public"."diplomas"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_recurrence_id_session_recurrences_id_fk" FOREIGN KEY ("recurrence_id") REFERENCES "public"."session_recurrences"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "electricity_meters" ADD CONSTRAINT "electricity_meters_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "grades" ADD CONSTRAINT "grades_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "grades" ADD CONSTRAINT "grades_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "grades" ADD CONSTRAINT "grades_recorded_by_org_members_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "instructor_evaluations" ADD CONSTRAINT "instructor_evaluations_instructor_id_instructors_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "instructor_evaluations" ADD CONSTRAINT "instructor_evaluations_evaluated_by_org_members_id_fk" FOREIGN KEY ("evaluated_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "instructor_subjects" ADD CONSTRAINT "instructor_subjects_instructor_id_instructors_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "instructor_subjects" ADD CONSTRAINT "instructor_subjects_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "instructors" ADD CONSTRAINT "instructors_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "instructors" ADD CONSTRAINT "instructors_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "instructors" ADD CONSTRAINT "instructors_org_member_id_org_members_id_fk" FOREIGN KEY ("org_member_id") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "levels" ADD CONSTRAINT "levels_diploma_id_diplomas_id_fk" FOREIGN KEY ("diploma_id") REFERENCES "public"."diplomas"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_meter_id_electricity_meters_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."electricity_meters"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "session_recurrences" ADD CONSTRAINT "session_recurrences_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "session_recurrences" ADD CONSTRAINT "session_recurrences_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "session_recurrences" ADD CONSTRAINT "session_recurrences_instructor_id_instructors_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "session_recurrences" ADD CONSTRAINT "session_recurrences_diploma_id_diplomas_id_fk" FOREIGN KEY ("diploma_id") REFERENCES "public"."diplomas"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "session_recurrences" ADD CONSTRAINT "session_recurrences_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "session_recurrences" ADD CONSTRAINT "session_recurrences_created_by_org_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "session_students" ADD CONSTRAINT "session_students_session_id_class_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."class_sessions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "session_students" ADD CONSTRAINT "session_students_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "student_subjects" ADD CONSTRAINT "student_subjects_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "student_subjects" ADD CONSTRAINT "student_subjects_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "students" ADD CONSTRAINT "students_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "students" ADD CONSTRAINT "students_diploma_id_diplomas_id_fk" FOREIGN KEY ("diploma_id") REFERENCES "public"."diplomas"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "students" ADD CONSTRAINT "students_current_level_id_levels_id_fk" FOREIGN KEY ("current_level_id") REFERENCES "public"."levels"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "students" ADD CONSTRAINT "students_org_member_id_org_members_id_fk" FOREIGN KEY ("org_member_id") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "subject_prerequisites" ADD CONSTRAINT "subject_prerequisites_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "subject_prerequisites" ADD CONSTRAINT "subject_prerequisites_prerequisite_id_subjects_id_fk" FOREIGN KEY ("prerequisite_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_diploma_id_diplomas_id_fk" FOREIGN KEY ("diploma_id") REFERENCES "public"."diplomas"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_level_id_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."levels"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "branch_budgets" ADD CONSTRAINT "branch_budgets_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "branch_budgets" ADD CONSTRAINT "branch_budgets_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "branch_budgets" ADD CONSTRAINT "branch_budgets_approved_by_org_members_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "cost_report_snapshots" ADD CONSTRAINT "cost_report_snapshots_created_by_org_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_parent_id_expense_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_org_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_reverses_expense_id_expenses_id_fk" FOREIGN KEY ("reverses_expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "installments" ADD CONSTRAINT "installments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "installments" ADD CONSTRAINT "installments_sales_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_installment_id_installments_id_fk" FOREIGN KEY ("installment_id") REFERENCES "public"."installments"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payments" ADD CONSTRAINT "payments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payments" ADD CONSTRAINT "payments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payments" ADD CONSTRAINT "payments_collected_by_org_members_id_fk" FOREIGN KEY ("collected_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payments" ADD CONSTRAINT "payments_reverses_payment_id_payments_id_fk" FOREIGN KEY ("reverses_payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_diploma_id_diplomas_id_fk" FOREIGN KEY ("diploma_id") REFERENCES "public"."diplomas"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_created_by_org_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "utility_invoices" ADD CONSTRAINT "utility_invoices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "utility_invoices" ADD CONSTRAINT "utility_invoices_meter_id_electricity_meters_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."electricity_meters"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "item_categories" ADD CONSTRAINT "item_categories_parent_id_item_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."item_categories"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "items" ADD CONSTRAINT "items_category_id_item_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."item_categories"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "items" ADD CONSTRAINT "items_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "items" ADD CONSTRAINT "items_created_by_org_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "reorder_alerts" ADD CONSTRAINT "reorder_alerts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "reorder_alerts" ADD CONSTRAINT "reorder_alerts_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_count_id_stock_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."stock_counts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_counted_by_org_members_id_fk" FOREIGN KEY ("counted_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_set_by_org_members_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_issued_to_room_id_rooms_id_fk" FOREIGN KEY ("issued_to_room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_issued_to_department_id_departments_id_fk" FOREIGN KEY ("issued_to_department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_org_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_otp_challenge_id_otp_challenges_id_fk" FOREIGN KEY ("otp_challenge_id") REFERENCES "public"."otp_challenges"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_transfer_id_stock_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."stock_transfers"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_warehouse_id_warehouses_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_warehouse_id_warehouses_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_requested_by_org_members_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_keeper_member_id_org_members_id_fk" FOREIGN KEY ("keeper_member_id") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "direct_purchase_policies" ADD CONSTRAINT "direct_purchase_policies_set_by_org_members_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_grn_id_goods_receipts_id_fk" FOREIGN KEY ("grn_id") REFERENCES "public"."goods_receipts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_po_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("po_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_received_by_org_members_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "match_tolerances" ADD CONSTRAINT "match_tolerances_category_id_item_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."item_categories"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "match_tolerances" ADD CONSTRAINT "match_tolerances_set_by_org_members_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "procurement_exceptions" ADD CONSTRAINT "procurement_exceptions_pr_id_purchase_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."purchase_requests"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "procurement_exceptions" ADD CONSTRAINT "procurement_exceptions_requested_by_org_members_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "procurement_exceptions" ADD CONSTRAINT "procurement_exceptions_approved_by_org_members_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "purchase_limits" ADD CONSTRAINT "purchase_limits_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "purchase_limits" ADD CONSTRAINT "purchase_limits_set_by_org_members_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supersedes_po_id_purchase_orders_id_fk" FOREIGN KEY ("supersedes_po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_pr_id_purchase_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."purchase_requests"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_exception_id_procurement_exceptions_id_fk" FOREIGN KEY ("exception_id") REFERENCES "public"."procurement_exceptions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_prepared_by_org_members_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_org_members_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_pr_id_purchase_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."purchase_requests"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_alert_id_reorder_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."reorder_alerts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_requested_by_org_members_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "quotation_evaluations" ADD CONSTRAINT "quotation_evaluations_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "quotation_evaluations" ADD CONSTRAINT "quotation_evaluations_evaluated_by_org_members_id_fk" FOREIGN KEY ("evaluated_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_entered_by_org_members_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "rfq_awards" ADD CONSTRAINT "rfq_awards_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "rfq_awards" ADD CONSTRAINT "rfq_awards_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "rfq_awards" ADD CONSTRAINT "rfq_awards_exception_id_procurement_exceptions_id_fk" FOREIGN KEY ("exception_id") REFERENCES "public"."procurement_exceptions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "rfq_awards" ADD CONSTRAINT "rfq_awards_recommended_by_org_members_id_fk" FOREIGN KEY ("recommended_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "rfq_awards" ADD CONSTRAINT "rfq_awards_approved_by_org_members_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "rfq_suppliers" ADD CONSTRAINT "rfq_suppliers_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "rfq_suppliers" ADD CONSTRAINT "rfq_suppliers_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_pr_id_purchase_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."purchase_requests"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_created_by_org_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "supplier_categories" ADD CONSTRAINT "supplier_categories_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "supplier_categories" ADD CONSTRAINT "supplier_categories_category_id_item_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."item_categories"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_po_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("po_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_approved_by_org_members_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_created_by_org_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("supplier_invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_paid_by_org_members_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_approved_by_org_members_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_member_id_org_members_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_otp_challenge_id_otp_challenges_id_fk" FOREIGN KEY ("otp_challenge_id") REFERENCES "public"."otp_challenges"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "identity_cards" ADD CONSTRAINT "identity_cards_issued_by_org_members_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_member_id_org_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "presence_events" ADD CONSTRAINT "presence_events_card_id_identity_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."identity_cards"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "presence_events" ADD CONSTRAINT "presence_events_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "presence_events" ADD CONSTRAINT "presence_events_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "presence_events" ADD CONSTRAINT "presence_events_session_id_class_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."class_sessions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "presence_events" ADD CONSTRAINT "presence_events_device_member_id_org_members_id_fk" FOREIGN KEY ("device_member_id") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;
CREATE UNIQUE INDEX "branches_code_uq" ON "branches" USING btree ("code");
CREATE UNIQUE INDEX "branches_one_head_office_uq" ON "branches" USING btree ("is_head_office") WHERE "branches"."is_head_office";
CREATE UNIQUE INDEX "document_sequences_pk" ON "document_sequences" USING btree ("prefix","year");
CREATE INDEX "documents_owner_idx" ON "documents" USING btree ("owner_type","owner_id");
CREATE UNIQUE INDEX "documents_storage_key_uq" ON "documents" USING btree ("storage_key");
CREATE INDEX "notifications_member_unread_idx" ON "notifications" USING btree ("member_id","created_at") WHERE "notifications"."read_at" is null;
CREATE INDEX "approval_delegations_delegator_idx" ON "approval_delegations" USING btree ("delegator_member_id","valid_from");
CREATE UNIQUE INDEX "departments_code_uq" ON "departments" USING btree ("code");
CREATE INDEX "departments_branch_idx" ON "departments" USING btree ("branch_id");
CREATE UNIQUE INDEX "employees_no_uq" ON "employees" USING btree ("employee_no");
CREATE UNIQUE INDEX "employees_national_id_uq" ON "employees" USING btree ("national_id") WHERE "employees"."national_id" is not null;
CREATE UNIQUE INDEX "employees_member_uq" ON "employees" USING btree ("org_member_id") WHERE "employees"."org_member_id" is not null;
CREATE INDEX "employees_branch_idx" ON "employees" USING btree ("branch_id");
CREATE INDEX "employees_department_idx" ON "employees" USING btree ("department_id");
CREATE UNIQUE INDEX "job_titles_name_uq" ON "job_titles" USING btree ("name");
CREATE INDEX "leave_requests_employee_idx" ON "leave_requests" USING btree ("employee_id","start_date");
CREATE UNIQUE INDEX "leave_types_code_uq" ON "leave_types" USING btree ("code");
CREATE UNIQUE INDEX "payroll_lines_run_employee_uq" ON "payroll_lines" USING btree ("run_id","employee_id");
CREATE UNIQUE INDEX "payroll_runs_branch_month_uq" ON "payroll_runs" USING btree ("branch_id","period_month");
CREATE UNIQUE INDEX "shifts_name_uq" ON "shifts" USING btree ("name");
CREATE UNIQUE INDEX "asset_categories_name_uq" ON "asset_categories" USING btree ("parent_id","name");
CREATE INDEX "asset_maintenance_due_idx" ON "asset_maintenance" USING btree ("due_date") WHERE "asset_maintenance"."status" = 'scheduled';
CREATE UNIQUE INDEX "assets_tag_uq" ON "assets" USING btree ("asset_tag");
CREATE INDEX "assets_room_idx" ON "assets" USING btree ("room_id");
CREATE INDEX "assets_branch_idx" ON "assets" USING btree ("branch_id");
CREATE UNIQUE INDEX "attendance_records_uq" ON "attendance_records" USING btree ("session_id","student_id");
CREATE INDEX "class_sessions_date_idx" ON "class_sessions" USING btree ("session_date","branch_id");
CREATE INDEX "class_sessions_room_idx" ON "class_sessions" USING btree ("room_id","session_date");
CREATE INDEX "class_sessions_instructor_idx" ON "class_sessions" USING btree ("instructor_id","session_date");
CREATE UNIQUE INDEX "diplomas_code_uq" ON "diplomas" USING btree ("code");
CREATE UNIQUE INDEX "electricity_meters_branch_no_uq" ON "electricity_meters" USING btree ("branch_id","meter_no");
CREATE INDEX "grades_student_subject_idx" ON "grades" USING btree ("student_id","subject_id");
CREATE INDEX "instructor_evaluations_idx" ON "instructor_evaluations" USING btree ("instructor_id","period_end");
CREATE UNIQUE INDEX "instructors_no_uq" ON "instructors" USING btree ("instructor_no");
CREATE UNIQUE INDEX "instructors_member_uq" ON "instructors" USING btree ("org_member_id") WHERE "instructors"."org_member_id" is not null;
CREATE INDEX "instructors_branch_idx" ON "instructors" USING btree ("branch_id");
CREATE UNIQUE INDEX "levels_diploma_no_uq" ON "levels" USING btree ("diploma_id","level_no");
CREATE UNIQUE INDEX "rooms_branch_code_uq" ON "rooms" USING btree ("branch_id","code");
CREATE INDEX "rooms_meter_idx" ON "rooms" USING btree ("meter_id");
CREATE INDEX "session_students_student_idx" ON "session_students" USING btree ("student_id");
CREATE UNIQUE INDEX "student_subjects_uq" ON "student_subjects" USING btree ("student_id","subject_id");
CREATE UNIQUE INDEX "students_no_uq" ON "students" USING btree ("student_no");
CREATE UNIQUE INDEX "students_national_id_uq" ON "students" USING btree ("national_id") WHERE "students"."national_id" is not null;
CREATE UNIQUE INDEX "students_member_uq" ON "students" USING btree ("org_member_id") WHERE "students"."org_member_id" is not null;
CREATE INDEX "students_branch_diploma_idx" ON "students" USING btree ("branch_id","diploma_id");
CREATE UNIQUE INDEX "subjects_code_uq" ON "subjects" USING btree ("code");
CREATE UNIQUE INDEX "subjects_diploma_name_uq" ON "subjects" USING btree ("diploma_id","name");
CREATE INDEX "subjects_level_idx" ON "subjects" USING btree ("level_id");
CREATE INDEX "cost_report_snapshots_period_idx" ON "cost_report_snapshots" USING btree ("period_from","period_to");
CREATE UNIQUE INDEX "expense_categories_code_uq" ON "expense_categories" USING btree ("code");
CREATE UNIQUE INDEX "expenses_no_uq" ON "expenses" USING btree ("expense_no");
CREATE INDEX "expenses_branch_date_idx" ON "expenses" USING btree ("branch_id","expense_date");
CREATE INDEX "expenses_category_idx" ON "expenses" USING btree ("category_id","expense_date");
CREATE UNIQUE INDEX "installments_student_seq_uq" ON "installments" USING btree ("student_id","seq");
CREATE INDEX "installments_due_idx" ON "installments" USING btree ("due_date") WHERE "installments"."status" in ('pending','partial');
CREATE UNIQUE INDEX "payments_receipt_no_uq" ON "payments" USING btree ("receipt_no");
CREATE INDEX "payments_student_idx" ON "payments" USING btree ("student_id","paid_on");
CREATE INDEX "payments_branch_date_idx" ON "payments" USING btree ("branch_id","paid_on");
CREATE UNIQUE INDEX "payments_one_reversal_uq" ON "payments" USING btree ("reverses_payment_id") WHERE "payments"."reverses_payment_id" is not null;
CREATE UNIQUE INDEX "sales_invoice_lines_no_uq" ON "sales_invoice_lines" USING btree ("invoice_id","line_no");
CREATE UNIQUE INDEX "sales_invoices_no_uq" ON "sales_invoices" USING btree ("invoice_no");
CREATE UNIQUE INDEX "sales_invoices_uuid_uq" ON "sales_invoices" USING btree ("invoice_uuid");
CREATE INDEX "sales_invoices_student_idx" ON "sales_invoices" USING btree ("student_id");
CREATE INDEX "sales_invoices_branch_date_idx" ON "sales_invoices" USING btree ("branch_id","issue_date");
CREATE UNIQUE INDEX "tax_rates_code_from_uq" ON "tax_rates" USING btree ("code","valid_from");
CREATE UNIQUE INDEX "utility_invoices_meter_month_uq" ON "utility_invoices" USING btree ("meter_id","bill_month");
CREATE UNIQUE INDEX "item_categories_code_uq" ON "item_categories" USING btree ("code");
CREATE UNIQUE INDEX "items_code_uq" ON "items" USING btree ("item_code");
CREATE INDEX "items_category_idx" ON "items" USING btree ("category_id");
CREATE UNIQUE INDEX "reorder_alerts_one_open_uq" ON "reorder_alerts" USING btree ("warehouse_id","item_id") WHERE "reorder_alerts"."status" in ('open','in_progress');
CREATE UNIQUE INDEX "stock_movements_no_uq" ON "stock_movements" USING btree ("movement_no");
CREATE INDEX "stock_movements_wh_item_idx" ON "stock_movements" USING btree ("warehouse_id","item_id","occurred_at");
CREATE INDEX "stock_movements_room_idx" ON "stock_movements" USING btree ("issued_to_room_id","occurred_at") WHERE "stock_movements"."issued_to_room_id" is not null;
CREATE UNIQUE INDEX "stock_transfers_no_uq" ON "stock_transfers" USING btree ("transfer_no");
CREATE UNIQUE INDEX "units_code_uq" ON "units" USING btree ("code");
CREATE UNIQUE INDEX "warehouses_code_uq" ON "warehouses" USING btree ("code");
CREATE INDEX "warehouses_branch_idx" ON "warehouses" USING btree ("branch_id");
CREATE UNIQUE INDEX "goods_receipt_lines_uq" ON "goods_receipt_lines" USING btree ("grn_id","po_line_id");
CREATE UNIQUE INDEX "goods_receipts_no_uq" ON "goods_receipts" USING btree ("grn_no");
CREATE INDEX "goods_receipts_po_idx" ON "goods_receipts" USING btree ("po_id");
CREATE UNIQUE INDEX "purchase_order_lines_no_uq" ON "purchase_order_lines" USING btree ("po_id","line_no");
CREATE UNIQUE INDEX "purchase_orders_no_version_uq" ON "purchase_orders" USING btree ("po_no","version");
CREATE INDEX "purchase_orders_supplier_idx" ON "purchase_orders" USING btree ("supplier_id");
CREATE INDEX "purchase_orders_branch_status_idx" ON "purchase_orders" USING btree ("branch_id","status");
CREATE UNIQUE INDEX "purchase_request_lines_uq" ON "purchase_request_lines" USING btree ("pr_id","item_id");
CREATE UNIQUE INDEX "purchase_requests_no_uq" ON "purchase_requests" USING btree ("pr_no");
CREATE INDEX "purchase_requests_branch_status_idx" ON "purchase_requests" USING btree ("branch_id","status");
CREATE UNIQUE INDEX "quotation_evaluations_uq" ON "quotation_evaluations" USING btree ("quotation_id","evaluated_by");
CREATE UNIQUE INDEX "quotation_lines_uq" ON "quotation_lines" USING btree ("quotation_id","item_id");
CREATE UNIQUE INDEX "quotations_rfq_supplier_uq" ON "quotations" USING btree ("rfq_id","supplier_id");
CREATE UNIQUE INDEX "rfqs_no_uq" ON "rfqs" USING btree ("rfq_no");
CREATE INDEX "rfqs_pr_idx" ON "rfqs" USING btree ("pr_id");
CREATE UNIQUE INDEX "supplier_invoices_dup_uq" ON "supplier_invoices" USING btree ("supplier_id","supplier_invoice_no");
CREATE INDEX "supplier_invoices_po_idx" ON "supplier_invoices" USING btree ("po_id");
CREATE UNIQUE INDEX "suppliers_no_uq" ON "suppliers" USING btree ("supplier_no");
CREATE UNIQUE INDEX "suppliers_vat_uq" ON "suppliers" USING btree ("vat_number") WHERE "suppliers"."vat_number" is not null;
CREATE INDEX "audit_events_subject_idx" ON "audit_events" USING btree ("subject_type","subject_id","occurred_at");
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_member_id","occurred_at");
CREATE INDEX "audit_events_time_idx" ON "audit_events" USING btree ("occurred_at");
CREATE UNIQUE INDEX "identity_cards_token_uq" ON "identity_cards" USING btree ("token_hash");
CREATE UNIQUE INDEX "identity_cards_one_active_uq" ON "identity_cards" USING btree ("holder_type","holder_id") WHERE "identity_cards"."status" = 'active';
CREATE INDEX "otp_challenges_member_idx" ON "otp_challenges" USING btree ("member_id","sent_at");
CREATE INDEX "otp_challenges_subject_idx" ON "otp_challenges" USING btree ("subject_type","subject_id");
CREATE INDEX "presence_events_holder_idx" ON "presence_events" USING btree ("holder_type","holder_id","occurred_at");
CREATE INDEX "presence_events_session_idx" ON "presence_events" USING btree ("session_id") WHERE "presence_events"."session_id" is not null;
-- ===== 0003_constraints_triggers_views =====
-- Rules a CHECK or FOREIGN KEY cannot express: cross-table integrity, immutability, exclusion constraints, hash chain,
-- reporting views and reference data. Applied AFTER the generated table migration.

-- ============================================================================================================
-- 1. Foreign keys that close import cycles between modules
-- ============================================================================================================
ALTER TABLE expenses            ADD CONSTRAINT expenses_supplier_invoice_fk  FOREIGN KEY (supplier_invoice_id) REFERENCES supplier_invoices(id);

ALTER TABLE assets              ADD CONSTRAINT assets_supplier_invoice_line_fk FOREIGN KEY (source_supplier_invoice_line_id) REFERENCES supplier_invoice_lines(id);

ALTER TABLE reorder_alerts      ADD CONSTRAINT reorder_alerts_pr_fk          FOREIGN KEY (purchase_request_id) REFERENCES purchase_requests(id);

ALTER TABLE purchase_orders     ADD CONSTRAINT purchase_orders_delegation_fk FOREIGN KEY (approved_via_delegation_id) REFERENCES approval_delegations(id);

-- ============================================================================================================
-- 2. Exclusion constraints: no double booking, no overlapping leave/delegation
-- ============================================================================================================
ALTER TABLE class_sessions ADD CONSTRAINT class_sessions_no_room_overlap
  EXCLUDE USING gist (room_id WITH =, tsrange(session_date + start_time, session_date + end_time) WITH &&) WHERE (status <> 'cancelled');

ALTER TABLE class_sessions ADD CONSTRAINT class_sessions_no_instructor_overlap
  EXCLUDE USING gist (instructor_id WITH =, tsrange(session_date + start_time, session_date + end_time) WITH &&) WHERE (status <> 'cancelled');

ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_no_overlap
  EXCLUDE USING gist (employee_id WITH =, daterange(start_date, end_date, '[]') WITH &&) WHERE (status IN ('pending','approved'));

ALTER TABLE approval_delegations ADD CONSTRAINT approval_delegations_no_overlap
  EXCLUDE USING gist (delegator_member_id WITH =, scope WITH =, daterange(valid_from, valid_to, '[]') WITH &&) WHERE (status IN ('proposed','approved'));

-- ============================================================================================================
-- 3. updated_at maintenance on every table that has the column
-- ============================================================================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT table_name FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name = 'updated_at' AND table_name NOT IN ('education_records','education_audit','org_members')
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', 'trg_' || r.table_name || '_updated_at', r.table_name);
  END LOOP;
END
$$;

-- ============================================================================================================
-- 4. Append-only ledgers
-- ============================================================================================================
CREATE TRIGGER trg_stock_movements_append_only BEFORE UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER trg_audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER trg_audit_events_no_truncate BEFORE TRUNCATE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER trg_stock_movements_no_truncate BEFORE TRUNCATE ON stock_movements FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- ============================================================================================================
-- 5. Audit hash chain: every row stores the hash of the previous row; verify_audit_chain() finds the first break.
-- ============================================================================================================
CREATE OR REPLACE FUNCTION audit_row_hash(e audit_events) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT encode(digest(concat_ws('|', coalesce(e.prev_hash, ''), e.occurred_at::text, coalesce(e.actor_member_id::text, ''),
         e.action, e.subject_type, coalesce(e.subject_id::text, ''), coalesce(e.subject_no, ''), e.result,
         coalesce(e.before_state::text, ''), coalesce(e.after_state::text, ''), coalesce(e.reason, ''),
         coalesce(e.otp_challenge_id::text, ''), coalesce(e.otp_sent_at::text, ''), coalesce(e.otp_verified_at::text, ''),
         coalesce(host(e.ip_sent), ''), coalesce(host(e.ip_verified), ''), coalesce(e.content_hash, '')), 'sha256'), 'hex')
$$;

CREATE OR REPLACE FUNCTION audit_chain_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(7340101);                                  -- serialise appends so the chain has one order
  SELECT row_hash INTO NEW.prev_hash FROM audit_events ORDER BY id DESC LIMIT 1;
  NEW.row_hash := audit_row_hash(NEW);
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_audit_events_chain BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION audit_chain_before_insert();

CREATE OR REPLACE FUNCTION verify_audit_chain() RETURNS TABLE (first_bad_id bigint, reason text) LANGUAGE plpgsql STABLE AS $$
DECLARE r audit_events; prev text := NULL; first boolean := true;
BEGIN
  FOR r IN SELECT * FROM audit_events ORDER BY id LOOP
    IF coalesce(r.prev_hash, '') <> coalesce(prev, '') THEN first_bad_id := r.id; reason := 'prev_hash does not match the previous row'; RETURN NEXT; RETURN; END IF;
    IF r.row_hash <> audit_row_hash(r) THEN first_bad_id := r.id; reason := 'row_hash does not match the row content'; RETURN NEXT; RETURN; END IF;
    prev := r.row_hash;
  END LOOP;
END
$$;

-- ============================================================================================================
-- 6. Inventory: no negative stock, automatic reorder alerts
-- ============================================================================================================
CREATE OR REPLACE FUNCTION stock_movement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bal numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.warehouse_id::text || ':' || NEW.item_id::text, 0));
  SELECT coalesce(sum(qty_delta), 0) INTO bal FROM stock_movements WHERE warehouse_id = NEW.warehouse_id AND item_id = NEW.item_id;
  IF bal + NEW.qty_delta < 0 THEN
    RAISE EXCEPTION 'insufficient stock: balance % cannot absorb movement %', bal, NEW.qty_delta USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_stock_movements_guard BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION stock_movement_guard();

-- Opens ONE alert when the balance reaches the minimum (and closes it again when stock is back above it). The partial
-- unique index reorder_alerts_one_open_uq guarantees a single open alert per item and warehouse.
CREATE OR REPLACE FUNCTION stock_movement_alert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bal numeric; lvl numeric;
BEGIN
  SELECT min_qty INTO lvl FROM stock_levels WHERE warehouse_id = NEW.warehouse_id AND item_id = NEW.item_id;
  IF lvl IS NULL THEN RETURN NEW; END IF;
  SELECT coalesce(sum(qty_delta), 0) INTO bal FROM stock_movements WHERE warehouse_id = NEW.warehouse_id AND item_id = NEW.item_id;
  IF bal <= lvl THEN
    INSERT INTO reorder_alerts (warehouse_id, item_id, qty_at_trigger, min_qty) VALUES (NEW.warehouse_id, NEW.item_id, bal, lvl)
    ON CONFLICT (warehouse_id, item_id) WHERE status IN ('open','in_progress') DO NOTHING;
  ELSE
    UPDATE reorder_alerts SET status = 'closed', closed_at = now()
     WHERE warehouse_id = NEW.warehouse_id AND item_id = NEW.item_id AND status = 'open';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_stock_movements_alert AFTER INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION stock_movement_alert();

-- ============================================================================================================
-- 7. Academic integrity
-- ============================================================================================================
CREATE OR REPLACE FUNCTION subject_level_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM levels WHERE id = NEW.level_id AND diploma_id = NEW.diploma_id) THEN
    RAISE EXCEPTION 'level % does not belong to diploma %', NEW.level_id, NEW.diploma_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_subjects_level_guard BEFORE INSERT OR UPDATE OF level_id, diploma_id ON subjects FOR EACH ROW EXECUTE FUNCTION subject_level_guard();

CREATE OR REPLACE FUNCTION prerequisite_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s record; p record;
BEGIN
  SELECT sb.diploma_id, l.level_no INTO s FROM subjects sb JOIN levels l ON l.id = sb.level_id WHERE sb.id = NEW.subject_id;
  SELECT sb.diploma_id, l.level_no INTO p FROM subjects sb JOIN levels l ON l.id = sb.level_id WHERE sb.id = NEW.prerequisite_id;
  IF p.diploma_id <> s.diploma_id OR p.level_no >= s.level_no THEN
    RAISE EXCEPTION 'a prerequisite must be in the same diploma and an earlier level' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_subject_prerequisites_guard BEFORE INSERT OR UPDATE ON subject_prerequisites FOR EACH ROW EXECUTE FUNCTION prerequisite_guard();

-- Room capacity, same branch/diploma, and a student cannot sit in two overlapping sessions.
CREATE OR REPLACE FUNCTION session_student_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s class_sessions; cap int; cnt int; st students;
BEGIN
  SELECT * INTO s FROM class_sessions WHERE id = NEW.session_id;
  SELECT * INTO st FROM students WHERE id = NEW.student_id;
  IF st.branch_id <> s.branch_id OR st.diploma_id <> s.diploma_id THEN
    RAISE EXCEPTION 'student does not belong to the session branch/diploma' USING ERRCODE = 'check_violation';
  END IF;
  SELECT capacity INTO cap FROM rooms WHERE id = s.room_id;
  SELECT count(*) INTO cnt FROM session_students WHERE session_id = NEW.session_id;
  IF cnt + 1 > cap THEN RAISE EXCEPTION 'room capacity (%) exceeded', cap USING ERRCODE = 'check_violation'; END IF;
  IF EXISTS (SELECT 1 FROM session_students ss JOIN class_sessions o ON o.id = ss.session_id
              WHERE ss.student_id = NEW.student_id AND o.id <> s.id AND o.status <> 'cancelled' AND s.status <> 'cancelled'
                AND tsrange(o.session_date + o.start_time, o.session_date + o.end_time) && tsrange(s.session_date + s.start_time, s.session_date + s.end_time)) THEN
    RAISE EXCEPTION 'student already has an overlapping session' USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_session_students_guard BEFORE INSERT ON session_students FOR EACH ROW EXECUTE FUNCTION session_student_guard();

-- ============================================================================================================
-- 8. Financial immutability: confirmed money movements never change; corrections are reversal rows.
-- ============================================================================================================
CREATE OR REPLACE FUNCTION confirmed_money_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('confirmed','reversed') THEN RAISE EXCEPTION 'confirmed % rows cannot be deleted; post a reversal instead', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('confirmed','reversed') THEN
    IF to_jsonb(NEW) - 'status' - 'receipt_emailed_at' - 'gross_halalas' IS DISTINCT FROM to_jsonb(OLD) - 'status' - 'receipt_emailed_at' - 'gross_halalas' THEN
      RAISE EXCEPTION 'confirmed % rows are immutable', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NOT (OLD.status = NEW.status OR (OLD.status = 'confirmed' AND NEW.status = 'reversed')) THEN
      RAISE EXCEPTION 'illegal status change % -> %', OLD.status, NEW.status USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_payments_immutable BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION confirmed_money_guard();

CREATE TRIGGER trg_expenses_immutable BEFORE UPDATE OR DELETE ON expenses FOR EACH ROW EXECUTE FUNCTION confirmed_money_guard();

CREATE OR REPLACE FUNCTION payment_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total bigint; amt bigint; inst_total bigint; inst_paid bigint; same_student boolean;
BEGIN
  SELECT amount_halalas INTO amt FROM payments WHERE id = NEW.payment_id;
  SELECT coalesce(sum(amount_halalas), 0) INTO total FROM payment_allocations WHERE payment_id = NEW.payment_id;
  IF total + NEW.amount_halalas > amt THEN RAISE EXCEPTION 'allocations exceed the payment amount' USING ERRCODE = 'check_violation'; END IF;
  SELECT amount_halalas INTO inst_total FROM installments WHERE id = NEW.installment_id;
  SELECT coalesce(sum(amount_halalas), 0) INTO inst_paid FROM payment_allocations WHERE installment_id = NEW.installment_id;
  IF inst_paid + NEW.amount_halalas > inst_total THEN RAISE EXCEPTION 'allocations exceed the installment amount' USING ERRCODE = 'check_violation'; END IF;
  SELECT (p.student_id = i.student_id) INTO same_student FROM payments p, installments i WHERE p.id = NEW.payment_id AND i.id = NEW.installment_id;
  IF NOT same_student THEN RAISE EXCEPTION 'payment and installment belong to different students' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_payment_allocations_guard BEFORE INSERT ON payment_allocations FOR EACH ROW EXECUTE FUNCTION payment_allocation_guard();

CREATE OR REPLACE FUNCTION payroll_lines_lock_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text; rid bigint := coalesce(NEW.run_id, OLD.run_id);
BEGIN
  SELECT status INTO st FROM payroll_runs WHERE id = rid;
  IF st <> 'draft' THEN RAISE EXCEPTION 'payroll run is %; its lines are locked', st USING ERRCODE = 'integrity_constraint_violation'; END IF;
  RETURN coalesce(NEW, OLD);
END
$$;

CREATE TRIGGER trg_payroll_lines_lock BEFORE INSERT OR UPDATE OR DELETE ON payroll_lines FOR EACH ROW EXECUTE FUNCTION payroll_lines_lock_guard();

-- ============================================================================================================
-- 9. Procurement controls
-- ============================================================================================================
-- Only approved suppliers can quote, and the quote must carry the supplier's registered VAT number.
CREATE OR REPLACE FUNCTION quotation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sup suppliers;
BEGIN
  SELECT * INTO sup FROM suppliers WHERE id = NEW.supplier_id;
  IF sup.status <> 'approved' THEN RAISE EXCEPTION 'supplier % is not approved', sup.supplier_no USING ERRCODE = 'check_violation'; END IF;
  IF sup.vat_number IS DISTINCT FROM NEW.supplier_vat_number THEN RAISE EXCEPTION 'quotation VAT number does not match the supplier register' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_quotations_guard BEFORE INSERT ON quotations FOR EACH ROW EXECUTE FUNCTION quotation_guard();

-- Award: three submitted quotes from three different suppliers unless an approved exception exists; the "lowest price"
-- flag must be truthful; a justification is already enforced by rfq_awards_justification_ck.
CREATE OR REPLACE FUNCTION rfq_award_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n int; lowest bigint; chosen bigint; q quotations; ex procurement_exceptions; req int;
BEGIN
  SELECT * INTO q FROM quotations WHERE id = NEW.quotation_id;
  IF q.rfq_id <> NEW.rfq_id THEN RAISE EXCEPTION 'quotation does not belong to this RFQ' USING ERRCODE = 'check_violation'; END IF;
  SELECT coalesce((SELECT value::int FROM org_settings WHERE key = 'procurement.min_quotes'), 3) INTO req;
  SELECT count(DISTINCT supplier_id) INTO n FROM quotations WHERE rfq_id = NEW.rfq_id AND status = 'submitted';
  IF n < req THEN
    SELECT * INTO ex FROM procurement_exceptions WHERE id = NEW.exception_id;
    IF NEW.exception_id IS NULL OR ex.approved_by IS NULL OR ex.exception_type NOT IN ('single_source','late_responses','emergency') THEN
      RAISE EXCEPTION 'at least % quotations from different suppliers are required (found %)', req, n USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  SELECT min(t) , max(CASE WHEN qid = NEW.quotation_id THEN t END) INTO lowest, chosen
    FROM (SELECT ql.quotation_id AS qid, sum(ql.net_halalas) AS t FROM quotation_lines ql JOIN quotations qq ON qq.id = ql.quotation_id
           WHERE qq.rfq_id = NEW.rfq_id AND qq.status = 'submitted' GROUP BY ql.quotation_id) s;
  IF NEW.is_lowest_price AND chosen IS DISTINCT FROM lowest THEN
    RAISE EXCEPTION 'is_lowest_price is true but the selected quotation is not the cheapest' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_rfq_awards_guard BEFORE INSERT ON rfq_awards FOR EACH ROW EXECUTE FUNCTION rfq_award_guard();

-- A purchase order needs: an approved award (standard path) or an approved exception (direct_small / exceptions),
-- the awarded supplier, matching VAT snapshot, and an approved supplier.
CREATE OR REPLACE FUNCTION purchase_order_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pr purchase_requests; aw rfq_awards; qt quotations; ex procurement_exceptions; sup suppliers;
BEGIN
  SELECT * INTO pr FROM purchase_requests WHERE id = NEW.pr_id;
  SELECT * INTO sup FROM suppliers WHERE id = NEW.supplier_id;
  IF sup.status <> 'approved' OR sup.vat_number IS DISTINCT FROM NEW.supplier_vat_number THEN
    RAISE EXCEPTION 'purchase orders require an approved supplier with a matching VAT number' USING ERRCODE = 'check_violation';
  END IF;
  IF pr.path = 'standard' AND NEW.rfq_id IS NOT NULL THEN
    SELECT * INTO aw FROM rfq_awards WHERE rfq_id = NEW.rfq_id;
    IF aw.rfq_id IS NULL OR aw.approved_by IS NULL THEN RAISE EXCEPTION 'the RFQ award has not been approved' USING ERRCODE = 'check_violation'; END IF;
    SELECT * INTO qt FROM quotations WHERE id = aw.quotation_id;
    IF qt.supplier_id <> NEW.supplier_id THEN RAISE EXCEPTION 'purchase order supplier differs from the awarded supplier' USING ERRCODE = 'check_violation'; END IF;
  ELSE
    SELECT * INTO ex FROM procurement_exceptions WHERE id = NEW.exception_id;
    IF ex.id IS NULL OR ex.approved_by IS NULL OR ex.pr_id <> NEW.pr_id THEN
      RAISE EXCEPTION 'purchase order needs an approved exception for this request' USING ERRCODE = 'check_violation';
    END IF;
    IF pr.path = 'direct_small' AND ex.exception_type <> 'direct_small' THEN RAISE EXCEPTION 'direct purchases require a direct_small approval' USING ERRCODE = 'check_violation'; END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_purchase_orders_guard BEFORE INSERT ON purchase_orders FOR EACH ROW EXECUTE FUNCTION purchase_order_guard();

-- After the preparer confirms (status leaves 'draft'), commercial fields and lines are frozen. Changes need a new version.
-- Generated columns (gross_halalas) are excluded from the comparison: they are not yet recomputed inside BEFORE triggers.
CREATE OR REPLACE FUNCTION purchase_order_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    IF (to_jsonb(NEW) - 'status' - 'approved_by' - 'approved_at' - 'approved_via_delegation_id' - 'sent_at' - 'acknowledged_at' - 'document_hash' - 'updated_at' - 'prepared_at' - 'gross_halalas')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'status' - 'approved_by' - 'approved_at' - 'approved_via_delegation_id' - 'sent_at' - 'acknowledged_at' - 'document_hash' - 'updated_at' - 'prepared_at' - 'gross_halalas') THEN
      RAISE EXCEPTION 'purchase order % is frozen; create a new version instead', OLD.po_no USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_purchase_orders_freeze BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION purchase_order_freeze();

CREATE OR REPLACE FUNCTION purchase_order_lines_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text; pid bigint := coalesce(NEW.po_id, OLD.po_id);
BEGIN
  SELECT status INTO st FROM purchase_orders WHERE id = pid;
  IF st <> 'draft' THEN RAISE EXCEPTION 'purchase order lines are frozen once the order is %', st USING ERRCODE = 'integrity_constraint_violation'; END IF;
  RETURN coalesce(NEW, OLD);
END
$$;

CREATE TRIGGER trg_purchase_order_lines_freeze BEFORE INSERT OR UPDATE OR DELETE ON purchase_order_lines FOR EACH ROW EXECUTE FUNCTION purchase_order_lines_freeze();

-- Goods may not be accepted beyond the ordered quantity (cumulative across receipts).
CREATE OR REPLACE FUNCTION goods_receipt_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ordered numeric; got numeric;
BEGIN
  SELECT quantity INTO ordered FROM purchase_order_lines WHERE id = NEW.po_line_id;
  SELECT coalesce(sum(qty_accepted), 0) INTO got FROM goods_receipt_lines WHERE po_line_id = NEW.po_line_id AND id IS DISTINCT FROM NEW.id;
  IF got + NEW.qty_accepted > ordered THEN RAISE EXCEPTION 'accepted quantity exceeds the ordered quantity' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_goods_receipt_lines_guard BEFORE INSERT OR UPDATE ON goods_receipt_lines FOR EACH ROW EXECUTE FUNCTION goods_receipt_line_guard();

-- ============================================================================================================
-- 10. Reporting views
-- ============================================================================================================
CREATE VIEW v_stock_balances AS
  SELECT warehouse_id, item_id, sum(qty_delta) AS qty_on_hand, max(occurred_at) AS last_movement_at
    FROM stock_movements GROUP BY warehouse_id, item_id;

CREATE VIEW v_reorder_status AS
  SELECT sl.warehouse_id, sl.item_id, i.item_code, i.name AS item_name, coalesce(b.qty_on_hand, 0) AS qty_on_hand, sl.min_qty, sl.reorder_qty,
         coalesce(b.qty_on_hand, 0) <= sl.min_qty AS needs_reorder,
         EXISTS (SELECT 1 FROM reorder_alerts a WHERE a.warehouse_id = sl.warehouse_id AND a.item_id = sl.item_id AND a.status IN ('open','in_progress')) AS has_open_alert
    FROM stock_levels sl JOIN items i ON i.id = sl.item_id
    LEFT JOIN v_stock_balances b ON b.warehouse_id = sl.warehouse_id AND b.item_id = sl.item_id;

CREATE VIEW v_consumption_monthly AS
  SELECT w.branch_id, m.issued_to_room_id AS room_id, m.issued_to_department_id AS department_id, m.item_id,
         date_trunc('month', m.occurred_at)::date AS month, sum(-m.qty_delta) AS qty_issued,
         sum(-m.qty_delta * coalesce(m.unit_cost_halalas, 0))::bigint AS indicative_cost_halalas
    FROM stock_movements m JOIN warehouses w ON w.id = m.warehouse_id
   WHERE m.movement_type = 'issue'
   GROUP BY w.branch_id, m.issued_to_room_id, m.issued_to_department_id, m.item_id, date_trunc('month', m.occurred_at);

CREATE VIEW v_student_ledger AS
  SELECT s.id AS student_id, s.student_no, s.full_name, s.branch_id,
         coalesce((SELECT sum(amount_halalas) FROM installments i WHERE i.student_id = s.id AND i.status <> 'cancelled'), 0) AS planned_halalas,
         coalesce((SELECT sum(amount_halalas) FROM payments p WHERE p.student_id = s.id AND p.status = 'confirmed' AND p.reverses_payment_id IS NULL), 0) AS paid_halalas,
         coalesce((SELECT sum(amount_halalas) FROM installments i WHERE i.student_id = s.id AND i.status IN ('pending','partial') AND i.due_date < current_date), 0) AS overdue_candidate_halalas
    FROM students s;

CREATE VIEW v_branch_budget_status AS
  SELECT b.branch_id, b.period_month, b.category_id, b.amount_halalas AS budget_halalas,
         coalesce((SELECT sum(e.net_halalas) FROM expenses e
                    WHERE e.branch_id = b.branch_id AND e.status = 'confirmed' AND e.reverses_expense_id IS NULL
                      AND date_trunc('month', e.expense_date) = b.period_month
                      AND (b.category_id IS NULL OR e.category_id = b.category_id)), 0) AS actual_halalas,
         CASE WHEN b.category_id IS NULL THEN coalesce((SELECT sum(po.net_halalas) FROM purchase_orders po
                    WHERE po.branch_id = b.branch_id AND date_trunc('month', po.issue_date) = b.period_month
                      AND po.status IN ('approved','sent','acknowledged','partially_received','received')
                      AND NOT EXISTS (SELECT 1 FROM supplier_invoices si WHERE si.po_id = po.id AND si.status IN ('approved','paid'))), 0) ELSE 0 END AS committed_halalas,
         b.warn_at_percent
    FROM branch_budgets b;

CREATE VIEW v_purchase_period_usage AS
  SELECT po.branch_id, 'weekly'::text AS period, date_trunc('week', po.issue_date)::date AS period_start, sum(po.net_halalas)::bigint AS ordered_halalas
    FROM purchase_orders po WHERE po.status NOT IN ('draft','cancelled') GROUP BY po.branch_id, date_trunc('week', po.issue_date)
  UNION ALL
  SELECT po.branch_id, 'monthly', date_trunc('month', po.issue_date)::date, sum(po.net_halalas)::bigint
    FROM purchase_orders po WHERE po.status NOT IN ('draft','cancelled') GROUP BY po.branch_id, date_trunc('month', po.issue_date);

-- VAT display reports (trial period): output VAT on issued sales invoices, input VAT on approved/paid supplier invoices.
CREATE VIEW v_vat_sales AS
  SELECT branch_id, date_trunc('month', issue_date)::date AS month, count(*) AS invoices, sum(net_halalas)::bigint AS net_halalas, sum(vat_halalas)::bigint AS vat_halalas, sum(gross_halalas)::bigint AS gross_halalas
    FROM sales_invoices WHERE status = 'issued' GROUP BY branch_id, date_trunc('month', issue_date);

CREATE VIEW v_vat_purchases AS
  SELECT branch_id, date_trunc('month', invoice_date)::date AS month, count(*) AS invoices, sum(net_halalas)::bigint AS net_halalas, sum(vat_halalas)::bigint AS vat_halalas, sum(gross_halalas)::bigint AS gross_halalas
    FROM supplier_invoices WHERE status IN ('approved','paid') GROUP BY branch_id, date_trunc('month', invoice_date);

CREATE VIEW v_audit_workflow AS
  SELECT a.id, a.occurred_at, a.action, a.subject_type, a.subject_no, a.actor_member_id, a.actor_role, a.branch_id, a.result,
         a.otp_sent_at, a.otp_verified_at, extract(epoch FROM (a.otp_verified_at - a.otp_sent_at))::int AS seconds_to_confirm,
         a.ip_sent, a.ip_verified, a.reason
    FROM audit_events a;

-- ============================================================================================================
-- 11. Reference data (idempotent)
-- ============================================================================================================
INSERT INTO tax_rates (code, name, rate, category, valid_from) VALUES
  ('VAT15', 'ضريبة القيمة المضافة 15%', 15, 'standard', '2020-07-01'),
  ('VAT0',  'نسبة صفرية', 0, 'zero_rated', '2018-01-01'),
  ('VATEX', 'معفى', 0, 'exempt', '2018-01-01')
ON CONFLICT DO NOTHING;

INSERT INTO units (code, name) VALUES ('PCS','قطعة'),('BOX','علبة'),('CARTON','كرتون'),('PACK','رزمة'),('REAM','رزمة ورق'),('LITER','لتر'),('KG','كيلوجرام'),('SET','طقم'),('HOUR','ساعة')
ON CONFLICT DO NOTHING;

INSERT INTO expense_categories (code, name, is_petty) VALUES
  ('SALARY','رواتب',false),('RENT','إيجار',false),('UTILITY','مرافق',false),('MAINT','صيانة عامة',false),('AC_MAINT','صيانة المكيفات',false),
  ('SECURITY','خدمات أمنية',false),('CLEANING','خدمات نظافة',false),('EQUIP','تجهيزات',false),('MARKETING','تسويق',false),
  ('PAPER','ورقيات',true),('LIGHTING','لمبات وإضاءة',true),('STATIONERY','قرطاسية',true),('CLEAN_SUPPLIES','مستلزمات نظافة',true),('OTHER','أخرى',false)
ON CONFLICT DO NOTHING;

INSERT INTO item_categories (code, name) VALUES
  ('LAB','مستهلكات المعامل'),('STAT','قرطاسية'),('BOOK','كتب وملازم'),('MAINT','صيانة وتكييف'),('CLEAN','نظافة'),('IT','أجهزة وتجهيزات'),('OTHER','أخرى')
ON CONFLICT DO NOTHING;

INSERT INTO leave_types (code, name, is_paid, annual_days) VALUES
  ('ANNUAL','إجازة سنوية',true,30),('SICK','إجازة مرضية',true,NULL),('UNPAID','إجازة بدون راتب',false,NULL),
  ('EMERGENCY','إجازة اضطرارية',true,NULL),('HAJJ','إجازة حج',true,NULL),('MARRIAGE','إجازة زواج',true,5)
ON CONFLICT DO NOTHING;

INSERT INTO match_tolerances (category_id, price_percent, qty_percent, valid_from) VALUES (NULL, 0, 0, '2026-01-01')
ON CONFLICT DO NOTHING;

INSERT INTO org_settings (key, value, description) VALUES
  ('vat.default_rate','15','نسبة ضريبة القيمة المضافة الافتراضية'),
  ('vat.mode','display_only','فترة التجربة: عرض الضريبة دون ربط مع منصة فاتورة'),
  ('otp.ttl_seconds','300','مدة صلاحية رمز التأكيد'),
  ('otp.max_attempts','5','عدد محاولات إدخال الرمز'),
  ('otp.resend_cooldown_seconds','60','الفاصل بين إعادة الإرسال'),
  ('procurement.min_quotes','3','الحد الأدنى لعروض الأسعار لكل طلب (ثابت لكل المبالغ)'),
  ('procurement.escalation_hours','24','مهلة تصعيد الاعتماد إلى الإدارة الرئيسية'),
  ('budget.period','monthly','دورة الميزانية')
ON CONFLICT DO NOTHING;

-- ===== 0004_table_comments =====
-- Arabic purpose of each table, stored in the database itself (visible in psql dt+, DBeaver, pgAdmin).
-- Source of truth: lib/db/scripts/table-comments.mjs (the ER generator fails if a table lacks an entry).
COMMENT ON TABLE branches IS 'الفروع (المركز الرئيسي والفروع)، ولكل فرع رقم ضريبي وحالة';

COMMENT ON TABLE org_settings IS 'إعدادات المؤسسة (نسبة الضريبة، سياسة OTP، عدد العروض المطلوبة...)';

COMMENT ON TABLE documents IS 'سجل المرفقات (عروض أسعار، فواتير، عقود) مع بصمة الملف ومفتاح التخزين';

COMMENT ON TABLE document_sequences IS 'عدادات الترقيم المتسلسل للمستندات (PO-2026-000123) دون فجوات';

COMMENT ON TABLE notifications IS 'صندوق الإشعارات داخل النظام (تنبيهات الحد الأدنى، الميزانية، الاعتماد)';

COMMENT ON TABLE departments IS 'الأقسام الإدارية، عامة أو تابعة لفرع، بتدرج هرمي';

COMMENT ON TABLE job_titles IS 'المسميات الوظيفية';

COMMENT ON TABLE employees IS 'سجل الموظفين: الفرع والقسم والراتب والبيانات الشخصية';

COMMENT ON TABLE leave_types IS 'أنواع الإجازات (سنوية، مرضية، اضطرارية...)';

COMMENT ON TABLE leave_requests IS 'طلبات الإجازة؛ يمنع النظام تداخل إجازتين لنفس الموظف';

COMMENT ON TABLE approval_delegations IS 'تفويض الصلاحيات (تقترحه الموارد البشرية ويعتمده المدير العام) بمدة محددة';

COMMENT ON TABLE shifts IS 'ورديات الدوام وفترة السماح';

COMMENT ON TABLE employee_shifts IS 'إسناد الورديات للموظفين بفترات صلاحية';

COMMENT ON TABLE payroll_runs IS 'دورات الرواتب الشهرية لكل فرع (مسودة، معتمدة، مصروفة)';

COMMENT ON TABLE payroll_lines IS 'بنود الرواتب لكل موظف؛ تُقفل بعد اعتماد الدورة';

COMMENT ON TABLE electricity_meters IS 'عدادات الكهرباء الرئيسية والفرعية لكل فرع';

COMMENT ON TABLE rooms IS 'القاعات والمعامل: النوع والمساحة والسعة وقدرة الأجهزة والعداد';

COMMENT ON TABLE asset_categories IS 'تصنيفات الأصول بتدرج هرمي وعمر افتراضي';

COMMENT ON TABLE assets IS 'الأصول والتجهيزات داخل القاعات: القيمة والشراء والإهلاك والحالة';

COMMENT ON TABLE asset_maintenance IS 'جدولة الصيانة وسجلها وتكلفتها';

COMMENT ON TABLE diplomas IS 'الدبلومات: المدة والساعات وشروط القبول والسعر (شامل/غير شامل الضريبة) مع صافٍ وإجمالي مولَّدين';

COMMENT ON TABLE levels IS 'مستويات كل دبلوم';

COMMENT ON TABLE subjects IS 'المواد: المستوى والسعر والساعات';

COMMENT ON TABLE subject_prerequisites IS 'المتطلبات السابقة للمواد (مستوى أسبق في الدبلوم نفسه)';

COMMENT ON TABLE students IS 'الطلاب: الفرع والدبلوم والمستوى والبيانات الشخصية وحساب البوابة';

COMMENT ON TABLE student_subjects IS 'تسجيل الطالب في المواد وحالته فيها';

COMMENT ON TABLE instructors IS 'المدربون: المؤهل وأجر الساعة والساعات الأسبوعية';

COMMENT ON TABLE instructor_subjects IS 'المواد التي يقدمها كل مدرب';

COMMENT ON TABLE instructor_evaluations IS 'تقييم أداء المدربين (التدريس، الالتزام، آراء الطلاب)';

COMMENT ON TABLE session_recurrences IS 'أنماط الجدول الأسبوعي المتكرر';

COMMENT ON TABLE class_sessions IS 'الحصص: القاعة والمدرب والوقت؛ تمنع قيود الاستبعاد حجز القاعة أو المدرب مرتين';

COMMENT ON TABLE session_students IS 'الطلاب المسجلون في كل حصة؛ يتحقق المحفّز من السعة والتعارض';

COMMENT ON TABLE attendance_records IS 'حضور الطلاب في الحصص (يدوي أو بالبطاقة)';

COMMENT ON TABLE grades IS 'درجات الطلاب في المواد';

COMMENT ON TABLE tax_rates IS 'نسب ضريبة القيمة المضافة وفئاتها وفترات سريانها';

COMMENT ON TABLE sales_invoices IS 'فواتير المبيعات (قياسية أو مبسطة) بحقول جاهزة للفوترة الإلكترونية';

COMMENT ON TABLE sales_invoice_lines IS 'بنود فواتير المبيعات، والضريبة والصافي مولَّدان';

COMMENT ON TABLE installments IS 'أقساط الطلاب وتواريخ استحقاقها';

COMMENT ON TABLE payments IS 'المبالغ المحصلة من الطلاب؛ تُؤكَّد برمز OTP وتتجمد وتُصحَّح بقيد عكسي';

COMMENT ON TABLE payment_allocations IS 'توزيع الدفعات على الأقساط';

COMMENT ON TABLE expense_categories IS 'فئات المصروفات (مع تمييز النثريات)';

COMMENT ON TABLE expenses IS 'المصروفات التشغيلية المؤكَّدة؛ تتجمد بعد التأكيد';

COMMENT ON TABLE utility_invoices IS 'فواتير الكهرباء: فاتورة واحدة لكل عداد وشهر';

COMMENT ON TABLE branch_budgets IS 'الميزانية الشهرية لكل فرع (إجمالية أو لفئة) ونسبة التنبيه';

COMMENT ON TABLE cost_report_snapshots IS 'لقطات تقارير التكلفة المحسوبة بسياسة معتمدة';

COMMENT ON TABLE item_categories IS 'تصنيفات الأصناف';

COMMENT ON TABLE units IS 'وحدات القياس';

COMMENT ON TABLE items IS 'بطاقات الأصناف بكود تلقائي ونوع وطريقة تقييم';

COMMENT ON TABLE warehouses IS 'المستودعات (مستودع لكل فرع)';

COMMENT ON TABLE stock_levels IS 'الحد الأدنى والأقصى وكمية إعادة الطلب لكل صنف ومستودع';

COMMENT ON TABLE stock_movements IS 'دفتر حركات المخزون (إضافة فقط)؛ الرصيد = مجموع الحركات ولا يسمح برصيد سالب';

COMMENT ON TABLE stock_transfers IS 'مستندات النقل بين المستودعات';

COMMENT ON TABLE stock_transfer_lines IS 'بنود النقل';

COMMENT ON TABLE stock_counts IS 'الجرد الفعلي للمستودعات';

COMMENT ON TABLE stock_count_lines IS 'بنود الجرد وفروقاته وأسبابها';

COMMENT ON TABLE reorder_alerts IS 'تنبيهات الوصول للحد الأدنى؛ تنبيه مفتوح واحد لكل صنف ومستودع';

COMMENT ON TABLE suppliers IS 'الموردون برقم ضريبي مُتحقَّق من شكله؛ لا يُعتمد مورد بلا رقم ضريبي';

COMMENT ON TABLE supplier_categories IS 'تخصصات الموردين بحسب تصنيف الأصناف';

COMMENT ON TABLE purchase_requests IS 'طلبات الشراء، من تنبيه المخزون أو يدويًا';

COMMENT ON TABLE purchase_request_lines IS 'أصناف وكميات طلب الشراء';

COMMENT ON TABLE rfqs IS 'طلبات عروض الأسعار وموعدها النهائي';

COMMENT ON TABLE rfq_suppliers IS 'الموردون المدعوون لكل طلب عروض';

COMMENT ON TABLE quotations IS 'عروض الأسعار المدخلة، عرض واحد لكل مورد';

COMMENT ON TABLE quotation_lines IS 'أسعار بنود العرض، والصافي والضريبة مولَّدان';

COMMENT ON TABLE quotation_evaluations IS 'تقييم العروض فنيًا وجودةً وماليًا';

COMMENT ON TABLE procurement_exceptions IS 'استثناءات قاعدة الثلاثة عروض والشراء المباشر بسبب مكتوب واعتماد';

COMMENT ON TABLE rfq_awards IS 'الترسية؛ تتطلب ثلاثة عروض، ومبررًا إن لم تكن الأقل سعرًا';

COMMENT ON TABLE purchase_orders IS 'أوامر الشراء باسم الجهة؛ تتجمد بعد التجهيز، ولا يعتمدها من أعدّها';

COMMENT ON TABLE purchase_order_lines IS 'بنود أمر الشراء';

COMMENT ON TABLE goods_receipts IS 'محاضر استلام البضاعة';

COMMENT ON TABLE goods_receipt_lines IS 'كميات الاستلام والمقبول والمرفوض ونتيجة الجودة';

COMMENT ON TABLE supplier_invoices IS 'فواتير الموردين؛ تمنع القاعدة تكرار رقم الفاتورة لنفس المورد';

COMMENT ON TABLE supplier_invoice_lines IS 'بنود فاتورة المورد وتصنيفها';

COMMENT ON TABLE match_tolerances IS 'نسب التسامح في المطابقة الثلاثية للسعر والكمية';

COMMENT ON TABLE supplier_payments IS 'مدفوعات الموردين';

COMMENT ON TABLE purchase_limits IS 'سقوف الشراء الأسبوعية والشهرية (من المدير العام)';

COMMENT ON TABLE direct_purchase_policies IS 'شروط مسار الشراء المباشر الصغير';

COMMENT ON TABLE otp_challenges IS 'رموز التأكيد: بصمة الرمز مرتبطة بالمستخدم والإجراء والمستند، مع زمن الإرسال والتصديق وعنوان IP';

COMMENT ON TABLE audit_events IS 'سجل المراجعة المتسلسل بالبصمات؛ إضافة فقط';

COMMENT ON TABLE identity_cards IS 'البطاقات الرقمية والفيزيائية برمز معتّم ولا يُخزَّن إلا بصمته';

COMMENT ON TABLE presence_events IS 'حركات الدخول والخروج وحضور القاعات والحصص';

COMMENT ON TABLE education_records IS 'السجلات القديمة لكل الكيانات (فروع، قاعات، طلاب، حصص...) بعمود JSONB';

COMMENT ON TABLE education_audit IS 'سجل تدقيق مبسط قديم';

COMMENT ON TABLE org_members IS 'حسابات أعضاء المؤسسة وأدوارهم ونطاقهم (مرجع كل الجداول للمستخدمين)';

COMMENT ON TABLE cost_policies IS 'سياسات التكلفة المعتمدة والمسودات';

COMMIT;
