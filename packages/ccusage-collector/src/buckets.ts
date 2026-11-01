import type { Calendar } from "./calendar.js";
import type { UsageBucket } from "./types.js";

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

// One request's usage, or the summed usage of `requests` requests. Input
// excludes cache reads and writes; reasoning is part of output, null when the
// source does not report it.
export interface RequestTotals extends Counted {
  reasoningTokens: number | null;
  // Requests the totals stand for; one when absent
  requests?: number;
}

interface Accumulated extends UsageBucket {
  reasoningTokens: number;
  requests: number;
  reportsReasoning: boolean;
}

// Sums requests into buckets of the account calendar: the hour of the
// request's instant, per model
export class RequestBuckets {
  private readonly buckets = new Map<string, Accumulated>();

  constructor(private readonly calendar: Calendar) {}

  add(when: Date, model: string, request: RequestTotals): void {
    const date = this.calendar.dayOf(when);
    const hourStart = this.calendar.hourOf(when).toISOString();
    const key = `${date}\0${hourStart}\0${model}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        date,
        hourStart,
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
    bucket.requests += request.requests ?? 1;
  }

  // By hour, then by model
  list(): UsageBucket[] {
    return [...this.buckets.values()]
      .sort(
        (a, b) =>
          a.hourStart.localeCompare(b.hourStart) ||
          a.model.localeCompare(b.model),
      )
      .map(({ reportsReasoning, reasoningTokens, ...bucket }) => ({
        ...bucket,
        ...(reportsReasoning ? { reasoningTokens } : {}),
      }));
  }
}
