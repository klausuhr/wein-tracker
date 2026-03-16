import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerAdminClient } from "@/lib/supabase/server-admin";

const paramsSchema = z.object({
  id: z.string().uuid()
});

const querySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((value) => (value ? Number(value) : 50))
    .refine((value) => Number.isFinite(value) && value > 0 && value <= 500, {
      message: "limit must be between 1 and 500."
    })
});

export async function GET(
  request: Request,
  context: { params: { id: string } }
) {
  try {
    const params = paramsSchema.parse(context.params);
    const { searchParams } = new URL(request.url);
    const query = querySchema.parse({ limit: searchParams.get("limit") ?? undefined });

    const supabase = createServerAdminClient();

    const { data: wine, error: wineError } = await supabase
      .from("wines")
      .select("id,name,slug,denner_product_id,current_price,base_price,case_price,case_base_price,is_on_sale,last_scraped_at")
      .eq("id", params.id)
      .maybeSingle();

    if (wineError) {
      return NextResponse.json({ error: wineError.message }, { status: 500 });
    }
    if (!wine) {
      return NextResponse.json({ error: "Wine not found." }, { status: 404 });
    }

    const { data: history, error: historyError } = await supabase
      .from("wine_price_history")
      .select(
        "id,scraped_at,current_price,base_price,case_price,case_base_price,is_on_sale,source_job,created_at"
      )
      .eq("wine_id", params.id)
      .order("scraped_at", { ascending: false })
      .limit(query.limit);

    if (historyError) {
      return NextResponse.json({ error: historyError.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      wine,
      points: history ?? [],
      returned: history?.length ?? 0
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request.", issues: error.issues }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error." },
      { status: 500 }
    );
  }
}
