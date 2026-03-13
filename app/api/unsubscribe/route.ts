import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerAdminClient } from "@/lib/supabase/server-admin";
import { readTrackingToken } from "@/lib/tokens/tracking";

const bodySchema = z.object({
  token: z.string().min(1),
  subscriptionId: z.string().uuid()
});

export async function POST(request: Request) {
  try {
    const parsed = bodySchema.parse(await request.json());
    const payload = readTrackingToken(parsed.token);
    if (!payload) {
      return NextResponse.json({ error: "Invalid tracking token." }, { status: 401 });
    }

    const supabase = createServerAdminClient();
    const { data: subscription, error: selectError } = await supabase
      .from("subscriptions")
      .select("id, email")
      .eq("id", parsed.subscriptionId)
      .maybeSingle();

    if (selectError) {
      return NextResponse.json({ error: selectError.message }, { status: 500 });
    }
    if (!subscription) {
      return NextResponse.json({ error: "Tracking not found." }, { status: 404 });
    }

    if (subscription.email.toLowerCase() !== payload.email.toLowerCase()) {
      return NextResponse.json({ error: "Token/email mismatch." }, { status: 403 });
    }

    const { error: deleteError } = await supabase
      .from("subscriptions")
      .delete()
      .eq("id", parsed.subscriptionId);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error." },
      { status: 500 }
    );
  }
}
