-- Buckets carry their cost split by token type, cache savings, speed premium
-- and unpriced tokens. Stored buckets keep null: they were synced without them.
ALTER TABLE "usage_buckets" ADD COLUMN "input_cost" numeric(14, 6);--> statement-breakpoint
ALTER TABLE "usage_buckets" ADD COLUMN "output_cost" numeric(14, 6);--> statement-breakpoint
ALTER TABLE "usage_buckets" ADD COLUMN "cache_creation_cost" numeric(14, 6);--> statement-breakpoint
ALTER TABLE "usage_buckets" ADD COLUMN "cache_read_cost" numeric(14, 6);--> statement-breakpoint
ALTER TABLE "usage_buckets" ADD COLUMN "cache_savings" numeric(14, 6);--> statement-breakpoint
ALTER TABLE "usage_buckets" ADD COLUMN "speed_premium" numeric(14, 6);--> statement-breakpoint
ALTER TABLE "usage_buckets" ADD COLUMN "unpriced_tokens" bigint;