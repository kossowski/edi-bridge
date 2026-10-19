ALTER TABLE "runs" ADD COLUMN "replaces_run_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_replaces_run_id_runs_id_fk" FOREIGN KEY ("replaces_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_replacesRunId_unique" UNIQUE("replaces_run_id");