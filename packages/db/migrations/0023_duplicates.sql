ALTER TABLE "documents" ADD COLUMN "interchange_sender" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "interchange_control_reference" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "duplicate_of_run_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_duplicate_of_run_id_runs_id_fk" FOREIGN KEY ("duplicate_of_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_interchange_index" ON "documents" USING btree ("workspace_id","interchange_sender","interchange_control_reference");--> statement-breakpoint
CREATE INDEX "runs_duplicate_of_run_id_index" ON "runs" USING btree ("duplicate_of_run_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_interchange" CHECK (num_nonnulls("documents"."interchange_sender", "documents"."interchange_control_reference") in (0, 2));--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_duplicate" CHECK (("runs"."status" = 'duplicate') = ("runs"."duplicate_of_run_id" is not null));