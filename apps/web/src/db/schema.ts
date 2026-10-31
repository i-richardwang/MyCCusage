import {
  pgTable,
  serial,
  bigint,
  date,
  integer,
  numeric,
  timestamp,
  varchar,
  index,
  unique,
} from "drizzle-orm/pg-core";

// Devices table for tracking different devices
export const devices = pgTable(
  "devices",
  {
    id: serial("id").primaryKey(),
    deviceId: varchar("device_id", { length: 255 }).notNull().unique(),
    deviceName: varchar("device_name", { length: 255 }).notNull(),
    displayName: varchar("display_name", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      deviceIdIdx: index("devices_device_id_idx").on(table.deviceId),
      createdAtIdx: index("devices_created_at_idx").on(table.createdAt),
    };
  },
);

// Usage of one agent with one model on one device: in an hour of the account
// calendar when hour_start is set, otherwise in a whole day, for sources and
// days whose hours are unknown. Writes operate on whole device/agent days.
// Model "" holds usage its source did not attribute to a model.
export const usageBuckets = pgTable(
  "usage_buckets",
  {
    id: serial("id").primaryKey(),
    deviceId: varchar("device_id", { length: 255 }).notNull(),
    agentType: varchar("agent_type", { length: 50 }).notNull(),
    // Day of the account calendar the bucket lies in
    date: date("date").notNull(),
    hourStart: timestamp("hour_start", { withTimezone: true }),
    model: varchar("model", { length: 255 }).notNull().default(""),
    // Excludes cache reads and writes
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    // Includes reasoning
    outputTokens: bigint("output_tokens", { mode: "number" })
      .notNull()
      .default(0),
    cacheCreationTokens: bigint("cache_creation_tokens", { mode: "number" })
      .notNull()
      .default(0),
    cacheReadTokens: bigint("cache_read_tokens", { mode: "number" })
      .notNull()
      .default(0),
    // Part of output; null where the source does not report it
    reasoningTokens: bigint("reasoning_tokens", { mode: "number" }),
    totalTokens: bigint("total_tokens", { mode: "number" }).notNull().default(0),
    cost: numeric("cost", { precision: 14, scale: 6 }).notNull().default("0"),
    // API requests; null where the source does not count them
    requests: integer("requests"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("usage_buckets_unique_bucket")
      .on(
        table.deviceId,
        table.agentType,
        table.date,
        table.hourStart,
        table.model,
      )
      .nullsNotDistinct(),
    index("usage_buckets_date_idx").on(table.date),
    index("usage_buckets_hour_start_idx").on(table.hourStart),
  ],
);

export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;
