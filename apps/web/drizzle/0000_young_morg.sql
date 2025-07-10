CREATE TABLE "devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_id" varchar(255) NOT NULL,
	"device_name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_device_id_unique" UNIQUE("device_id")
);
--> statement-breakpoint
CREATE TABLE "usage_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_id" varchar(255) NOT NULL,
	"date" date NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_creation_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"total_cost" numeric(10, 4) DEFAULT '0' NOT NULL,
	"models_used" jsonb DEFAULT '[]' NOT NULL,
	"raw_data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "devices_device_id_idx" ON "devices" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "devices_created_at_idx" ON "devices" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "usage_records_device_id_idx" ON "usage_records" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "usage_records_date_idx" ON "usage_records" USING btree ("date");--> statement-breakpoint
CREATE INDEX "usage_records_created_at_idx" ON "usage_records" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_records_unique_device_date_idx" ON "usage_records" USING btree ("device_id","date");