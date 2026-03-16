import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function toProjectRef(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    return host.split(".")[0] ?? null;
  } catch {
    return null;
  }
}

export async function GET() {
  const supabaseUrl = process.env.SUPABASE_URL ?? null;
  const publicSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;

  return NextResponse.json(
    {
      ok: true,
      environment: process.env.VERCEL_ENV ?? "unknown",
      vercel_url: process.env.VERCEL_URL ?? null,
      supabase_url: supabaseUrl,
      supabase_project_ref: toProjectRef(supabaseUrl ?? undefined),
      next_public_supabase_url: publicSupabaseUrl,
      next_public_supabase_project_ref: toProjectRef(publicSupabaseUrl ?? undefined)
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0"
      }
    }
  );
}
