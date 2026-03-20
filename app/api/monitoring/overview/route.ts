import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth/cron";
import { createServerAdminClient } from "@/lib/supabase/server-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createServerAdminClient();

  const [wineTotalRes, onSaleRes, lastScrapedRes, recentRunsRes] = await Promise.all([
    supabase.from("wine_offers").select("*", { head: true, count: "exact" }),
    supabase.from("wine_offers").select("*", { head: true, count: "exact" }).eq("is_on_sale", true),
    supabase
      .from("wine_offers")
      .select("last_scraped_at")
      .order("last_scraped_at", { ascending: false })
      .limit(1),
    supabase
      .from("job_runs")
      .select("id,job_name,status,started_at,finished_at,duration_ms,details,created_at")
      .order("created_at", { ascending: false })
      .limit(20)
  ]);

  if (wineTotalRes.error || onSaleRes.error || lastScrapedRes.error || recentRunsRes.error) {
    return NextResponse.json(
      {
        error: "Monitoring query failed.",
        details: [
          wineTotalRes.error?.message,
          onSaleRes.error?.message,
          lastScrapedRes.error?.message,
          recentRunsRes.error?.message
        ].filter(Boolean)
      },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      checked_at: new Date().toISOString(),
      wines: {
        total: wineTotalRes.count ?? 0,
        on_sale: onSaleRes.count ?? 0,
        last_scraped_at: lastScrapedRes.data?.[0]?.last_scraped_at ?? null
      },
      recent_runs: recentRunsRes.data ?? []
    },
    {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate" }
    }
  );
}
