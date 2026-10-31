CREATE TABLE "usage_buckets" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_id" varchar(255) NOT NULL,
	"agent_type" varchar(50) NOT NULL,
	"date" date NOT NULL,
	"hour_start" timestamp with time zone,
	"model" varchar(255) DEFAULT '' NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_creation_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_read_tokens" bigint DEFAULT 0 NOT NULL,
	"reasoning_tokens" bigint,
	"total_tokens" bigint DEFAULT 0 NOT NULL,
	"cost" numeric(14, 6) DEFAULT '0' NOT NULL,
	"requests" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_buckets_unique_bucket" UNIQUE NULLS NOT DISTINCT("device_id","agent_type","date","hour_start","model")
);
--> statement-breakpoint
CREATE INDEX "usage_buckets_date_idx" ON "usage_buckets" USING btree ("date");--> statement-breakpoint
CREATE INDEX "usage_buckets_hour_start_idx" ON "usage_buckets" USING btree ("hour_start");--> statement-breakpoint
-- Carry every synced day over as day buckets. A day splits into one bucket per
-- model of its raw_data.modelBreakdowns, plus a "" bucket for usage the
-- breakdowns leave unattributed; a day whose breakdowns exceed its totals stays
-- whole under "". Day totals stay as stored, except that input excludes cache
-- reads and writes: a day whose total is input plus output counted them inside
-- its input, and they are taken out of it.
WITH records AS (
	SELECT
		id, device_id, agent_type, date, output_tokens, cache_creation_tokens,
		cache_read_tokens, total_tokens, total_cost, raw_data, created_at, updated_at,
		CASE
			WHEN total_tokens = input_tokens + output_tokens
				AND cache_creation_tokens + cache_read_tokens > 0
				AND input_tokens >= cache_creation_tokens + cache_read_tokens
			THEN input_tokens - cache_creation_tokens - cache_read_tokens
			ELSE input_tokens
		END AS input_tokens
	FROM "usage_records"
),
breakdown AS (
	SELECT
		r.id,
		e->>'modelName' AS model,
		CASE WHEN jsonb_typeof(e->'inputTokens') = 'number' THEN (e->>'inputTokens')::numeric ELSE 0 END AS input_tokens,
		CASE WHEN jsonb_typeof(e->'outputTokens') = 'number' THEN (e->>'outputTokens')::numeric ELSE 0 END AS output_tokens,
		CASE WHEN jsonb_typeof(e->'cacheCreationTokens') = 'number' THEN (e->>'cacheCreationTokens')::numeric ELSE 0 END AS cache_creation_tokens,
		CASE WHEN jsonb_typeof(e->'cacheReadTokens') = 'number' THEN (e->>'cacheReadTokens')::numeric ELSE 0 END AS cache_read_tokens,
		CASE WHEN jsonb_typeof(e->'cost') = 'number' THEN (e->>'cost')::numeric ELSE 0 END AS cost
	FROM records r
	CROSS JOIN LATERAL jsonb_array_elements(
		CASE WHEN jsonb_typeof(r.raw_data->'modelBreakdowns') = 'array' THEN r.raw_data->'modelBreakdowns' ELSE '[]'::jsonb END
	) e
	WHERE jsonb_typeof(e->'modelName') = 'string' AND e->>'modelName' <> ''
),
per_model AS (
	SELECT
		id,
		left(model, 255) AS model,
		round(sum(input_tokens)) AS input_tokens,
		round(sum(output_tokens)) AS output_tokens,
		round(sum(cache_creation_tokens)) AS cache_creation_tokens,
		round(sum(cache_read_tokens)) AS cache_read_tokens,
		sum(cost) AS cost
	FROM breakdown
	GROUP BY id, left(model, 255)
),
attributed AS (
	SELECT
		id,
		sum(input_tokens) AS input_tokens,
		sum(output_tokens) AS output_tokens,
		sum(cache_creation_tokens) AS cache_creation_tokens,
		sum(cache_read_tokens) AS cache_read_tokens,
		sum(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens) AS total_tokens,
		sum(cost) AS cost
	FROM per_model
	GROUP BY id
),
-- Stored costs have four decimals; smaller differences are rounding
split AS (
	SELECT r.*, a.input_tokens AS a_input, a.output_tokens AS a_output,
		a.cache_creation_tokens AS a_cache_creation, a.cache_read_tokens AS a_cache_read,
		a.total_tokens AS a_total, a.cost AS a_cost
	FROM records r
	JOIN attributed a ON a.id = r.id
	WHERE r.input_tokens >= a.input_tokens
		AND r.output_tokens >= a.output_tokens
		AND r.cache_creation_tokens >= a.cache_creation_tokens
		AND r.cache_read_tokens >= a.cache_read_tokens
		AND r.total_tokens >= a.total_tokens
		AND r.total_cost >= a.cost - 0.0001
)
INSERT INTO "usage_buckets" (
	"device_id", "agent_type", "date", "hour_start", "model",
	"input_tokens", "output_tokens", "cache_creation_tokens", "cache_read_tokens",
	"total_tokens", "cost", "created_at", "updated_at"
)
SELECT s.device_id, s.agent_type, s.date, NULL::timestamptz, m.model,
	m.input_tokens, m.output_tokens, m.cache_creation_tokens, m.cache_read_tokens,
	m.input_tokens + m.output_tokens + m.cache_creation_tokens + m.cache_read_tokens,
	m.cost, s.created_at, s.updated_at
FROM split s
JOIN per_model m ON m.id = s.id
WHERE m.input_tokens + m.output_tokens + m.cache_creation_tokens + m.cache_read_tokens > 0 OR m.cost > 0
UNION ALL
SELECT s.device_id, s.agent_type, s.date, NULL::timestamptz, '',
	s.input_tokens - s.a_input, s.output_tokens - s.a_output,
	s.cache_creation_tokens - s.a_cache_creation, s.cache_read_tokens - s.a_cache_read,
	s.total_tokens - s.a_total,
	CASE WHEN s.total_cost - s.a_cost > 0.0001 THEN s.total_cost - s.a_cost ELSE 0 END,
	s.created_at, s.updated_at
FROM split s
WHERE s.total_tokens > s.a_total OR s.total_cost - s.a_cost > 0.0001
UNION ALL
SELECT r.device_id, r.agent_type, r.date, NULL::timestamptz, '',
	r.input_tokens, r.output_tokens, r.cache_creation_tokens, r.cache_read_tokens,
	r.total_tokens, r.total_cost, r.created_at, r.updated_at
FROM records r
WHERE r.id NOT IN (SELECT id FROM split);
--> statement-breakpoint
DROP TABLE "usage_records" CASCADE;
