ALTER TABLE "runs" ADD COLUMN "message_index" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_message_index" CHECK ("runs"."message_index" >= 1);