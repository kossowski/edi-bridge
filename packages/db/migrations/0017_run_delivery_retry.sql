ALTER TABLE "runs" ADD COLUMN "delivery_input" jsonb;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "handed_over_at" timestamp with time zone;