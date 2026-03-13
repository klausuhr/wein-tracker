import { NextResponse } from "next/server";
import { sendTrackingReadyEmail } from "@/lib/email/resend";
import { getServerEnv } from "@/lib/env";
import { createServerAdminClient } from "@/lib/supabase/server-admin";
import { createTrackingToken } from "@/lib/tokens/tracking";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token." }, { status: 400 });
  }

  const supabase = createServerAdminClient();
  const { data: subscription, error } = await supabase
    .from("subscriptions")
    .select("id, email, is_confirmed")
    .eq("confirmation_token", token)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!subscription) {
    return NextResponse.json({ error: "Invalid verification token." }, { status: 404 });
  }

  if (!subscription.is_confirmed) {
    const { error: updateError } = await supabase
      .from("subscriptions")
      .update({ is_confirmed: true })
      .eq("id", subscription.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
  }

  const env = getServerEnv();
  const trackingToken = createTrackingToken(subscription.email);
  const trackingUrl = new URL(`/my-trackings/${trackingToken}`, env.APP_BASE_URL);
  trackingUrl.searchParams.set("verified", "1");

  try {
    await sendTrackingReadyEmail({ to: subscription.email, trackingUrl: trackingUrl.toString() });
  } catch (mailError) {
    console.error("[verify] tracking-ready email failed", mailError);
  }

  return NextResponse.redirect(trackingUrl);
}
