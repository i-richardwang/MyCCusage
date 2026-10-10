import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectDimagentUsage, getDimAgentDbPath } from "../src/dimagent";

function openDb(dbPath: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require("node:sqlite");
  return new DatabaseSync(dbPath);
}

function seedDb(dbPath: string, sql: string) {
  const db = openDb(dbPath);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

const SCHEMA = `
  CREATE TABLE usage_ledger (
    ledgerId TEXT PRIMARY KEY,
    sessionId TEXT NOT NULL,
    runId TEXT,
    providerId TEXT NOT NULL,
    modelId TEXT NOT NULL,
    usage TEXT NOT NULL,
    cost REAL,
    createdAt TEXT NOT NULL
  );
  CREATE TABLE usage_run_stats (
    runId TEXT PRIMARY KEY,
    sessionId TEXT NOT NULL,
    providerId TEXT NOT NULL,
    modelId TEXT NOT NULL,
    status TEXT NOT NULL,
    startedAt TEXT,
    endedAt TEXT NOT NULL,
    durationMs INTEGER,
    inputTokens INTEGER NOT NULL,
    outputTokens INTEGER NOT NULL,
    totalTokens INTEGER NOT NULL,
    cacheReadTokens INTEGER,
    cacheWriteTokens INTEGER,
    cost TEXT NOT NULL,
    pricing TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
`;

describe("collectDimagentUsage", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "myccusage-dimagent-test-"));
    dbPath = join(dir, "dimcode.sqlite");
    seedDb(dbPath, SCHEMA);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty result when the database does not exist", () => {
    const result = collectDimagentUsage(join(dir, "missing.sqlite"));
    expect(result.daily).toEqual([]);
    expect(result.totals.totalTokens).toBe(0);
  });

  it("aggregates daily records with exact run cost and ccusage field names", () => {
    seedDb(
      dbPath,
      `
      INSERT INTO usage_ledger VALUES
        ('usage_run-1', 'sess-1', 'run-1', 'dim', 'mimo-v2.6-pro',
         '{"promptTokens":1000,"completionTokens":100,"totalTokens":1100,"cacheReadTokens":400}',
         NULL, '2026-07-01T10:00:00.000Z'),
        ('usage_run-2', 'sess-1', 'run-2', 'dim', 'deepseek-v4',
         '{"promptTokens":500,"completionTokens":50,"totalTokens":550}',
         NULL, '2026-07-01T11:00:00.000Z'),
        ('usage_run-3', 'sess-2', 'run-3', 'dim', 'mimo-v2.6-pro',
         '{"promptTokens":200,"completionTokens":20,"totalTokens":220,"cacheReadTokens":50,"cacheWriteTokens":30}',
         NULL, '2026-07-02T10:00:00.000Z');
      INSERT INTO usage_run_stats VALUES
        ('run-1', 'sess-1', 'dim', 'mimo-v2.6-pro', 'completed', NULL,
         '2026-07-01T10:00:00.000Z', 1000, 1000, 100, 1100, 400, NULL,
         '{"totalCostUsd":0.5,"quality":"exact"}', '{}',
         '2026-07-01T10:00:00.000Z', '2026-07-01T10:00:00.000Z'),
        ('run-2', 'sess-1', 'dim', 'deepseek-v4', 'completed', NULL,
         '2026-07-01T11:00:00.000Z', 1000, 500, 50, 550, NULL, NULL,
         '{"totalCostUsd":0.05,"quality":"exact"}', '{}',
         '2026-07-01T11:00:00.000Z', '2026-07-01T11:00:00.000Z'),
        ('run-3', 'sess-2', 'dim', 'mimo-v2.6-pro', 'completed', NULL,
         '2026-07-02T10:00:00.000Z', 1000, 200, 20, 220, 50, 30,
         '{"totalCostUsd":0.1,"quality":"exact"}', '{}',
         '2026-07-02T10:00:00.000Z', '2026-07-02T10:00:00.000Z');
      `,
    );

    const result = collectDimagentUsage(dbPath);

    expect(result.daily).toHaveLength(2);
    const day1 = result.daily[0];
    // input excludes cache reads: 1000-400=600 and 500-0=500
    expect(day1).toMatchObject({
      date: "2026-07-01",
      inputTokens: 1100,
      outputTokens: 150,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 400,
      // ccusage total_tokens(): all four counters.
      totalTokens: 1650,
      costUSD: 0.55,
      modelsUsed: ["mimo-v2.6-pro", "deepseek-v4"],
    });
    // Breakdowns follow ccusage order: cost descending.
    expect(day1.modelBreakdowns).toEqual([
      {
        modelName: "mimo-v2.6-pro",
        inputTokens: 600,
        outputTokens: 100,
        cacheCreationTokens: 0,
        cacheReadTokens: 400,
        cost: 0.5,
      },
      {
        modelName: "deepseek-v4",
        inputTokens: 500,
        outputTokens: 50,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cost: 0.05,
      },
    ]);

    const day2 = result.daily[1];
    expect(day2).toMatchObject({
      date: "2026-07-02",
      inputTokens: 150,
      outputTokens: 20,
      cacheCreationInputTokens: 30,
      cacheReadInputTokens: 50,
      costUSD: 0.1,
    });

    expect(result.totals).toMatchObject({
      inputTokens: 1250,
      outputTokens: 170,
      cacheCreationTokens: 30,
      cacheReadTokens: 450,
      totalTokens: 1900,
      totalCost: 0.65,
    });
  });

  it("excludes plugin overhead rows and deduplicates forked copies", () => {
    seedDb(
      dbPath,
      `
      INSERT INTO usage_ledger VALUES
        ('usage_run-1', 'main', 'run-1', 'dim', 'gpt-main',
         '{"promptTokens":100,"completionTokens":20,"totalTokens":120,"cacheReadTokens":40}',
         NULL, '2026-07-01T00:10:00.000Z'),
        ('ledger_11111111-1111-4111-8111-111111111111', 'fork', 'run-1', 'dim', 'gpt-main',
         '{"promptTokens":100,"completionTokens":20,"totalTokens":120,"cacheReadTokens":40}',
         NULL, '2026-07-01T00:10:00.000Z'),
        ('plugin_ledger_original', 'main', NULL, 'dim', 'plugin-model',
         '{"promptTokens":1000,"completionTokens":200,"totalTokens":1200}',
         NULL, '2026-07-01T00:20:00.000Z'),
        ('ledger_22222222-2222-4222-8222-222222222222', 'fork', NULL, 'dim', 'orphan-model',
         '{"promptTokens":50,"completionTokens":10,"totalTokens":60,"cacheReadTokens":20}',
         NULL, '2026-07-01T00:25:00.000Z'),
        ('ledger_33333333-3333-4333-8333-333333333333', 'fork-2', NULL, 'dim', 'orphan-model',
         '{"promptTokens":50,"completionTokens":10,"totalTokens":60,"cacheReadTokens":20}',
         NULL, '2026-07-01T00:25:00.000Z'),
        ('bad-json', 'main', NULL, 'dim', 'bad-model',
         '{', NULL, '2026-07-01T00:27:00.000Z');
      `,
    );

    const result = collectDimagentUsage(dbPath);

    expect(result.daily).toHaveLength(1);
    const day = result.daily[0];
    // gpt-main counted once (60 in + 20 out), orphan fork kept once (30 in),
    // plugin overhead excluded, bad JSON skipped.
    expect(day).toMatchObject({
      inputTokens: 90,
      outputTokens: 30,
      cacheReadInputTokens: 60,
      modelsUsed: ["gpt-main", "orphan-model"],
    });
    expect(result.totals).toMatchObject({
      inputTokens: 90,
      outputTokens: 30,
      totalTokens: 180,
      totalCost: 0,
    });
  });

  it("estimates in-flight runs at the model day rate without double counting", () => {
    seedDb(
      dbPath,
      `
      INSERT INTO usage_ledger VALUES
        ('usage_done', 'sess-1', 'run-done', 'dim', 'model-a',
         '{"promptTokens":1000,"completionTokens":100,"totalTokens":1100}',
         NULL, '2026-07-01T10:00:00.000Z'),
        ('usage_flying', 'sess-1', 'run-flying', 'dim', 'model-a',
         '{"promptTokens":1000,"completionTokens":100,"totalTokens":1100}',
         NULL, '2026-07-01T11:00:00.000Z');
      INSERT INTO usage_run_stats VALUES
        ('run-done', 'sess-1', 'dim', 'model-a', 'completed', NULL,
         '2026-07-01T10:00:00.000Z', 1000, 1000, 100, 1100, NULL, NULL,
         '{"totalCostUsd":1.1,"quality":"exact"}', '{}',
         '2026-07-01T10:00:00.000Z', '2026-07-01T10:00:00.000Z');
      `,
    );

    const result = collectDimagentUsage(dbPath);
    expect(result.daily).toHaveLength(1);
    // Exact 1.1 + estimated 1.1 at the same rate; tokens counted once each.
    expect(result.daily[0].costUSD).toBeCloseTo(2.2, 10);
    expect(result.daily[0]).toMatchObject({
      inputTokens: 2000,
      outputTokens: 200,
      totalTokens: 2200,
    });
  });

  it("groups by system-local day like ccusage, not UTC", () => {
    // Test-only TZ override (runtime-only lookup, not a build input)
    // eslint-disable-next-line turbo/no-undeclared-env-vars
    const previousTz = process.env.TZ;
    // 2026-07-01T16:30Z is 2026-07-02 00:30 in Asia/Shanghai (UTC+8).
    // toISOString().slice(0, 10) would group it under 2026-07-01.
    // eslint-disable-next-line turbo/no-undeclared-env-vars
    process.env.TZ = "Asia/Shanghai";
    try {
      seedDb(
        dbPath,
        `
        INSERT INTO usage_ledger VALUES
          ('usage_late', 'sess-1', 'run-late', 'dim', 'model-a',
           '{"promptTokens":100,"completionTokens":10,"totalTokens":110}',
           NULL, '2026-07-01T16:30:00.000Z');
        `,
      );

      const result = collectDimagentUsage(dbPath);
      expect(result.daily).toHaveLength(1);
      expect(result.daily[0].date).toBe("2026-07-02");
    } finally {
      // eslint-disable-next-line turbo/no-undeclared-env-vars
      if (previousTz === undefined) delete process.env.TZ;
      // eslint-disable-next-line turbo/no-undeclared-env-vars
      else process.env.TZ = previousTz;
    }
  });

  it("keeps modelsUsed in the same cost-descending order as breakdowns", () => {
    seedDb(
      dbPath,
      `
      INSERT INTO usage_ledger VALUES
        ('usage_cheap', 'sess-1', 'run-cheap', 'dim', 'cheap-model',
         '{"promptTokens":100,"completionTokens":10,"totalTokens":110}',
         NULL, '2026-07-01T10:00:00.000Z'),
        ('usage_pricey', 'sess-1', 'run-pricey', 'dim', 'pricey-model',
         '{"promptTokens":10,"completionTokens":1,"totalTokens":11}',
         NULL, '2026-07-01T11:00:00.000Z');
      INSERT INTO usage_run_stats VALUES
        ('run-cheap', 'sess-1', 'dim', 'cheap-model', 'completed', NULL,
         '2026-07-01T10:00:00.000Z', 1000, 100, 10, 110, NULL, NULL,
         '{"totalCostUsd":0.01,"quality":"exact"}', '{}',
         '2026-07-01T10:00:00.000Z', '2026-07-01T10:00:00.000Z'),
        ('run-pricey', 'sess-1', 'dim', 'pricey-model', 'completed', NULL,
         '2026-07-01T11:00:00.000Z', 1000, 10, 1, 11, NULL, NULL,
         '{"totalCostUsd":1.0,"quality":"exact"}', '{}',
         '2026-07-01T11:00:00.000Z', '2026-07-01T11:00:00.000Z');
      `,
    );

    const result = collectDimagentUsage(dbPath);
    expect(result.daily).toHaveLength(1);
    expect(result.daily[0].modelsUsed).toEqual([
      "pricey-model",
      "cheap-model",
    ]);
    expect(
      result.daily[0].modelBreakdowns.map((b) => b.modelName),
    ).toEqual(["pricey-model", "cheap-model"]);
  });
});

describe("getDimAgentDbPath", () => {
  const ENV_KEYS = ["DIMCODE_HOME", "XDG_CONFIG_HOME"] as const;
  let saved: Record<string, string | undefined>;

  function setEnv(key: (typeof ENV_KEYS)[number], value: string | undefined) {
    // Test-only override (dynamic access; runtime-only, not a build input).
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  function readEnv(key: (typeof ENV_KEYS)[number]): string | undefined {
    return process.env[key];
  }

  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) {
      saved[key] = readEnv(key);
      setEnv(key, undefined);
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      setEnv(key, saved[key]);
    }
  });

  it("prefers DimAgent's own DIMCODE_HOME", () => {
    setEnv("DIMCODE_HOME", "/custom/dim-home");
    expect(getDimAgentDbPath()).toBe("/custom/dim-home/dimcode.sqlite");
  });

  it("falls back to XDG_CONFIG_HOME when set", () => {
    setEnv("XDG_CONFIG_HOME", "/custom/xdg");
    expect(getDimAgentDbPath()).toBe("/custom/xdg/.dimcode/v2/dimcode.sqlite");
  });

  it("defaults to ~/.dimcode/v2", () => {
    expect(getDimAgentDbPath().endsWith("/.dimcode/v2/dimcode.sqlite")).toBe(
      true,
    );
  });
});
