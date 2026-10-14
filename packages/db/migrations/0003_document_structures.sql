CREATE TYPE "public"."document_format" AS ENUM('json', 'csv');--> statement-breakpoint
CREATE TYPE "public"."json_root" AS ENUM('object', 'array');--> statement-breakpoint
CREATE TABLE "document_structures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"format" "document_format" NOT NULL,
	"json_root" json_root,
	"csv" jsonb,
	"sample_file_name" text,
	"sample_text" text,
	"sample_taken_at" timestamp with time zone,
	"children" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_structures_format_settings" CHECK (("document_structures"."format" = 'json') = ("document_structures"."json_root" is not null) and ("document_structures"."format" = 'csv') = ("document_structures"."csv" is not null)),
	CONSTRAINT "document_structures_sample_complete" CHECK (num_nonnulls("document_structures"."sample_file_name", "document_structures"."sample_text", "document_structures"."sample_taken_at") in (0, 3))
);
--> statement-breakpoint
ALTER TABLE "document_structures" ADD CONSTRAINT "document_structures_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_structures_workspace_id_index" ON "document_structures" USING btree ("workspace_id");