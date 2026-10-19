CREATE TABLE "ai_token_usage" (
	"workspace_id" uuid NOT NULL,
	"day" date NOT NULL,
	"tokens" integer NOT NULL,
	CONSTRAINT "ai_token_usage_workspace_id_day_pk" PRIMARY KEY("workspace_id","day"),
	CONSTRAINT "tokens_not_negative" CHECK ("ai_token_usage"."tokens" >= 0)
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "ai_daily_token_limit" integer DEFAULT 200000 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_token_usage" ADD CONSTRAINT "ai_token_usage_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "ai_daily_token_limit_range" CHECK ("workspaces"."ai_daily_token_limit" between 0 and 10000000);