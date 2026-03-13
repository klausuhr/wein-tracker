import { NextResponse } from "next/server";
import { createServerAdminClient } from "@/lib/supabase/server-admin";

export async function GET() {
  const supabase = createServerAdminClient();
  const startedAt = Date.now();

  const [dbCheck, wineCountRes, lastScrapedRes] = await Promise.all([
    supabase.from("wines").select("id", { head: true, count: "exact" }).limit(1),
    supabase.from("wines").select("*", { head: true, count: "exact" }),
    supabase
      .from("wines")
      .select("last_scraped_at")
      .order("last_scraped_at", { ascending: false })
      .limit(1)
  ]);

  const dbOk = !dbCheck.error;
  const response = {
    ok: dbOk,
    checked_at: new Date().toISOString(),
    response_ms: Date.now() - startedAt,
    db: {
      ok: dbOk,
      error: dbCheck.error?.message ?? null
    },
    wines: {
      total: wineCountRes.count ?? 0,
      last_scraped_at: lastScrapedRes.data?.[0]?.last_scraped_at ?? null
    }
  };

  return NextResponse.json(response, { status: dbOk ? 200 : 503 });
}
