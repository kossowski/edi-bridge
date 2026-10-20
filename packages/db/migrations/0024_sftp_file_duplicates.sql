ALTER TABLE "documents" ADD COLUMN "content_hash" text;--> statement-breakpoint
CREATE INDEX "documents_sftp_file_index" ON "documents" USING btree ("channel_id","file_name","content_hash");