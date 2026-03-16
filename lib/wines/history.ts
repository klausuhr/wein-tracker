import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerAdminClient } from "../supabase/server-admin";
import type { ScrapedWine } from "../supabase/types";

const BATCH_SIZE = 200;

type HistoryWriteResult = {
  requested: number;
  mapped: number;
  inserted: number;
  batchCount: number;
};

export async function insertWinePriceHistory(
  wines: ScrapedWine[],
  client: SupabaseClient = createServerAdminClient()
): Promise<HistoryWriteResult> {
  if (wines.length === 0) {
    return { requested: 0, mapped: 0, inserted: 0, batchCount: 0 };
  }

  const dennerIds = Array.from(new Set(wines.map((wine) => wine.denner_product_id)));
  const { data: idRows, error: idError } = await client
    .from("wines")
    .select("id, denner_product_id")
    .in("denner_product_id", dennerIds);

  if (idError) {
    throw new Error(`History lookup failed: ${idError.message}`);
  }

  const idMap = new Map<string, string>();
  for (const row of idRows ?? []) {
    if (row.denner_product_id) {
      idMap.set(row.denner_product_id, row.id);
    }
  }

  const scrapedAt = new Date().toISOString();
  const rows = wines
    .map((wine) => {
      const wineId = idMap.get(wine.denner_product_id);
      if (!wineId) return null;
      return {
        wine_id: wineId,
        denner_product_id: wine.denner_product_id,
        scraped_at: scrapedAt,
        current_price: wine.current_price,
        base_price: wine.base_price,
        case_price: wine.case_price,
        case_base_price: wine.case_base_price,
        is_on_sale: wine.is_on_sale,
        source_job: "scrape_wines"
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (rows.length === 0) {
    return { requested: wines.length, mapped: 0, inserted: 0, batchCount: 0 };
  }

  let batchCount = 0;
  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const batch = rows.slice(index, index + BATCH_SIZE);
    const { error } = await client.from("wine_price_history").insert(batch);
    if (error) {
      throw new Error(`History insert failed: ${error.message}`);
    }
    batchCount += 1;
  }

  return {
    requested: wines.length,
    mapped: rows.length,
    inserted: rows.length,
    batchCount
  };
}
