DROP INDEX "usage_records_unique_device_date_idx";--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN "agent_type" varchar(50) DEFAULT 'claude-code' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN "credits" numeric(10, 4) DEFAULT '0';--> statement-breakpoint
CREATE INDEX "usage_records_agent_type_idx" ON "usage_records" USING btree ("agent_type");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_records_unique_device_date_agent_idx" ON "usage_records" USING btree ("device_id","date","agent_type");