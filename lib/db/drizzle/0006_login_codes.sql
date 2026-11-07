CREATE TABLE "login_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"code_hmac" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"requested_ip" "inet",
	"used_ip" "inet",
	CONSTRAINT "login_codes_status_ck" CHECK ("login_codes"."status" in ('pending','used','expired','failed')),
	CONSTRAINT "login_codes_used_ck" CHECK (("login_codes"."status" = 'used') = ("login_codes"."used_at" is not null))
);
--> statement-breakpoint
CREATE INDEX "login_codes_email_idx" ON "login_codes" USING btree (lower("email"),"requested_at");
--> statement-breakpoint
COMMENT ON TABLE login_codes IS 'رموز الدخول المرسلة بالبريد: بصمة الرمز فقط، صالحة مرة واحدة ولمدة قصيرة';
