import {
  pgTable,
  serial,
  date,
  integer,
  numeric,
  jsonb,
  timestamp,
  varchar,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Define agent types as a const for type safety
export const AGENT_TYPES = ["claude-code", "amp", "codex", "opencode"] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

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

export const usageRecords = pgTable(
  "usage_records",
  {
    id: serial("id").primaryKey(),
    deviceId: varchar("device_id", { length: 255 }).notNull(),
    agentType: varchar("agent_type", { length: 50 })
      .notNull()
      .default("claude-code"),
    date: date("date").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheCreationTokens: integer("cache_creation_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    totalCost: numeric("total_cost", { precision: 10, scale: 4 })
      .notNull()
      .default("0"),
    credits: numeric("credits", { precision: 10, scale: 4 }).default("0"),
    modelsUsed: jsonb("models_used").notNull().default("[]"),
    rawData: jsonb("raw_data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      deviceIdIdx: index("usage_records_device_id_idx").on(table.deviceId),
      dateIdx: index("usage_records_date_idx").on(table.date),
      agentTypeIdx: index("usage_records_agent_type_idx").on(table.agentType),
      createdAtIdx: index("usage_records_created_at_idx").on(table.createdAt),
      uniqueDeviceDateAgentIdx: uniqueIndex(
        "usage_records_unique_device_date_agent_idx",
      ).on(table.deviceId, table.date, table.agentType),
    };
  },
);

export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;
export type UsageRecord = typeof usageRecords.$inferSelect;
export type NewUsageRecord = typeof usageRecords.$inferInsert;
