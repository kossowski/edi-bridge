CREATE TYPE "public"."failure_stage" AS ENUM('parse', 'validation', 'mapping', 'delivery');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('received', 'processing', 'delivered', 'failed', 'duplicate');--> statement-breakpoint
CREATE TYPE "public"."run_step_stage" AS ENUM('receipt', 'parse', 'validation', 'mapping', 'delivery');--> statement-breakpoint
CREATE TYPE "public"."run_step_status" AS ENUM('succeeded', 'failed', 'running', 'pending', 'skipped');--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"content" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_steps" (
	"run_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"stage" "run_step_stage" NOT NULL,
	"status" "run_step_status" DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "run_steps_run_id_position_pk" PRIMARY KEY("run_id","position"),
	CONSTRAINT "run_steps_run_id_stage_unique" UNIQUE("run_id","stage"),
	CONSTRAINT "run_steps_position" CHECK ("run_steps"."position" >= 0),
	CONSTRAINT "run_steps_timings" CHECK (case "run_steps"."status"
        when 'pending' then num_nonnulls("run_steps"."started_at", "run_steps"."finished_at") = 0
        when 'skipped' then num_nonnulls("run_steps"."started_at", "run_steps"."finished_at") = 0
        when 'running' then "run_steps"."started_at" is not null and "run_steps"."finished_at" is null
        else coalesce("run_steps"."started_at" <= "run_steps"."finished_at", false)
      end)
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"trading_partner_id" uuid NOT NULL,
	"mapping_version_id" uuid,
	"manual_submission" boolean NOT NULL,
	"status" "run_status" DEFAULT 'received' NOT NULL,
	"failure_stage" "failure_stage",
	"business_reference" text,
	"error" jsonb,
	"problem" jsonb,
	"waiting_for_trading_partner_since" timestamp with time zone,
	"output" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runs_failure" CHECK (num_nonnulls("runs"."failure_stage", "runs"."error", "runs"."problem") = case when "runs"."status" = 'failed' then 3 else 0 end),
	CONSTRAINT "runs_waiting_for_trading_partner" CHECK ("runs"."status" = 'failed' or "runs"."waiting_for_trading_partner_since" is null),
	CONSTRAINT "runs_output" CHECK ("runs"."failure_stage" is null or "runs"."failure_stage" = 'delivery' or "runs"."output" is null)
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_trading_partner_id_trading_partners_id_fk" FOREIGN KEY ("trading_partner_id") REFERENCES "public"."trading_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_mapping_version_id_mapping_versions_id_fk" FOREIGN KEY ("mapping_version_id") REFERENCES "public"."mapping_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_workspace_id_index" ON "documents" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "runs_workspace_id_received_at_index" ON "runs" USING btree ("workspace_id","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "runs_document_id_index" ON "runs" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "runs_flow_id_index" ON "runs" USING btree ("flow_id");--> statement-breakpoint
CREATE INDEX "runs_trading_partner_id_index" ON "runs" USING btree ("trading_partner_id");--> statement-breakpoint
CREATE INDEX "runs_mapping_version_id_index" ON "runs" USING btree ("mapping_version_id");