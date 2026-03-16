import { NextResponse } from "next/server";
import { sendSaleAlertEmail } from "@/lib/email/resend";
import { getServerEnv } from "@/lib/env";
import { recordJobRun } from "@/lib/monitoring/job-runs";
import { createServerAdminClient } from "@/lib/supabase/server-admin";
import { createTrackingToken } from "@/lib/tokens/tracking";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const startedAt = new Date();
  const env = getServerEnv();
  const authHeader = request.headers.get("authorization");
  const supabase = createServerAdminClient();

  if (env.CRON_SECRET) {
    const expected = `Bearer ${env.CRON_SECRET}`;
    if (authHeader !== expected) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
  }

  if (!env.RESEND_API_KEY) {
    const finishedAt = new Date();
    try {
      await recordJobRun(
        {
          jobName: "notify_sales",
          status: "failed",
          startedAt,
          finishedAt,
          details: { message: "RESEND_API_KEY is required for /api/notify." }
        },
        supabase
      );
    } catch {
      // no-op
    }
    return NextResponse.json(
      { error: "RESEND_API_KEY is required for /api/notify." },
      { status: 500 }
    );
  }

  const { data, error } = await supabase
    .from("subscriptions")
    .select(
      "id,email,is_confirmed,offer_id,wine_offers!inner(id,shop,name,current_price,base_price,is_on_sale,canonical_wines(name))"
    )
    .eq("is_confirmed", true)
    .eq("wine_offers.is_on_sale", true);

  if (error) {
    const finishedAt = new Date();
    try {
      await recordJobRun({
        jobName: "notify_sales",
        status: "failed",
        startedAt,
        finishedAt,
        details: { message: error.message }
      }, supabase);
    } catch {
      // no-op
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of data ?? []) {
    const offer = Array.isArray(row.wine_offers) ? row.wine_offers[0] : row.wine_offers;
    if (!offer) continue;
    const canonical = Array.isArray(offer.canonical_wines) ? offer.canonical_wines[0] : offer.canonical_wines;

    const currentPrice = Number(offer.current_price);
    const basePrice = offer.base_price == null ? null : Number(offer.base_price);

    const { data: eventRow, error: eventSelectError } = await supabase
      .from("notification_events")
      .select("id,last_notified_price,last_notified_base_price,send_count")
      .eq("subscription_id", row.id)
      .maybeSingle();

    if (eventSelectError) {
      failed += 1;
      console.error("[notify] dedupe lookup failed", eventSelectError);
      continue;
    }

    const hasPriceChanged =
      !eventRow ||
      Number(eventRow.last_notified_price) !== currentPrice ||
      ((eventRow.last_notified_base_price == null ? null : Number(eventRow.last_notified_base_price)) !==
        basePrice);

    if (!hasPriceChanged) {
      skipped += 1;
      continue;
    }

    try {
      const token = createTrackingToken(row.email);
      const trackingUrl = new URL(`/my-trackings/${token}`, env.APP_BASE_URL).toString();

      await sendSaleAlertEmail({
        to: row.email,
        wineName: `${canonical?.name ?? offer.name} (${offer.shop})`,
        currentPrice,
        basePrice,
        trackingUrl
      });

      const now = new Date().toISOString();
      if (eventRow) {
        const { error: updateError } = await supabase
          .from("notification_events")
          .update({
            last_notified_price: currentPrice,
            last_notified_base_price: basePrice,
            last_notified_at: now,
            updated_at: now,
            send_count: Number(eventRow.send_count ?? 0) + 1
          })
          .eq("id", eventRow.id);

        if (updateError) {
          failed += 1;
          console.error("[notify] dedupe update failed", updateError);
          continue;
        }
      } else {
        const { error: insertError } = await supabase.from("notification_events").insert({
          subscription_id: row.id,
          wine_id: null,
          offer_id: row.offer_id ?? offer.id,
          last_notified_price: currentPrice,
          last_notified_base_price: basePrice,
          last_notified_at: now,
          updated_at: now,
          send_count: 1
        });

        if (insertError) {
          failed += 1;
          console.error("[notify] dedupe insert failed", insertError);
          continue;
        }
      }
      sent += 1;
    } catch (mailError) {
      failed += 1;
      console.error("[notify] send failed", mailError);
    }
  }

  const finishedAt = new Date();
  try {
    await recordJobRun(
      {
        jobName: "notify_sales",
        status: failed > 0 ? "failed" : "ok",
        startedAt,
        finishedAt,
        details: {
          total: data?.length ?? 0,
          sent,
          failed,
          skipped
        }
      },
      supabase
    );
  } catch {
    // no-op
  }

  return NextResponse.json({ ok: true, total: data?.length ?? 0, sent, failed, skipped });
}
