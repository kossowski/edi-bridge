ALTER TABLE "documents" ALTER COLUMN "content" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "bytes" "bytea";--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_content" CHECK (num_nonnulls("documents"."content", "documents"."bytes") = 1);