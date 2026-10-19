CREATE TYPE "public"."acknowledgement_state" AS ENUM('pending', 'accepted', 'rejected', 'overdue');--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "acknowledgement_status" "acknowledgement_state";--> statement-breakpoint
CREATE INDEX "runs_trading_partner_id_control_reference_index" ON "runs" USING btree ("trading_partner_id","control_reference");--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_acknowledgement_status" CHECK ("runs"."acknowledgement_status" is null or ("runs"."handed_over_at" is not null and "runs"."control_reference" is not null));