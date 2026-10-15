CREATE TYPE "public"."channel_type" AS ENUM('sftp', 'webhook', 'http');--> statement-breakpoint
CREATE TYPE "public"."direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."sftp_authentication" AS ENUM('password', 'privateKey');--> statement-breakpoint
CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"trading_partner_id" uuid,
	"type" "channel_type" NOT NULL,
	"direction" "direction" NOT NULL,
	"name" text NOT NULL,
	"host" text,
	"port" integer,
	"username" text,
	"remote_path" text,
	"authentication" "sftp_authentication",
	"encrypted_credential" text,
	"polling_interval_minutes" integer,
	"rate_limit_per_minute" integer,
	"encrypted_webhook_token" text,
	"webhook_token_last_four" text,
	"url" text,
	"encrypted_authorization" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channels_kind" CHECK (("channels"."type", "channels"."direction") in (('sftp', 'inbound'), ('sftp', 'outbound'), ('webhook', 'inbound'), ('http', 'outbound'))),
	CONSTRAINT "channels_sftp_settings" CHECK (num_nonnulls("channels"."host", "channels"."port", "channels"."username", "channels"."remote_path", "channels"."authentication", "channels"."encrypted_credential") = case when "channels"."type" = 'sftp' then 6 else 0 end),
	CONSTRAINT "channels_polling_interval" CHECK (num_nonnulls("channels"."polling_interval_minutes") = case when "channels"."type" = 'sftp' and "channels"."direction" = 'inbound' then 1 else 0 end),
	CONSTRAINT "channels_webhook_settings" CHECK (num_nonnulls("channels"."rate_limit_per_minute", "channels"."encrypted_webhook_token", "channels"."webhook_token_last_four") = case when "channels"."type" = 'webhook' then 3 else 0 end),
	CONSTRAINT "channels_http_settings" CHECK (num_nonnulls("channels"."url") = case when "channels"."type" = 'http' then 1 else 0 end),
	CONSTRAINT "channels_authorization" CHECK ("channels"."type" = 'http' or "channels"."encrypted_authorization" is null)
);
--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_trading_partner_id_trading_partners_id_fk" FOREIGN KEY ("trading_partner_id") REFERENCES "public"."trading_partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channels_workspace_id_index" ON "channels" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "channels_trading_partner_id_index" ON "channels" USING btree ("trading_partner_id");