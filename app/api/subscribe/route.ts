import crypto from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { sendVerificationEmail } from "@/lib/email/resend";
import { getServerEnv } from "@/lib/env";
import { createServerAdminClient } from "@/lib/supabase/server-admin";

const bodySchema = z.object({
  email: z.string().email().max(320),
  offerId: z.string().uuid().optional(),
  wineId: z.string().uuid().optional()
}).refine((value) => Boolean(value.offerId || value.wineId), {
  message: "offerId or wineId is required."
});

export async function POST(request: Request) {
  try {
    const parsed = bodySchema.parse(await request.json());
    const email = parsed.email.trim().toLowerCase();
    const offerId = parsed.offerId ?? null;
    const legacyWineId = parsed.wineId ?? null;

    const supabase = createServerAdminClient();
    let resolvedOfferId = offerId;
    let resolvedWineId = legacyWineId;
    let wineName = "";

    if (resolvedOfferId) {
      const { data: offer, error: offerError } = await supabase
        .from("wine_offers")
        .select("id,name,canonical_wines(name)")
        .eq("id", resolvedOfferId)
        .maybeSingle();

      if (offerError) {
        return NextResponse.json({ error: offerError.message }, { status: 500 });
      }
      if (!offer) {
        return NextResponse.json({ error: "Offer not found." }, { status: 404 });
      }
      const canonical = Array.isArray(offer.canonical_wines) ? offer.canonical_wines[0] : offer.canonical_wines;
      wineName = canonical?.name ?? offer.name;
    } else if (resolvedWineId) {
      const { data: wine, error: wineError } = await supabase
        .from("wines")
        .select("id,name,denner_product_id,slug")
        .eq("id", resolvedWineId)
        .maybeSingle();

      if (wineError) {
        return NextResponse.json({ error: wineError.message }, { status: 500 });
      }
      if (!wine) {
        return NextResponse.json({ error: "Wine not found." }, { status: 404 });
      }

      wineName = wine.name;
      const productIds = [wine.denner_product_id, wine.slug].filter(
        (value): value is string => typeof value === "string" && value.length > 0
      );
      if (productIds.length > 0) {
        const { data: offerMatch } = await supabase
          .from("wine_offers")
          .select("id")
          .eq("shop", "denner")
          .in("shop_product_id", productIds)
          .limit(1);
        resolvedOfferId = offerMatch?.[0]?.id ?? null;
      }
      if (!resolvedOfferId) {
        return NextResponse.json({ error: "No offer found for selected wine." }, { status: 404 });
      }
    } else {
      return NextResponse.json({ error: "offerId or wineId is required." }, { status: 400 });
    }

    const confirmationToken = crypto.randomUUID();
    const { data: existing, error: existingError } = await supabase
      .from("subscriptions")
      .select("id, is_confirmed")
      .eq("email", email)
      .eq("offer_id", resolvedOfferId)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }

    if (existing?.is_confirmed) {
      return NextResponse.json({
        ok: true,
        message: "This wine is already tracked for this email."
      });
    }

    if (existing) {
      const { error: updateError } = await supabase
        .from("subscriptions")
        .update({
          confirmation_token: confirmationToken,
          is_confirmed: false,
          offer_id: resolvedOfferId,
          wine_id: resolvedWineId
        })
        .eq("id", existing.id);
      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    } else {
      const { error: insertError } = await supabase.from("subscriptions").insert({
        email,
        wine_id: resolvedWineId,
        offer_id: resolvedOfferId,
        is_confirmed: false,
        confirmation_token: confirmationToken
      });
      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
    }

    const env = getServerEnv();
    const verifyUrl = new URL("/api/verify", env.APP_BASE_URL);
    verifyUrl.searchParams.set("token", confirmationToken);
    await sendVerificationEmail({
      to: email,
      verifyUrl: verifyUrl.toString(),
      wineName
    });

    return NextResponse.json({
      ok: true,
      message: "Please check your email and confirm your tracking.",
      // Helpful for local testing when no mail provider is configured.
      verifyUrlPreview: process.env.NODE_ENV !== "production" ? verifyUrl.toString() : undefined
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown server error." },
      { status: 500 }
    );
  }
}
