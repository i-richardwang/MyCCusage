import { describe, expect, it } from "vitest";
import { parseUpload, planUsageWrite, SYNC_PROTOCOL } from "@/lib/usage-sync";

const device = {
  deviceId: "d1",
  deviceName: "host",
  agentType: "claude-code",
};
const bucket = {
  date: "2026-10-30",
  hourStart: "2026-10-30T01:00:00.000Z",
  model: "claude-opus-5-5",
  inputTokens: 10,
  outputTokens: 5,
  cacheCreationTokens: 20,
  cacheReadTokens: 400,
  reasoningTokens: 2,
  cost: 0.25,
  requests: 3,
};
const upload = (overrides: Record<string, unknown> = {}) => ({
  version: SYNC_PROTOCOL,
  device,
  timezone: "Asia/Shanghai",
  buckets: [bucket],
  ...overrides,
});
const parse = (body: unknown) => parseUpload(body, "Asia/Shanghai");
const error = (body: unknown) => {
  const result = parse(body);
  return result.ok ? null : result.error;
};

describe("parseUpload", () => {
  it("accepts hourly buckets and replaces every day of the range", () => {
    const result = parse(
      upload({ range: { from: "2026-10-28", to: "2026-10-30" } }),
    );
    expect(result).toEqual({
      ok: true,
      upload: {
        device,
        days: ["2026-10-28", "2026-10-29", "2026-10-30"],
        buckets: [
          {
            ...bucket,
            hourStart: new Date(bucket.hourStart),
            totalTokens: 435,
          },
        ],
      },
    });
  });

  it("replaces only the buckets' days without a range", () => {
    const result = parse(
      upload({
        buckets: [
          { ...bucket, hourStart: undefined, date: "2026-10-01" },
          { ...bucket, hourStart: undefined, date: "2026-10-03", model: "" },
        ],
      }),
    );
    expect(result.ok && result.upload.days).toEqual([
      "2026-10-01",
      "2026-10-03",
    ]);
    expect(result.ok && result.upload.buckets[1]).toMatchObject({
      hourStart: null,
      model: "",
    });
  });

  it("accepts an empty upload whose range states days without usage", () => {
    const result = parse(
      upload({ buckets: [], range: { from: "2026-10-30", to: "2026-10-30" } }),
    );
    expect(result.ok && result.upload).toMatchObject({
      days: ["2026-10-30"],
      buckets: [],
    });
  });

  it("requires hours that start on the account's clocks and lie in their day", () => {
    expect(
      error(
        upload({ buckets: [{ ...bucket, hourStart: "2026-10-30T01:30:00Z" }] }),
      ),
    ).toContain("does not start an hour");
    // 16:00 UTC is midnight of the next day in Shanghai
    expect(
      error(
        upload({ buckets: [{ ...bucket, hourStart: "2026-10-30T16:00:00Z" }] }),
      ),
    ).toContain("is not on 2026-10-30");
    // Kolkata hours start at half past UTC hours
    expect(
      parseUpload(
        {
          ...upload({
            buckets: [{ ...bucket, hourStart: "2026-10-30T01:30:00Z" }],
          }),
          timezone: "Asia/Kolkata",
        },
        "Asia/Kolkata",
      ).ok,
    ).toBe(true);
  });

  it("rejects the whole upload when any part is invalid", () => {
    expect(error(upload({ timezone: "UTC" }))).toContain(
      "account time zone Asia/Shanghai",
    );
    expect(
      error(upload({ device: { ...device, agentType: "nope" } })),
    ).toContain("Invalid agent type");
    expect(error(upload({ device: { deviceName: "x" } }))).toContain(
      "device information",
    );
    expect(
      error(upload({ device: { ...device, agentType: undefined } })),
    ).toContain("Invalid agent type");
    expect(
      error(upload({ buckets: [bucket, { ...bucket, inputTokens: -1 }] })),
    ).toContain("inputTokens");
    expect(error(upload({ buckets: [bucket, bucket] }))).toContain(
      "Duplicate bucket",
    );
    expect(
      error(upload({ buckets: [{ ...bucket, cost: Number.NaN }] })),
    ).toContain("cost");
    expect(
      error(upload({ range: { from: "2026-10-30", to: "2026-10-01" } })),
    ).toContain("range");
    expect(error(upload({ buckets: undefined }))).toContain("buckets array");
  });

  it("names the protocol it speaks to collectors that speak another", () => {
    expect(error(upload({ version: 2 }))).toContain(
      `Unsupported sync protocol 2; this dashboard speaks ${SYNC_PROTOCOL}`,
    );
    expect(error(upload({ version: undefined }))).toContain(
      "Unsupported sync protocol none",
    );
  });
});

it("backfills missing days but preserves every bucket on existing historical days", () => {
  const parsed = parse(
    upload({
      backfillBefore: "2026-10-01",
      range: { from: "2026-10-29", to: "2026-10-30" },
      buckets: [
        { ...bucket, hourStart: undefined, date: "2024-01-01" },
        {
          ...bucket,
          hourStart: undefined,
          date: "2024-01-01",
          model: "another-model",
        },
        { ...bucket, hourStart: undefined, date: "2024-01-02" },
        { ...bucket, hourStart: undefined, date: "2026-10-01" },
        bucket,
      ],
    }),
  );
  if (!parsed.ok) throw new Error(parsed.error);
  const applied = planUsageWrite(parsed.upload, [
    "2024-01-01",
    "2026-10-01",
    "2026-10-29",
    "2026-10-30",
  ]);
  expect(applied.days).toEqual([
    "2024-01-02",
    "2026-10-01",
    "2026-10-29",
    "2026-10-30",
  ]);
  expect(applied.buckets.map((b) => b.date)).toEqual([
    "2024-01-02",
    "2026-10-01",
    "2026-10-30",
  ]);
  // A retry cannot insert the old missing day's usage twice.
  expect(
    planUsageWrite(parsed.upload, [...applied.days, "2024-01-01"]).buckets.map(
      (b) => b.date,
    ),
  ).toEqual(["2026-10-01", "2026-10-30"]);
  expect(error(upload({ backfillBefore: "not-a-day" }))).toContain(
    "backfillBefore",
  );
});
