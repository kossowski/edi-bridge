ALTER TABLE "runs" ADD COLUMN "document_number" text;--> statement-breakpoint
-- Before RFF+ON, the Business Reference of an inbound Run was its BGM number. Only an inbound Run waits for the Trading Partner.
UPDATE "runs" SET "document_number" = "runs"."business_reference"
FROM "flows"
WHERE "flows"."id" = "runs"."flow_id" AND "flows"."message_type" IN ('ORDERS', 'CONTRL');
