ALTER TABLE "acknowledgements" DROP CONSTRAINT "acknowledgements_document_id_documents_id_fk";
--> statement-breakpoint
ALTER TABLE "runs" DROP CONSTRAINT "runs_document_id_documents_id_fk";
--> statement-breakpoint
ALTER TABLE "acknowledgements" ALTER COLUMN "document_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "document_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "document_deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "acknowledgements" ADD CONSTRAINT "acknowledgements_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_document_deleted" CHECK (("runs"."document_id" is null) = ("runs"."document_deleted_at" is not null));