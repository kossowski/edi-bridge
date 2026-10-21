ALTER TYPE "public"."poll_problem_reason" ADD VALUE 'passphraseRejected';--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "encrypted_passphrase" text;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_passphrase" CHECK ("channels"."authentication" is not distinct from 'privateKey' or "channels"."encrypted_passphrase" is null);