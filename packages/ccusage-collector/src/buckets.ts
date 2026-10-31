import type { Calendar } from "./calendar.js";
import type { DailyUsageRecord, UsageBucket } from "./types.js";

type Counted = Pick<
  UsageBucket,
  | "inputTokens"
  | "outputTokens"
  | "cacheCreationTokens"
  | "cacheReadTokens"
  | "cost"
>;

const FIELDS: (keyof Counted)[] = [
  "inputTokens",
  "outputTokens",
  "cacheCreationTokens",
  "cacheReadTokens",
  "cost",
];

// Floating-point sums of costs drift by far less than this
const COST_EPSILON = 1e-6;

const isPositive = (field: keyof Counted, value: number) =>
  value > (field === "cost" ? COST_EPSILON : 0);
const isNegative = (field: keyof Counted, value: number) =>
  value < (field === "cost" ? -COST_EPSILON : 0);

const finite = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

function counted(source: Counted | DailyUsageRecord): Counted {
  return {
    inputTokens: finite(source.inputTokens),
    outputTokens: finite(source.outputTokens),
    cacheCreationTokens: finite(source.cacheCreationTokens),
    cacheReadTokens: finite(source.cacheReadTokens),
    cost: finite("cost" in source ? source.cost : source.totalCost),
  };
}

/**
 * Day buckets per model from a day-level source. A day's model breakdowns
 * keep its totals exact: usage they do not attribute stays in a bucket with
 * model "", and a day whose breakdowns exceed its totals is kept whole under
 * "".
 */
export function dailyBuckets(daily: DailyUsageRecord[]): UsageBucket[] {
  const buckets: UsageBucket[] = [];
  for (const record of daily) {
    const total = counted(record);
    const byModel = new Map<string, Counted>();
    for (const breakdown of record.modelBreakdowns ?? []) {
      if (typeof breakdown?.modelName !== "string" || !breakdown.modelName) {
        continue;
      }
      const usage = counted(breakdown);
      const sum = byModel.get(breakdown.modelName);
      byModel.set(
        breakdown.modelName,
        sum
          ? (Object.fromEntries(
              FIELDS.map((field) => [field, sum[field] + usage[field]]),
            ) as unknown as Counted)
          : usage,
      );
    }
    const remainder = { ...total };
    for (const usage of byModel.values()) {
      for (const field of FIELDS) remainder[field] -= usage[field];
    }
    if (FIELDS.some((field) => isNegative(field, remainder[field]))) {
      buckets.push({ date: record.date, model: "", ...total });
      continue;
    }
    for (const [model, usage] of byModel) {
      if (FIELDS.some((field) => isPositive(field, usage[field]))) {
        buckets.push({ date: record.date, model, ...usage });
      }
    }
    if (FIELDS.some((field) => isPositive(field, remainder[field]))) {
      if (!isPositive("cost", remainder.cost)) remainder.cost = 0;
      buckets.push({ date: record.date, model: "", ...remainder });
    }
  }
  return buckets;
}

// One request's usage. Input excludes cache reads and writes; reasoning is
// part of output, null when the source does not report it.
export interface RequestTotals extends Counted {
  reasoningTokens: number | null;
}

interface Accumulated extends UsageBucket {
  reasoningTokens: number;
  requests: number;
  reportsReasoning: boolean;
}

/**
 * Sums requests into buckets of the account calendar per model: the hour of
 * the request's instant, or its whole day when the source knows only the day.
 */
export class RequestBuckets {
  private readonly buckets = new Map<string, Accumulated>();

  constructor(private readonly calendar: Calendar) {}

  add(when: Date | string, model: string, request: RequestTotals): void {
    const date = typeof when === "string" ? when : this.calendar.dayOf(when);
    const hourStart =
      typeof when === "string"
        ? undefined
        : this.calendar.hourOf(when).toISOString();
    const key = `${date}\0${hourStart ?? ""}\0${model}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        date,
        ...(hourStart ? { hourStart } : {}),
        model,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        reasoningTokens: 0,
        cost: 0,
        requests: 0,
        reportsReasoning: false,
      };
      this.buckets.set(key, bucket);
    }
    for (const field of FIELDS) bucket[field] += request[field];
    if (request.reasoningTokens !== null) {
      bucket.reasoningTokens += request.reasoningTokens;
      bucket.reportsReasoning = true;
    }
    bucket.requests += 1;
  }

  // Day buckets before the hours of their day, then by model
  list(): UsageBucket[] {
    return [...this.buckets.values()]
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          (a.hourStart ?? "").localeCompare(b.hourStart ?? "") ||
          a.model.localeCompare(b.model),
      )
      .map(({ reportsReasoning, reasoningTokens, ...bucket }) => ({
        ...bucket,
        ...(reportsReasoning ? { reasoningTokens } : {}),
      }));
  }
}
