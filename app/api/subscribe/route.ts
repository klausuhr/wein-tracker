import crypto from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { sendVerificationEmail } from "@/lib/email/resend";
import { getServerEnv } from "@/lib/env";
import { createServerAdminClient } from "@/lib/supabase/server-admin";

const bodySchema = z.object({
  email: z.string().email().max(320),
  wineId: z.string().uuid()
});

export async function POST(request: Request) {
  try {
    const parsed = bodySchema.parse(await request.json());
    const email = parsed.email.trim().toLowerCase();
    const wineId = parsed.wineId;

    const supabase = createServerAdminClient();
    const { data: wine, error: wineError } = await supabase
      .from("wines")
      .select("id, name")
      .eq("id", wineId)
      .maybeSingle();

    if (wineError) {
      return NextResponse.json({ error: wineError.message }, { status: 500 });
    }
    if (!wine) {
      return NextResponse.json({ error: "Wine not found." }, { status: 404 });
    }

    const confirmationToken = crypto.randomUUID();
    const { data: existing, error: existingError } = await supabase
      .from("subscriptions")
      .select("id, is_confirmed")
      .eq("email", email)
      .eq("wine_id", wineId)
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
        .update({ confirmation_token: confirmationToken, is_confirmed: false })
        .eq("id", existing.id);
      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    } else {
      const { error: insertError } = await supabase.from("subscriptions").insert({
        email,
        wine_id: wineId,
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
      wineName: wine.name
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
