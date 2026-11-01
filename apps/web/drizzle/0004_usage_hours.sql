-- Every source reports hours, models and request counts. Day buckets, usage
-- without a model and buckets without a request count predate that and are
-- dropped; a full-history sync restores those days hour by hour.
DELETE FROM "usage_buckets" WHERE "hour_start" IS NULL OR "model" = '' OR "requests" IS NULL;--> statement-breakpoint
ALTER TABLE "usage_buckets" DROP CONSTRAINT "usage_buckets_unique_bucket";--> statement-breakpoint
ALTER TABLE "usage_buckets" ALTER COLUMN "hour_start" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_buckets" ALTER COLUMN "model" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "usage_buckets" ALTER COLUMN "requests" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_buckets" ADD CONSTRAINT "usage_buckets_unique_bucket" UNIQUE("device_id","agent_type","date","hour_start","model");