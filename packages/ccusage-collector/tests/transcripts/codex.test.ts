import { describe, expect, it } from "vitest";
import {
  initialCodexScanState,
  parseCodexLine,
} from "../../src/transcripts/codex";

// Cases ported from T3 Code's codexUsage tests (MIT, T3 Tools Inc.)
const sessionMeta = JSON.stringify({
  type: "session_meta",
  timestamp: "2026-08-01T05:17:41.289Z",
  payload: { type: "session_meta", id: "019fbbc1-b12c-7360-a685-28c181f0025f" },
});
const turnContext = JSON.stringify({
  type: "turn_context",
  timestamp: "2026-08-01T05:17:42.694Z",
  payload: { type: "turn_context", model: "gpt-5.6-sol" },
});
const tokenCount = (
  input: number,
  cached: number,
  output: number,
  reasoning: number,
) =>
  JSON.stringify({
    type: "event_msg",
    timestamp: "2026-08-01T05:17:49.919Z",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: input,
          cached_input_tokens: cached,
          cache_write_input_tokens: 0,
          output_tokens: output,
          reasoning_output_tokens: reasoning,
        },
      },
    },
  });
const counters = (input: number, output: number) => ({
  input_tokens: input,
  cached_input_tokens: 0,
  cache_write_input_tokens: 0,
  output_tokens: output,
  reasoning_output_tokens: 0,
  total_tokens: input + output,
});
const counted = (last: unknown, total?: unknown, extra = {}) =>
  JSON.stringify({
    type: "event_msg",
    timestamp: "2026-08-01T05:17:49.919Z",
    payload: {
      type: "token_count",
      info: { last_token_usage: last, total_token_usage: total, ...extra },
    },
  });

describe("parseCodexLine", () => {
  it("attributes usage to the model of the preceding turn context, excluding cached input", () => {
    const state = initialCodexScanState();
    parseCodexLine(sessionMeta, state);
    parseCodexLine(turnContext, state);
    const request = parseCodexLine(tokenCount(19239, 11008, 299, 116), state);

    expect(request).toMatchObject({
      model: "gpt-5.6-sol",
      sessionId: "019fbbc1-b12c-7360-a685-28c181f0025f",
      inputTokens: 19239 - 11008,
      cacheReadTokens: 11008,
      outputTokens: 299,
      reasoningTokens: 116,
      speed: "standard",
      timestampMs: Date.parse("2026-08-01T05:17:49.919Z"),
    });
  });

  it("skips a repeated token_count so deltas are not double counted", () => {
    const state = initialCodexScanState();
    parseCodexLine(turnContext, state);
    expect(parseCodexLine(tokenCount(100, 0, 10, 0), state)).not.toBeNull();
    expect(parseCodexLine(tokenCount(100, 0, 10, 0), state)).toBeNull();
  });

  it("does not consume counters before the model is known", () => {
    const state = initialCodexScanState();
    expect(parseCodexLine(tokenCount(100, 0, 10, 0), state)).toBeNull();
    parseCodexLine(turnContext, state);
    expect(parseCodexLine(tokenCount(100, 0, 10, 0), state)).not.toBeNull();
  });

  it("ignores stale requests and carries the service tier forward", () => {
    const state = initialCodexScanState();
    parseCodexLine(turnContext, state);
    const request = counters(100, 20);
    expect(parseCodexLine(counted(request, request), state)?.outputTokens).toBe(
      20,
    );
    expect(parseCodexLine(counted(counters(20, 5), request), state)).toBeNull();
    // A context-window estimate is not a request
    expect(
      parseCodexLine(
        counted({ ...counters(0, 0), total_tokens: 20330 }, request, {
          model_context_window: 258400,
        }),
        state,
      ),
    ).toBeNull();
    expect(
      parseCodexLine(counted(request, counters(200, 40)), state)?.outputTokens,
    ).toBe(20);

    for (const [index, tier] of ["priority", "ultrafast"].entries()) {
      parseCodexLine(
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "thread_settings_applied",
            thread_settings: { service_tier: tier },
          },
        }),
        state,
      );
      expect(
        parseCodexLine(
          counted(request, counters(100 * (index + 3), 20 * (index + 3))),
          state,
        ),
      ).toMatchObject({
        speed: tier === "priority" ? "fast" : "ultrafast",
        inputTokens: 100,
        outputTokens: 20,
      });
    }
    expect(state.malformedRecords).toBe(0);
  });

  it.each([false, true])(
    "does not rebill requests without cumulative counters or drop the next cumulative delta (initial cumulative=%s)",
    (initialCumulative) => {
      const state = initialCodexScanState();
      parseCodexLine(turnContext, state);
      const first = counters(100, 20);
      expect(
        parseCodexLine(
          counted(first, initialCumulative ? first : undefined),
          state,
        )?.outputTokens,
      ).toBe(20);
      expect(parseCodexLine(counted(first), state)).toBeNull();
      expect(
        parseCodexLine(counted(counters(20, 5)), state)?.outputTokens,
      ).toBe(5);
      expect(
        parseCodexLine(counted(counters(20, 5), counters(120, 25)), state),
      ).toBeNull();
      expect(
        parseCodexLine(counted(counters(10, 2), counters(130, 27)), state)
          ?.outputTokens,
      ).toBe(2);
      expect(state.malformedRecords).toBe(0);
    },
  );

  it("bills the first request after a resume restarts the cumulative counters", () => {
    const state = initialCodexScanState();
    parseCodexLine(turnContext, state);
    parseCodexLine(counted(counters(100, 20), counters(100, 20)), state);
    expect(
      parseCodexLine(counted(counters(30, 5), counters(30, 5)), state)
        ?.outputTokens,
    ).toBe(5);
    expect(
      parseCodexLine(counted(counters(10, 2), counters(40, 7)), state)
        ?.outputTokens,
    ).toBe(2);
    expect(state.malformedRecords).toBe(0);
  });

  it("ignores replayed sequence starts without rewinding the baseline", () => {
    const state = initialCodexScanState();
    parseCodexLine(turnContext, state);
    const first = counted(counters(100, 20), counters(100, 20));
    const records = [
      first,
      counted(counters(200, 40), counters(300, 60)),
      first,
      counted(counters(300, 60), counters(600, 120)),
    ].map((line) => parseCodexLine(line, state));
    expect(records.map((r) => r?.outputTokens ?? 0)).toEqual([20, 40, 0, 60]);
    expect(state.malformedRecords).toBe(0);
  });

  it("allows identical counters at a new timestamp to start a genuine sequence", () => {
    const state = initialCodexScanState();
    parseCodexLine(turnContext, state);
    const first = counted(counters(100, 20), counters(100, 20));
    parseCodexLine(first, state);
    parseCodexLine(counted(counters(200, 40), counters(300, 60)), state);
    expect(
      parseCodexLine(first.replace("05:17:49.919Z", "05:18:49.919Z"), state)
        ?.outputTokens,
    ).toBe(20);
    expect(
      parseCodexLine(counted(counters(10, 2), counters(110, 22)), state)
        ?.outputTokens,
    ).toBe(2);
    expect(state.malformedRecords).toBe(0);
  });

  it.each([counters(0, 0), null])(
    "forgets the sequence start after a zero cumulative baseline (last=%j)",
    (last) => {
      const state = initialCodexScanState();
      parseCodexLine(turnContext, state);
      const first = counted(counters(100, 20), counters(100, 20));
      parseCodexLine(first, state);
      parseCodexLine(counted(counters(200, 40), counters(300, 60)), state);
      expect(parseCodexLine(counted(last, counters(0, 0)), state)).toBeNull();
      expect(parseCodexLine(first, state)?.outputTokens).toBe(20);
      expect(
        parseCodexLine(counted(counters(10, 2), counters(110, 22)), state)
          ?.outputTokens,
      ).toBe(2);
    },
  );

  it("counts inconsistent counters as malformed instead of billing them", () => {
    const state = initialCodexScanState();
    parseCodexLine(turnContext, state);
    // Cached input cannot exceed input
    expect(parseCodexLine(tokenCount(10, 20, 5, 0), state)).toBeNull();
    expect(state.malformedRecords).toBe(1);
  });

  describe("forked rollouts", () => {
    const meta = (
      id: string,
      timestamp: string,
      fork: Record<string, unknown>,
    ) =>
      JSON.stringify({
        type: "session_meta",
        timestamp,
        payload: { type: "session_meta", id, ...fork },
      });
    const stamped = (timestamp: string, line: string) =>
      JSON.stringify({ ...JSON.parse(line), timestamp });

    it("drops the re-stamped copied burst and keeps the first real event", () => {
      const state = initialCodexScanState();
      const forkInstant = "2026-08-01T05:00:00.000Z";
      parseCodexLine(
        meta("child", forkInstant, { forked_from_id: "parent" }),
        state,
      );
      // The copied parent meta does not take over the session
      parseCodexLine(meta("parent", forkInstant, {}), state);
      parseCodexLine(stamped(forkInstant, turnContext), state);

      expect(
        parseCodexLine(
          stamped(
            "2026-08-01T05:00:00.001Z",
            counted(counters(100, 10), counters(100, 10)),
          ),
          state,
        ),
      ).toBeNull();
      expect(
        parseCodexLine(
          stamped(
            "2026-08-01T05:00:00.002Z",
            counted(counters(200, 20), counters(300, 30)),
          ),
          state,
        ),
      ).toBeNull();

      const real = parseCodexLine(
        stamped(
          "2026-08-01T05:00:06.000Z",
          counted(counters(200, 20), counters(500, 50)),
        ),
        state,
      );
      expect(real).toMatchObject({ sessionId: "child", outputTokens: 20 });
      expect(state.malformedRecords).toBe(0);
    });

    it("recognizes subagent spawns without forked_from_id", () => {
      const state = initialCodexScanState();
      const spawnInstant = "2026-08-01T05:00:00.000Z";
      parseCodexLine(
        meta("child", spawnInstant, {
          source: {
            subagent: { thread_spawn: { parent_thread_id: "parent" } },
          },
        }),
        state,
      );
      parseCodexLine(stamped(spawnInstant, turnContext), state);
      expect(
        parseCodexLine(
          stamped("2026-08-01T05:00:00.001Z", tokenCount(100, 0, 10, 0)),
          state,
        ),
      ).toBeNull();
    });

    it("does not suppress anything in a rollout that is not a fork", () => {
      const state = initialCodexScanState();
      parseCodexLine(meta("root", "2026-08-01T05:00:00.000Z", {}), state);
      parseCodexLine(stamped("2026-08-01T05:00:00.100Z", turnContext), state);
      expect(
        parseCodexLine(
          stamped("2026-08-01T05:00:00.200Z", tokenCount(100, 0, 10, 0)),
          state,
        ),
      ).not.toBeNull();
    });
  });
});
