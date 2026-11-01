-- Usage recorded before collectors reported hours is kept as whole days: no
-- hour, model "" for what it left unattributed, and possibly no request count.
ALTER TABLE "usage_buckets" DROP CONSTRAINT "usage_buckets_unique_bucket";--> statement-breakpoint
ALTER TABLE "usage_buckets" ALTER COLUMN "hour_start" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_buckets" ALTER COLUMN "requests" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_buckets" ADD CONSTRAINT "usage_buckets_unique_bucket" UNIQUE NULLS NOT DISTINCT("device_id","agent_type","date","hour_start","model");