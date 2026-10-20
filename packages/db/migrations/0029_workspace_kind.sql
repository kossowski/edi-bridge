CREATE TYPE "public"."workspace_kind" AS ENUM('standard', 'showcase', 'sandbox');--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "seeded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "kind" "workspace_kind" DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "seeded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "last_reset_at" timestamp with time zone;