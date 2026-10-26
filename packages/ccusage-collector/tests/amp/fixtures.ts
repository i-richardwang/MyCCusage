import type { AmpDayReport } from "../../src/amp/report";
import type { AmpCachedThread, AmpUsageEntry } from "../../src/amp/threads";

// Local noon on 2026-10-21, so the local date is stable in any timezone
export const DAY = "2026-10-21";
export const NOON = new Date(2026, 9, 21, 12).toISOString();
export const UNPRICED = { asOf: NOON, models: {} };

export function exportJson(
  id: string,
  usage: Array<Record<string, unknown>>,
  createdAt: string = NOON,
): string {
  return JSON.stringify({
    id,
    created: new Date(2026, 9, 20, 12).getTime(),
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
