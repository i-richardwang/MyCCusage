import { pgTable, serial, date, integer, numeric, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'

export const usageRecords = pgTable('usage_records', {
  id: serial('id').primaryKey(),
  date: date('date').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0),
  totalCost: numeric('total_cost', { precision: 10, scale: 4 }).notNull().default('0'),
  modelsUsed: jsonb('models_used').notNull().default('[]'),
  rawData: jsonb('raw_data').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => {
  return {
    dateIdx: index('usage_records_date_idx').on(table.date),
    createdAtIdx: index('usage_records_created_at_idx').on(table.createdAt),
    uniqueDateIdx: uniqueIndex('usage_records_unique_date_idx').on(table.date),
  }
})

export type UsageRecord = typeof usageRecords.$inferSelect
export type NewUsageRecord = typeof usageRecords.$inferInsert