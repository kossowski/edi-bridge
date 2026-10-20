CREATE TYPE "public"."acknowledgement_not_sent_reason" AS ENUM('noOutboundChannel', 'ambiguousChannel', 'workspaceGlnMissing', 'unechoableInterchangeHeader');--> statement-breakpoint
CREATE TABLE "acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"trading_partner_id" uuid NOT NULL,
	"channel_id" uuid,
	"control_reference" integer,
	"content" text,
	"not_sent_reason" "acknowledgement_not_sent_reason",
	"delivery_attempted_at" timestamp with time zone,
	"delivery_error" text,
	"handed_over_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acknowledgements_documentId_unique" UNIQUE("document_id"),
	CONSTRAINT "acknowledgements_content" CHECK (num_nonnulls("acknowledgements"."content", "acknowledgements"."control_reference") in (0, 2)),
	CONSTRAINT "acknowledgements_not_sent_reason" CHECK (("acknowledgements"."not_sent_reason" is null) = ("acknowledgements"."channel_id" is not null and "acknowledgements"."content" is not null)),
	CONSTRAINT "acknowledgements_handed_over" CHECK ("acknowledgements"."handed_over_at" is null or "acknowledgements"."not_sent_reason" is null),
	CONSTRAINT "acknowledgements_control_reference" CHECK ("acknowledgements"."control_reference" >= 1)
);
--> statement-breakpoint
ALTER TABLE "acknowledgements" ADD CONSTRAINT "acknowledgements_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acknowledgements" ADD CONSTRAINT "acknowledgements_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acknowledgements" ADD CONSTRAINT "acknowledgements_trading_partner_id_trading_partners_id_fk" FOREIGN KEY ("trading_partner_id") REFERENCES "public"."trading_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acknowledgements" ADD CONSTRAINT "acknowledgements_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "acknowledgements_workspace_id_index" ON "acknowledgements" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "acknowledgements_trading_partner_id_index" ON "acknowledgements" USING btree ("trading_partner_id");--> statement-breakpoint
CREATE INDEX "acknowledgements_channel_id_index" ON "acknowledgements" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "acknowledgements_unsent_index" ON "acknowledgements" USING btree ("delivery_attempted_at") WHERE "acknowledgements"."handed_over_at" is null and "acknowledgements"."not_sent_reason" is null;