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
--> statement-breakpoint
CREATE TABLE "document_sequences" (
	"prefix" text NOT NULL,
	"year" integer NOT NULL,
	"last_value" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "org_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"description" text,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "employee_shifts" (
	"employee_id" bigint NOT NULL,
	"shift_id" bigint NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	CONSTRAINT "employee_shifts_employee_id_valid_from_pk" PRIMARY KEY("employee_id","valid_from"),
	CONSTRAINT "employee_shifts_dates_ck" CHECK ("employee_shifts"."valid_to" is null or "employee_shifts"."valid_to" >= "employee_shifts"."valid_from")
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "job_titles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "job_titles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"grade" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "leave_types_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_paid" boolean DEFAULT true NOT NULL,
	"annual_days" integer
);
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "shifts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"grace_minutes" integer DEFAULT 10 NOT NULL,
	CONSTRAINT "shifts_grace_ck" CHECK ("shifts"."grace_minutes" between 0 and 120)
);
--> statement-breakpoint
CREATE TABLE "asset_categories" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "asset_categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"parent_id" bigint,
	"name" text NOT NULL,
	"default_useful_life_months" integer
);
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "electricity_meters" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "electricity_meters_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"branch_id" bigint NOT NULL,
	"meter_no" text NOT NULL,
	"description" text,
	"is_sub_meter" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "electricity_meters_status_ck" CHECK ("electricity_meters"."status" in ('active','inactive'))
);
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "instructor_subjects" (
	"instructor_id" bigint NOT NULL,
	"subject_id" bigint NOT NULL,
	CONSTRAINT "instructor_subjects_instructor_id_subject_id_pk" PRIMARY KEY("instructor_id","subject_id")
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "levels" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "levels_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"diploma_id" bigint NOT NULL,
	"level_no" integer NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "levels_no_ck" CHECK ("levels"."level_no" >= 1)
);
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "session_students" (
	"session_id" bigint NOT NULL,
	"student_id" bigint NOT NULL,
	CONSTRAINT "session_students_session_id_student_id_pk" PRIMARY KEY("session_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "student_subjects" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "student_subjects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"student_id" bigint NOT NULL,
	"subject_id" bigint NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'enrolled' NOT NULL,
	CONSTRAINT "student_subjects_status_ck" CHECK ("student_subjects"."status" in ('enrolled','passed','failed','withdrawn'))
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "subject_prerequisites" (
	"subject_id" bigint NOT NULL,
	"prerequisite_id" bigint NOT NULL,
	CONSTRAINT "subject_prerequisites_subject_id_prerequisite_id_pk" PRIMARY KEY("subject_id","prerequisite_id"),
	CONSTRAINT "subject_prerequisites_self_ck" CHECK ("subject_prerequisites"."subject_id" <> "subject_prerequisites"."prerequisite_id")
);
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "cost_report_snapshots" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cost_report_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"policy_version" integer NOT NULL,
	"result" jsonb NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "expense_categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"parent_id" bigint,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_petty" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"payment_id" bigint NOT NULL,
	"installment_id" bigint NOT NULL,
	"amount_halalas" bigint NOT NULL,
	CONSTRAINT "payment_allocations_payment_id_installment_id_pk" PRIMARY KEY("payment_id","installment_id"),
	CONSTRAINT "payment_allocations_amount_ck" CHECK ("payment_allocations"."amount_halalas" > 0)
);
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "item_categories" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "item_categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"parent_id" bigint,
	"code" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "stock_count_lines" (
	"count_id" bigint NOT NULL,
	"item_id" bigint NOT NULL,
	"system_qty" numeric(14, 3) NOT NULL,
	"counted_qty" numeric(14, 3) NOT NULL,
	"reason" text,
	CONSTRAINT "stock_count_lines_count_id_item_id_pk" PRIMARY KEY("count_id","item_id"),
	CONSTRAINT "stock_count_lines_ck" CHECK ("stock_count_lines"."counted_qty" >= 0 and ("stock_count_lines"."counted_qty" = "stock_count_lines"."system_qty" or "stock_count_lines"."reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "stock_counts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stock_counts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"warehouse_id" bigint NOT NULL,
	"count_date" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"counted_by" integer NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "stock_counts_status_ck" CHECK ("stock_counts"."status" in ('open','closed','cancelled'))
);
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "stock_transfer_lines" (
	"transfer_id" bigint NOT NULL,
	"item_id" bigint NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"received_qty" numeric(14, 3),
	CONSTRAINT "stock_transfer_lines_transfer_id_item_id_pk" PRIMARY KEY("transfer_id","item_id"),
	CONSTRAINT "stock_transfer_lines_qty_ck" CHECK ("stock_transfer_lines"."qty" > 0 and ("stock_transfer_lines"."received_qty" is null or "stock_transfer_lines"."received_qty" >= 0))
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "units" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "units_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "purchase_request_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_request_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"pr_id" bigint NOT NULL,
	"item_id" bigint NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"notes" text,
	CONSTRAINT "purchase_request_lines_qty_ck" CHECK ("purchase_request_lines"."qty" > 0)
);
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "rfq_suppliers" (
	"rfq_id" bigint NOT NULL,
	"supplier_id" bigint NOT NULL,
	"sent_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	CONSTRAINT "rfq_suppliers_rfq_id_supplier_id_pk" PRIMARY KEY("rfq_id","supplier_id")
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "supplier_categories" (
	"supplier_id" bigint NOT NULL,
	"category_id" bigint NOT NULL,
	CONSTRAINT "supplier_categories_supplier_id_category_id_pk" PRIMARY KEY("supplier_id","category_id")
);
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_org_members_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_member_id_org_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_updated_by_org_members_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_delegator_member_id_org_members_id_fk" FOREIGN KEY ("delegator_member_id") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_delegate_member_id_org_members_id_fk" FOREIGN KEY ("delegate_member_id") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_leave_request_id_leave_requests_id_fk" FOREIGN KEY ("leave_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_proposed_by_org_members_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_approved_by_org_members_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_id_departments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_manager_employee_id_employees_id_fk" FOREIGN KEY ("manager_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_shifts" ADD CONSTRAINT "employee_shifts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_shifts" ADD CONSTRAINT "employee_shifts_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_job_title_id_job_titles_id_fk" FOREIGN KEY ("job_title_id") REFERENCES "public"."job_titles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_org_member_id_org_members_id_fk" FOREIGN KEY ("org_member_id") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_requested_by_org_members_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decided_by_org_members_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_approved_by_org_members_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_parent_id_asset_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."asset_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_maintenance" ADD CONSTRAINT "asset_maintenance_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_category_id_asset_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."asset_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_session_id_class_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."class_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_recorded_by_org_members_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_instructor_id_instructors_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_diploma_id_diplomas_id_fk" FOREIGN KEY ("diploma_id") REFERENCES "public"."diplomas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_recurrence_id_session_recurrences_id_fk" FOREIGN KEY ("recurrence_id") REFERENCES "public"."session_recurrences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "electricity_meters" ADD CONSTRAINT "electricity_meters_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_recorded_by_org_members_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_evaluations" ADD CONSTRAINT "instructor_evaluations_instructor_id_instructors_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_evaluations" ADD CONSTRAINT "instructor_evaluations_evaluated_by_org_members_id_fk" FOREIGN KEY ("evaluated_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_subjects" ADD CONSTRAINT "instructor_subjects_instructor_id_instructors_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_subjects" ADD CONSTRAINT "instructor_subjects_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructors" ADD CONSTRAINT "instructors_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructors" ADD CONSTRAINT "instructors_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructors" ADD CONSTRAINT "instructors_org_member_id_org_members_id_fk" FOREIGN KEY ("org_member_id") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "levels" ADD CONSTRAINT "levels_diploma_id_diplomas_id_fk" FOREIGN KEY ("diploma_id") REFERENCES "public"."diplomas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_meter_id_electricity_meters_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."electricity_meters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_recurrences" ADD CONSTRAINT "session_recurrences_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_recurrences" ADD CONSTRAINT "session_recurrences_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_recurrences" ADD CONSTRAINT "session_recurrences_instructor_id_instructors_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_recurrences" ADD CONSTRAINT "session_recurrences_diploma_id_diplomas_id_fk" FOREIGN KEY ("diploma_id") REFERENCES "public"."diplomas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_recurrences" ADD CONSTRAINT "session_recurrences_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_recurrences" ADD CONSTRAINT "session_recurrences_created_by_org_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_students" ADD CONSTRAINT "session_students_session_id_class_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."class_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_students" ADD CONSTRAINT "session_students_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_subjects" ADD CONSTRAINT "student_subjects_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_subjects" ADD CONSTRAINT "student_subjects_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_diploma_id_diplomas_id_fk" FOREIGN KEY ("diploma_id") REFERENCES "public"."diplomas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_current_level_id_levels_id_fk" FOREIGN KEY ("current_level_id") REFERENCES "public"."levels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_org_member_id_org_members_id_fk" FOREIGN KEY ("org_member_id") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_prerequisites" ADD CONSTRAINT "subject_prerequisites_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_prerequisites" ADD CONSTRAINT "subject_prerequisites_prerequisite_id_subjects_id_fk" FOREIGN KEY ("prerequisite_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_diploma_id_diplomas_id_fk" FOREIGN KEY ("diploma_id") REFERENCES "public"."diplomas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_level_id_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."levels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_budgets" ADD CONSTRAINT "branch_budgets_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_budgets" ADD CONSTRAINT "branch_budgets_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_budgets" ADD CONSTRAINT "branch_budgets_approved_by_org_members_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_report_snapshots" ADD CONSTRAINT "cost_report_snapshots_created_by_org_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_parent_id_expense_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_org_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_reverses_expense_id_expenses_id_fk" FOREIGN KEY ("reverses_expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_sales_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_installment_id_installments_id_fk" FOREIGN KEY ("installment_id") REFERENCES "public"."installments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_collected_by_org_members_id_fk" FOREIGN KEY ("collected_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reverses_payment_id_payments_id_fk" FOREIGN KEY ("reverses_payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_diploma_id_diplomas_id_fk" FOREIGN KEY ("diploma_id") REFERENCES "public"."diplomas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_created_by_org_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_invoices" ADD CONSTRAINT "utility_invoices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_invoices" ADD CONSTRAINT "utility_invoices_meter_id_electricity_meters_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."electricity_meters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_categories" ADD CONSTRAINT "item_categories_parent_id_item_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."item_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_category_id_item_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."item_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_created_by_org_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorder_alerts" ADD CONSTRAINT "reorder_alerts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorder_alerts" ADD CONSTRAINT "reorder_alerts_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_count_id_stock_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."stock_counts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_counted_by_org_members_id_fk" FOREIGN KEY ("counted_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_set_by_org_members_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_issued_to_room_id_rooms_id_fk" FOREIGN KEY ("issued_to_room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_issued_to_department_id_departments_id_fk" FOREIGN KEY ("issued_to_department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_org_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_otp_challenge_id_otp_challenges_id_fk" FOREIGN KEY ("otp_challenge_id") REFERENCES "public"."otp_challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_transfer_id_stock_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."stock_transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_warehouse_id_warehouses_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_warehouse_id_warehouses_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_requested_by_org_members_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_keeper_member_id_org_members_id_fk" FOREIGN KEY ("keeper_member_id") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_purchase_policies" ADD CONSTRAINT "direct_purchase_policies_set_by_org_members_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_grn_id_goods_receipts_id_fk" FOREIGN KEY ("grn_id") REFERENCES "public"."goods_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_po_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("po_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_received_by_org_members_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_tolerances" ADD CONSTRAINT "match_tolerances_category_id_item_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."item_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_tolerances" ADD CONSTRAINT "match_tolerances_set_by_org_members_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_exceptions" ADD CONSTRAINT "procurement_exceptions_pr_id_purchase_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."purchase_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_exceptions" ADD CONSTRAINT "procurement_exceptions_requested_by_org_members_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_exceptions" ADD CONSTRAINT "procurement_exceptions_approved_by_org_members_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_limits" ADD CONSTRAINT "purchase_limits_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_limits" ADD CONSTRAINT "purchase_limits_set_by_org_members_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supersedes_po_id_purchase_orders_id_fk" FOREIGN KEY ("supersedes_po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_pr_id_purchase_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."purchase_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_exception_id_procurement_exceptions_id_fk" FOREIGN KEY ("exception_id") REFERENCES "public"."procurement_exceptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_prepared_by_org_members_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_org_members_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_pr_id_purchase_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."purchase_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_alert_id_reorder_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."reorder_alerts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_requested_by_org_members_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_evaluations" ADD CONSTRAINT "quotation_evaluations_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_evaluations" ADD CONSTRAINT "quotation_evaluations_evaluated_by_org_members_id_fk" FOREIGN KEY ("evaluated_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_entered_by_org_members_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_awards" ADD CONSTRAINT "rfq_awards_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_awards" ADD CONSTRAINT "rfq_awards_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_awards" ADD CONSTRAINT "rfq_awards_exception_id_procurement_exceptions_id_fk" FOREIGN KEY ("exception_id") REFERENCES "public"."procurement_exceptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_awards" ADD CONSTRAINT "rfq_awards_recommended_by_org_members_id_fk" FOREIGN KEY ("recommended_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_awards" ADD CONSTRAINT "rfq_awards_approved_by_org_members_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_suppliers" ADD CONSTRAINT "rfq_suppliers_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_suppliers" ADD CONSTRAINT "rfq_suppliers_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_pr_id_purchase_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."purchase_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_created_by_org_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_categories" ADD CONSTRAINT "supplier_categories_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_categories" ADD CONSTRAINT "supplier_categories_category_id_item_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."item_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_po_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("po_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_approved_by_org_members_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_created_by_org_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("supplier_invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_paid_by_org_members_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_approved_by_org_members_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_member_id_org_members_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_otp_challenge_id_otp_challenges_id_fk" FOREIGN KEY ("otp_challenge_id") REFERENCES "public"."otp_challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_cards" ADD CONSTRAINT "identity_cards_issued_by_org_members_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_member_id_org_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence_events" ADD CONSTRAINT "presence_events_card_id_identity_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."identity_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence_events" ADD CONSTRAINT "presence_events_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence_events" ADD CONSTRAINT "presence_events_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence_events" ADD CONSTRAINT "presence_events_session_id_class_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."class_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence_events" ADD CONSTRAINT "presence_events_device_member_id_org_members_id_fk" FOREIGN KEY ("device_member_id") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "branches_code_uq" ON "branches" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "branches_one_head_office_uq" ON "branches" USING btree ("is_head_office") WHERE "branches"."is_head_office";--> statement-breakpoint
CREATE UNIQUE INDEX "document_sequences_pk" ON "document_sequences" USING btree ("prefix","year");--> statement-breakpoint
CREATE INDEX "documents_owner_idx" ON "documents" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_storage_key_uq" ON "documents" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "notifications_member_unread_idx" ON "notifications" USING btree ("member_id","created_at") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "approval_delegations_delegator_idx" ON "approval_delegations" USING btree ("delegator_member_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_code_uq" ON "departments" USING btree ("code");--> statement-breakpoint
CREATE INDEX "departments_branch_idx" ON "departments" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_no_uq" ON "employees" USING btree ("employee_no");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_national_id_uq" ON "employees" USING btree ("national_id") WHERE "employees"."national_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "employees_member_uq" ON "employees" USING btree ("org_member_id") WHERE "employees"."org_member_id" is not null;--> statement-breakpoint
CREATE INDEX "employees_branch_idx" ON "employees" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "employees_department_idx" ON "employees" USING btree ("department_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_titles_name_uq" ON "job_titles" USING btree ("name");--> statement-breakpoint
CREATE INDEX "leave_requests_employee_idx" ON "leave_requests" USING btree ("employee_id","start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_types_code_uq" ON "leave_types" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_lines_run_employee_uq" ON "payroll_lines" USING btree ("run_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_branch_month_uq" ON "payroll_runs" USING btree ("branch_id","period_month");--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_name_uq" ON "shifts" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_categories_name_uq" ON "asset_categories" USING btree ("parent_id","name");--> statement-breakpoint
CREATE INDEX "asset_maintenance_due_idx" ON "asset_maintenance" USING btree ("due_date") WHERE "asset_maintenance"."status" = 'scheduled';--> statement-breakpoint
CREATE UNIQUE INDEX "assets_tag_uq" ON "assets" USING btree ("asset_tag");--> statement-breakpoint
CREATE INDEX "assets_room_idx" ON "assets" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "assets_branch_idx" ON "assets" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_records_uq" ON "attendance_records" USING btree ("session_id","student_id");--> statement-breakpoint
CREATE INDEX "class_sessions_date_idx" ON "class_sessions" USING btree ("session_date","branch_id");--> statement-breakpoint
CREATE INDEX "class_sessions_room_idx" ON "class_sessions" USING btree ("room_id","session_date");--> statement-breakpoint
CREATE INDEX "class_sessions_instructor_idx" ON "class_sessions" USING btree ("instructor_id","session_date");--> statement-breakpoint
CREATE UNIQUE INDEX "diplomas_code_uq" ON "diplomas" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "electricity_meters_branch_no_uq" ON "electricity_meters" USING btree ("branch_id","meter_no");--> statement-breakpoint
CREATE INDEX "grades_student_subject_idx" ON "grades" USING btree ("student_id","subject_id");--> statement-breakpoint
CREATE INDEX "instructor_evaluations_idx" ON "instructor_evaluations" USING btree ("instructor_id","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "instructors_no_uq" ON "instructors" USING btree ("instructor_no");--> statement-breakpoint
CREATE UNIQUE INDEX "instructors_member_uq" ON "instructors" USING btree ("org_member_id") WHERE "instructors"."org_member_id" is not null;--> statement-breakpoint
CREATE INDEX "instructors_branch_idx" ON "instructors" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "levels_diploma_no_uq" ON "levels" USING btree ("diploma_id","level_no");--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_branch_code_uq" ON "rooms" USING btree ("branch_id","code");--> statement-breakpoint
CREATE INDEX "rooms_meter_idx" ON "rooms" USING btree ("meter_id");--> statement-breakpoint
CREATE INDEX "session_students_student_idx" ON "session_students" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_subjects_uq" ON "student_subjects" USING btree ("student_id","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "students_no_uq" ON "students" USING btree ("student_no");--> statement-breakpoint
CREATE UNIQUE INDEX "students_national_id_uq" ON "students" USING btree ("national_id") WHERE "students"."national_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "students_member_uq" ON "students" USING btree ("org_member_id") WHERE "students"."org_member_id" is not null;--> statement-breakpoint
CREATE INDEX "students_branch_diploma_idx" ON "students" USING btree ("branch_id","diploma_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subjects_code_uq" ON "subjects" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "subjects_diploma_name_uq" ON "subjects" USING btree ("diploma_id","name");--> statement-breakpoint
CREATE INDEX "subjects_level_idx" ON "subjects" USING btree ("level_id");--> statement-breakpoint
CREATE INDEX "cost_report_snapshots_period_idx" ON "cost_report_snapshots" USING btree ("period_from","period_to");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_categories_code_uq" ON "expense_categories" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_no_uq" ON "expenses" USING btree ("expense_no");--> statement-breakpoint
CREATE INDEX "expenses_branch_date_idx" ON "expenses" USING btree ("branch_id","expense_date");--> statement-breakpoint
CREATE INDEX "expenses_category_idx" ON "expenses" USING btree ("category_id","expense_date");--> statement-breakpoint
CREATE UNIQUE INDEX "installments_student_seq_uq" ON "installments" USING btree ("student_id","seq");--> statement-breakpoint
CREATE INDEX "installments_due_idx" ON "installments" USING btree ("due_date") WHERE "installments"."status" in ('pending','partial');--> statement-breakpoint
CREATE UNIQUE INDEX "payments_receipt_no_uq" ON "payments" USING btree ("receipt_no");--> statement-breakpoint
CREATE INDEX "payments_student_idx" ON "payments" USING btree ("student_id","paid_on");--> statement-breakpoint
CREATE INDEX "payments_branch_date_idx" ON "payments" USING btree ("branch_id","paid_on");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_reversal_uq" ON "payments" USING btree ("reverses_payment_id") WHERE "payments"."reverses_payment_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoice_lines_no_uq" ON "sales_invoice_lines" USING btree ("invoice_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoices_no_uq" ON "sales_invoices" USING btree ("invoice_no");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoices_uuid_uq" ON "sales_invoices" USING btree ("invoice_uuid");--> statement-breakpoint
CREATE INDEX "sales_invoices_student_idx" ON "sales_invoices" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "sales_invoices_branch_date_idx" ON "sales_invoices" USING btree ("branch_id","issue_date");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_rates_code_from_uq" ON "tax_rates" USING btree ("code","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "utility_invoices_meter_month_uq" ON "utility_invoices" USING btree ("meter_id","bill_month");--> statement-breakpoint
CREATE UNIQUE INDEX "item_categories_code_uq" ON "item_categories" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "items_code_uq" ON "items" USING btree ("item_code");--> statement-breakpoint
CREATE INDEX "items_category_idx" ON "items" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reorder_alerts_one_open_uq" ON "reorder_alerts" USING btree ("warehouse_id","item_id") WHERE "reorder_alerts"."status" in ('open','in_progress');--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movements_no_uq" ON "stock_movements" USING btree ("movement_no");--> statement-breakpoint
CREATE INDEX "stock_movements_wh_item_idx" ON "stock_movements" USING btree ("warehouse_id","item_id","occurred_at");--> statement-breakpoint
CREATE INDEX "stock_movements_room_idx" ON "stock_movements" USING btree ("issued_to_room_id","occurred_at") WHERE "stock_movements"."issued_to_room_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_transfers_no_uq" ON "stock_transfers" USING btree ("transfer_no");--> statement-breakpoint
CREATE UNIQUE INDEX "units_code_uq" ON "units" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouses_code_uq" ON "warehouses" USING btree ("code");--> statement-breakpoint
CREATE INDEX "warehouses_branch_idx" ON "warehouses" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "goods_receipt_lines_uq" ON "goods_receipt_lines" USING btree ("grn_id","po_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "goods_receipts_no_uq" ON "goods_receipts" USING btree ("grn_no");--> statement-breakpoint
CREATE INDEX "goods_receipts_po_idx" ON "goods_receipts" USING btree ("po_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_lines_no_uq" ON "purchase_order_lines" USING btree ("po_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_no_version_uq" ON "purchase_orders" USING btree ("po_no","version");--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx" ON "purchase_orders" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_branch_status_idx" ON "purchase_orders" USING btree ("branch_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_request_lines_uq" ON "purchase_request_lines" USING btree ("pr_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_requests_no_uq" ON "purchase_requests" USING btree ("pr_no");--> statement-breakpoint
CREATE INDEX "purchase_requests_branch_status_idx" ON "purchase_requests" USING btree ("branch_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "quotation_evaluations_uq" ON "quotation_evaluations" USING btree ("quotation_id","evaluated_by");--> statement-breakpoint
CREATE UNIQUE INDEX "quotation_lines_uq" ON "quotation_lines" USING btree ("quotation_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotations_rfq_supplier_uq" ON "quotations" USING btree ("rfq_id","supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rfqs_no_uq" ON "rfqs" USING btree ("rfq_no");--> statement-breakpoint
CREATE INDEX "rfqs_pr_idx" ON "rfqs" USING btree ("pr_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_invoices_dup_uq" ON "supplier_invoices" USING btree ("supplier_id","supplier_invoice_no");--> statement-breakpoint
CREATE INDEX "supplier_invoices_po_idx" ON "supplier_invoices" USING btree ("po_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_no_uq" ON "suppliers" USING btree ("supplier_no");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_vat_uq" ON "suppliers" USING btree ("vat_number") WHERE "suppliers"."vat_number" is not null;--> statement-breakpoint
CREATE INDEX "audit_events_subject_idx" ON "audit_events" USING btree ("subject_type","subject_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_member_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_time_idx" ON "audit_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_cards_token_uq" ON "identity_cards" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_cards_one_active_uq" ON "identity_cards" USING btree ("holder_type","holder_id") WHERE "identity_cards"."status" = 'active';--> statement-breakpoint
CREATE INDEX "otp_challenges_member_idx" ON "otp_challenges" USING btree ("member_id","sent_at");--> statement-breakpoint
CREATE INDEX "otp_challenges_subject_idx" ON "otp_challenges" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "presence_events_holder_idx" ON "presence_events" USING btree ("holder_type","holder_id","occurred_at");--> statement-breakpoint
CREATE INDEX "presence_events_session_idx" ON "presence_events" USING btree ("session_id") WHERE "presence_events"."session_id" is not null;