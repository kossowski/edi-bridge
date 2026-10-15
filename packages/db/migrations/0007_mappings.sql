CREATE TYPE "public"."message_type" AS ENUM('ORDERS', 'DESADV', 'INVOIC', 'CONTRL');--> statement-breakpoint
CREATE TABLE "mapping_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mapping_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"graph" jsonb NOT NULL,
	"change_note" text,
	"published_by" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mapping_versions_mapping_id_version_unique" UNIQUE("mapping_id","version"),
	CONSTRAINT "mapping_versions_version_positive" CHECK ("mapping_versions"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_structure_id" uuid NOT NULL,
	"message_type" "message_type" NOT NULL,
	"name" text NOT NULL,
	"draft" jsonb NOT NULL,
	"unpublished_changes" boolean DEFAULT true NOT NULL,
	"draft_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mappings_workspace_id_name_unique" UNIQUE("workspace_id","name")
);
--> statement-breakpoint
ALTER TABLE "mapping_versions" ADD CONSTRAINT "mapping_versions_mapping_id_mappings_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_versions" ADD CONSTRAINT "mapping_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mappings" ADD CONSTRAINT "mappings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mappings" ADD CONSTRAINT "mappings_document_structure_id_document_structures_id_fk" FOREIGN KEY ("document_structure_id") REFERENCES "public"."document_structures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mappings_workspace_id_index" ON "mappings" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "mappings_document_structure_id_index" ON "mappings" USING btree ("document_structure_id");