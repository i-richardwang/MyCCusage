import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  claudeRetentionDays,
  claudeSources,
  parseClaudeLine,
} from "../../src/transcripts/claude";

const assistant = (
  usage: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) =>
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-10-29T08:15:00.000Z",
    sessionId: "session-1",
    requestId: "req_1",
    message: { id: "msg_1", model: "claude-opus-5-5", usage },
    ...overrides,
  });

describe("parseClaudeLine", () => {
  it("reads every counter of a request, including cache lifetime and thinking", () => {
    const [request, ...rest] = parseClaudeLine(
      assistant({
        input_tokens: 2,
        cache_creation_input_tokens: 3752,
        cache_read_input_tokens: 1104,
        output_tokens: 844,
        output_tokens_details: { thinking_tokens: 750 },
        cache_creation: {
          ephemeral_1h_input_tokens: 3000,
          ephemeral_5m_input_tokens: 752,
        },
        inference_geo: "us",
        speed: "fast",
      }),
    );
    expect(rest).toEqual([]);
    expect(request).toEqual({
      timestampMs: Date.parse("2026-10-29T08:15:00.000Z"),
      model: "claude-opus-5-5",
      sessionId: "session-1",
      inputTokens: 2,
      outputTokens: 844,
      cacheCreationTokens: 3752,
      cacheCreation1hTokens: 3000,
      cacheReadTokens: 1104,
      reasoningTokens: 750,
      reportedCost: null,
      speed: "fast",
      inferenceGeo: "us",
      dedupeKey: "msg_1:req_1",
    });
  });

  it("leaves reasoning unknown when the version does not report it", () => {
    const [request] = parseClaudeLine(
      assistant({ input_tokens: 1, output_tokens: 2 }),
    );
    expect(request?.reasoningTokens).toBeNull();
    expect(request?.speed).toBe("standard");
  });

  it("splits advisor calls into requests of their own model", () => {
    const requests = parseClaudeLine(
      assistant({
        input_tokens: 10,
        output_tokens: 5,
        iterations: [
          { type: "message", input_tokens: 10, output_tokens: 5 },
          {
            type: "advisor_message",
            model: "claude-fable-5-1",
            input_tokens: 300,
            output_tokens: 40,
            cache_read_input_tokens: 7,
          },
        ],
      }),
    );
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      model: "claude-fable-5-1",
      inputTokens: 300,
      outputTokens: 40,
      cacheReadTokens: 7,
      dedupeKey: "msg_1:req_1:advisor:1",
    });
  });

  it("prefers a recorded cost and skips lines that are not billed requests", () => {
    expect(
      parseClaudeLine(assistant({ input_tokens: 1 }, { costUSD: 0.25 }))[0]
        ?.reportedCost,
    ).toBe(0.25);
    expect(
      parseClaudeLine(
        assistant(
          { input_tokens: 1 },
          { message: { model: "<synthetic>", usage: {} } },
        ),
      ),
    ).toEqual([]);
    expect(
      parseClaudeLine(assistant({ input_tokens: 1 }, { type: "user" })),
    ).toEqual([]);
    expect(parseClaudeLine('{"usage": broken')).toEqual([]);
    expect(parseClaudeLine('{"type":"summary"}')).toEqual([]);
  });
});

describe("Claude config directories", () => {
  let home: string;
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  function configDir(name: string, settings?: unknown): string {
    const dir = join(home, name);
    mkdirSync(join(dir, "projects"), { recursive: true });
    if (settings !== undefined) {
      writeFileSync(join(dir, "settings.json"), JSON.stringify(settings));
    }
    return dir;
  }

  it("accepts config or projects directories, once each", () => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "claude-sources-")));
    const a = configDir("a");
    const b = configDir("b");
    expect(claudeSources([a, join(a, "projects"), b])).toEqual([
      { configDir: a, projectsDir: join(a, "projects") },
      { configDir: b, projectsDir: join(b, "projects") },
    ]);
  });

  it("rejects a missing explicit source even when another source exists", () => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "claude-sources-")));
    const a = configDir("a");
    const missing = join(home, "missing");
    expect(() => claudeSources([a, missing])).toThrow(missing);
    expect(() =>
      claudeSources(undefined, { CLAUDE_CONFIG_DIR: `${a},${missing}` }),
    ).toThrow(missing);
  });

  it("falls back to a comma-separated CLAUDE_CONFIG_DIR", () => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "claude-sources-")));
    const a = configDir("a");
    const b = configDir("b");
    expect(
      claudeSources(undefined, { CLAUDE_CONFIG_DIR: `${a}, ${b}` }).map(
        ({ configDir }) => configDir,
      ),
    ).toEqual([a, b]);
    // The configured list wins over the environment
    expect(
      claudeSources([b], { CLAUDE_CONFIG_DIR: a }).map(
        ({ configDir }) => configDir,
      ),
    ).toEqual([b]);
  });

  it("reads the retention period from settings.json", () => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "claude-sources-")));
    expect(claudeRetentionDays(configDir("default"))).toBe(30);
    expect(
      claudeRetentionDays(configDir("long", { cleanupPeriodDays: 99 })),
    ).toBe(99);
    expect(
      claudeRetentionDays(configDir("zero", { cleanupPeriodDays: 0 })),
    ).toBe(1);
  });
});
