CREATE TYPE "public"."character_set" AS ENUM('UNOA', 'UNOB', 'UNOC', 'UNOD', 'UNOE', 'UNOF');--> statement-breakpoint
CREATE TABLE "trading_partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"gln" text,
	"character_set" character_set NOT NULL,
	"acknowledgement_time_limit_hours" integer NOT NULL,
	"test_mode" boolean DEFAULT true NOT NULL,
	"test_interchange_sent_at" timestamp with time zone,
	"contrl_received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acknowledgement_time_limit_hours_range" CHECK ("trading_partners"."acknowledgement_time_limit_hours" between 1 and 168)
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"gln" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trading_partners" ADD CONSTRAINT "trading_partners_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trading_partners_workspace_id_index" ON "trading_partners" USING btree ("workspace_id");