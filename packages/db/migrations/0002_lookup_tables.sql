CREATE TYPE "public"."lookup_table_kind" AS ENUM('units', 'countries', 'addresses', 'other');--> statement-breakpoint
CREATE TABLE "lookup_table_entries" (
	"lookup_table_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"source_code" text NOT NULL,
	"target_code" text NOT NULL,
	CONSTRAINT "lookup_table_entries_lookup_table_id_position_pk" PRIMARY KEY("lookup_table_id","position"),
	CONSTRAINT "lookup_table_entries_source_code_unique" UNIQUE("lookup_table_id","source_code"),
	CONSTRAINT "source_code_length" CHECK (char_length("lookup_table_entries"."source_code") between 1 and 70),
	CONSTRAINT "target_code_length" CHECK (char_length("lookup_table_entries"."target_code") between 1 and 70)
);
--> statement-breakpoint
CREATE TABLE "lookup_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"trading_partner_id" uuid,
	"name" text NOT NULL,
	"kind" "lookup_table_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lookup_table_entries" ADD CONSTRAINT "lookup_table_entries_lookup_table_id_lookup_tables_id_fk" FOREIGN KEY ("lookup_table_id") REFERENCES "public"."lookup_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lookup_tables" ADD CONSTRAINT "lookup_tables_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lookup_tables" ADD CONSTRAINT "lookup_tables_trading_partner_id_trading_partners_id_fk" FOREIGN KEY ("trading_partner_id") REFERENCES "public"."trading_partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lookup_tables_workspace_id_index" ON "lookup_tables" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "lookup_tables_trading_partner_id_index" ON "lookup_tables" USING btree ("trading_partner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lookup_tables_workspace_name_unique" ON "lookup_tables" USING btree ("workspace_id",lower("name")) WHERE "lookup_tables"."trading_partner_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "lookup_tables_trading_partner_name_unique" ON "lookup_tables" USING btree ("workspace_id","trading_partner_id",lower("name"));