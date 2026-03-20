import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const env = getServerEnv();
  const authHeader = request.headers.get("authorization");
  const expected = env.CRON_SECRET ? `Bearer ${env.CRON_SECRET}` : null;

  return NextResponse.json({
    ok: true,
    has_cron_secret: Boolean(env.CRON_SECRET),
    has_auth_header: Boolean(authHeader),
    auth_matches: expected != null && authHeader === expected,
    auth_scheme: authHeader?.split(" ")[0] ?? null,
    auth_length: authHeader?.length ?? 0,
    expected_length: expected?.length ?? 0,
    vercel_env: process.env.VERCEL_ENV ?? "unknown"
  });
}
