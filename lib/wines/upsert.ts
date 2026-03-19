import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerAdminClient } from "../supabase/server-admin";
import type { ScrapedWine } from "../supabase/types";

const BATCH_SIZE = 100;

type UpsertResult = {
  writtenCount: number;
  batchCount: number;
};

export async function upsertWines(
  wines: ScrapedWine[],
  client: SupabaseClient = createServerAdminClient()
): Promise<UpsertResult> {
  if (wines.length === 0) {
    return { writtenCount: 0, batchCount: 0 };
  }

  const lastScrapedAt = new Date().toISOString();
  const rows = wines.map((wine) => ({ ...wine, last_scraped_at: lastScrapedAt }));
  let batchCount = 0;

  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const batch = rows.slice(index, index + BATCH_SIZE);
    const dennerIds = Array.from(
      new Set(batch.map((row) => row.denner_product_id).filter((value): value is string => Boolean(value)))
    );

    const { data: existingRows, error: lookupError } = await client
      .from("wines")
      .select("denner_product_id")
      .in("denner_product_id", dennerIds);

    if (lookupError) {
      throw new Error(`Supabase lookup failed: ${lookupError.message}`);
    }

    const existingIds = new Set((existingRows ?? []).map((row) => row.denner_product_id));
    const toUpdate = batch.filter((row) => existingIds.has(row.denner_product_id));
    const toInsert = batch.filter((row) => !existingIds.has(row.denner_product_id));

    for (const row of toUpdate) {
      const { error: updateError } = await client
        .from("wines")
        .update(row)
        .eq("denner_product_id", row.denner_product_id);

      if (updateError) {
        throw new Error(`Supabase update failed: ${updateError.message}`);
      }
    }

    if (toInsert.length > 0) {
      const { error: insertError } = await client
        .from("wines")
        .upsert(toInsert, { onConflict: "slug", ignoreDuplicates: false });

      if (insertError) {
        throw new Error(`Supabase insert failed: ${insertError.message}`);
      }
    }
    batchCount += 1;
  }

  return { writtenCount: rows.length, batchCount };
}
