ALTER TABLE "runs" ADD COLUMN "control_reference" integer;--> statement-breakpoint
ALTER TABLE "trading_partners" ADD COLUMN "next_control_reference" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_control_reference" CHECK ("runs"."control_reference" >= 1);--> statement-breakpoint
ALTER TABLE "trading_partners" ADD CONSTRAINT "trading_partners_next_control_reference" CHECK ("trading_partners"."next_control_reference" >= 1);