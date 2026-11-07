CREATE TABLE "local_accounts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "local_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"must_change" boolean DEFAULT false NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "local_accounts_email_ck" CHECK ("local_accounts"."email" like '%_@_%')
);
--> statement-breakpoint
CREATE TABLE "local_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"account_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" "inet",
	"user_agent" text
);
--> statement-breakpoint
ALTER TABLE "local_sessions" ADD CONSTRAINT "local_sessions_account_id_local_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."local_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "local_accounts_email_idx" ON "local_accounts" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "local_sessions_account_idx" ON "local_sessions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "local_sessions_expiry_idx" ON "local_sessions" USING btree ("expires_at");
--> statement-breakpoint
COMMENT ON TABLE local_accounts IS 'حسابات الدخول المحلية: بريد وبصمة كلمة المرور (scrypt) بلا مزود هوية خارجي';
--> statement-breakpoint
COMMENT ON TABLE local_sessions IS 'جلسات المتصفح؛ تُخزَّن بصمة الرمز فقط ولا يُخزَّن الرمز نفسه';
