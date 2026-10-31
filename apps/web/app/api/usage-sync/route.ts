import { createHash, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import type { UsageSyncResponse } from "@/types/api-types";
import { getAccountTimeZone } from "@/lib/account-timezone";
import { parseUpload, SYNC_PROTOCOL } from "@/lib/usage-sync";
import { storeUsage } from "@/lib/usage-store";

// Constant-time secret comparison; hashing first makes it length-independent
function safeKeyCompare(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

// API key validation; returns an error response, or null when authorized
function authorize(request: NextRequest): NextResponse | null {
  const apiKey = request.headers.get("x-api-key");
  const expectedApiKey = process.env.API_KEY;

  if (!expectedApiKey) {
    return NextResponse.json(
      { error: "API key not configured on server" },
      { status: 500 },
    );
  }

  if (!apiKey || !safeKeyCompare(apiKey, expectedApiKey)) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }
  return null;
}

// Collectors read the account time zone before collecting, so every device
// buckets days and hours in the same calendar, and the upload format the
// dashboard accepts
export async function GET(request: NextRequest) {
  const unauthorized = authorize(request);
  if (unauthorized) return unauthorized;
  try {
    return NextResponse.json({
      timezone: getAccountTimeZone(),
      protocol: SYNC_PROTOCOL,
    });
  } catch (error) {
    console.error("Account time zone error:", error);
    return NextResponse.json(
      { error: "Account time zone is misconfigured on server" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const unauthorized = authorize(request);
    if (unauthorized) return unauthorized;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request format: body must be JSON" },
        { status: 400 },
      );
    }

    const parsed = parseUpload(body, getAccountTimeZone());
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const result = await storeUsage(parsed.upload);
    const response: UsageSyncResponse = { success: true, ...result };
    return NextResponse.json(response);
  } catch (error) {
    console.error("Usage sync error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
