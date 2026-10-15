CREATE TABLE "flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"trading_partner_id" uuid NOT NULL,
	"message_type" "message_type" NOT NULL,
	"name" text NOT NULL,
	"inbound_channel_id" uuid NOT NULL,
	"destination_channel_id" uuid NOT NULL,
	"mapping_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_trading_partner_id_trading_partners_id_fk" FOREIGN KEY ("trading_partner_id") REFERENCES "public"."trading_partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_inbound_channel_id_channels_id_fk" FOREIGN KEY ("inbound_channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_destination_channel_id_channels_id_fk" FOREIGN KEY ("destination_channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_mapping_version_id_mapping_versions_id_fk" FOREIGN KEY ("mapping_version_id") REFERENCES "public"."mapping_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flows_workspace_id_index" ON "flows" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "flows_trading_partner_id_index" ON "flows" USING btree ("trading_partner_id");--> statement-breakpoint
CREATE INDEX "flows_inbound_channel_id_index" ON "flows" USING btree ("inbound_channel_id");--> statement-breakpoint
CREATE INDEX "flows_destination_channel_id_index" ON "flows" USING btree ("destination_channel_id");--> statement-breakpoint
CREATE INDEX "flows_mapping_version_id_index" ON "flows" USING btree ("mapping_version_id");