import { createCalendar } from "../../src/calendar";
import { reportKey } from "../../src/amp/threads";
import type { AmpDayReport } from "../../src/amp/report";
import type { AmpCachedThread, AmpUsageEntry } from "../../src/amp/threads";
import type { DailyUsageRecord } from "../../src/types";

// Fixtures are wall-clock times in one fixed calendar, independent of the
// process time zone
export const CALENDAR = createCalendar("Asia/Shanghai");
export function at(day: string, hour = 0): string {
  const hh = String(hour).padStart(2, "0");
  return new Date(`${day}T${hh}:00:00+08:00`).toISOString();
}

export const DAY = "2026-10-21";
export const NOON = at(DAY, 12);
export const UNPRICED = { asOf: NOON, models: {} };
// Cache key of DAY's report
export const DAY_KEY = reportKey(CALENDAR.rangeOf(DAY));

export const tokenTotal = (day: DailyUsageRecord) =>
  day.inputTokens +
  day.outputTokens +
  day.cacheCreationTokens +
  day.cacheReadTokens;

export function exportJson(
  id: string,
  usage: Array<Record<string, unknown>>,
  createdAt: string = NOON,
): string {
  return JSON.stringify({
    id,
    created: Date.parse(at("2026-10-20", 12)),
    messages: [
      {
        role: "user",
        messageId: 0,
        createdAt,
        content: [{ type: "text", text: "hi" }],
      },
      ...usage.map((u, i) => ({
        role: "assistant",
        messageId: i + 1,
        createdAt,
        content: [{ type: "text", text: "large body" }],
        usage: u,
      })),
    ],
  });
}

export function usageEntry(
  model: string,
  tokens: Partial<Omit<AmpUsageEntry, "model">> = {},
): AmpUsageEntry {
  return {
    timestamp: NOON,
    model,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    ...tokens,
  };
}

export function cachedThread(
  partial: Partial<AmpCachedThread> & Pick<AmpCachedThread, "id">,
): AmpCachedThread {
  return {
    created: null,
    updated: NOON,
    activity: [],
    usage: [],
    reports: {},
    ...partial,
  };
}

// Shape of `amp threads usage <id> --details`, trimmed from a real report
export const MIXED_REPORT = `# Thread Usage

## 报告页面视觉质感

Scope: Entire lifetime of this thread.

Cost: $6.58
Total tokens: 36,605,299
Input tokens: 36,428,492 (35,409,330 cache reads)
Output tokens: 176,807
Requests: 79

## Models

| Model | Requests | Input | Output | Amp cost | Est. list price |
| --- | ---: | ---: | ---: | ---: | ---: |
| Opus 5.5 | 62 | 13,223,301 | 68,583 | $6.58 |  |
| GPT-5.6 Terra | 12 | 481,661 | 2,791 | $0 | $0.30 |
| Haiku 5.5 | 2 | 3,334 | 570 | $0 |  |
| Opus 5.5 | 3 | 22,720,196 | 104,863 | $0 |  |

## Model Routing

| Model ID | Purpose | Routing | Requests | Cost |
| --- | --- | --- | ---: | ---: |
| openai/gpt-5.6-terra | Read Thread | Via [ChatGPT](https://ampcode.com/settings/model-routing#x) | 12 | $0 |
| external-agent:claude-code/claude-haiku-5-5 | Unspecified (legacy) | Via Amp | 2 | $0 |
| external-agent:claude-code/claude-opus-5-5 | Unspecified (legacy) | Via Amp | 3 | $0 |
| anthropic/claude-opus-5-5 | Agent | Via Amp | 62 | $6.58 |

## Tools

| Tool | Requests | Cost |
| --- | ---: | ---: |
| Web Search | 1 | $0.004 |
`;

export const SINGLE_MODEL_REPORT = `# Thread Usage

Total tokens: 165
Input tokens: 150 (120 cache reads)
Output tokens: 15
Requests: 2

## Models

| Model | Requests | Input | Output | Amp cost |
| --- | ---: | ---: | ---: | ---: |
| GPT-6.1 Sol | 2 | 150 | 15 | $0 |

## Model Routing

| Model ID | Purpose | Routing | Requests | Cost |
| --- | --- | --- | ---: | ---: |
| openai/gpt-6.1-sol | Agent | Via Amp | 1 | $0 |
| openai/gpt-6.1-sol | Task | Via Amp | 1 | $0 |
`;

export const DEEPSEEK_REPORT: AmpDayReport = {
  inputTokens: 150,
  cacheReadTokens: 120,
  outputTokens: 15,
  models: [
    {
      name: "DeepSeek V4.1 Flash",
      requests: 2,
      inputTokens: 150,
      outputTokens: 15,
    },
  ],
  routing: [
    {
      modelId: "deepseek/deepseek-v4.1-flash",
      purpose: "Agent",
      requests: 1,
    },
    {
      modelId: "deepseek/deepseek-v4.1-flash",
      purpose: "Read Thread",
      requests: 1,
    },
  ],
};
