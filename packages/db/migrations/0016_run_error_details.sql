UPDATE "runs" SET "error" = "error" || '{"details": null}'::jsonb WHERE "error" IS NOT NULL AND NOT "error" ? 'details';--> statement-breakpoint
UPDATE "runs" SET "problem" = jsonb_set("problem", '{reason}', '"defect"') WHERE "error"->>'code' IN ('processingDefect', 'deliveryDefect');
