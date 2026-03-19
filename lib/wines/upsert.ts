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
    const { error } = await client
      .from("wines")
      .upsert(batch, { onConflict: "denner_product_id", ignoreDuplicates: false });

    if (error) {
      throw new Error(`Supabase upsert failed: ${error.message}`);
    }
    batchCount += 1;
  }

  return { writtenCount: rows.length, batchCount };
}
