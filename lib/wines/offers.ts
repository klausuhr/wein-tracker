import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerAdminClient } from "../supabase/server-admin";
import type { ScrapedOffer, ShopId } from "../supabase/types";

const BATCH_SIZE = 200;
const LOOKUP_BATCH_SIZE = 25;

type UpsertOffersResult = {
  offers_requested: number;
  canonical_created: number;
  offers_written: number;
  batch_count: number;
};

function normalizeToken(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function buildCanonicalKey(offer: ScrapedOffer): string {
  const name = normalizeToken(offer.name);
  const country = normalizeToken(offer.country);
  const vintage = offer.vintage_year == null ? "" : String(offer.vintage_year);
  const volume = offer.bottle_volume_cl == null ? "" : String(Math.round(offer.bottle_volume_cl));
  return `${name}|${vintage}|${volume}|${country}`;
}

function toCanonicalSeed(offer: ScrapedOffer) {
  return {
    canonical_key: buildCanonicalKey(offer),
    name: offer.name,
    image_url: offer.image_url,
    wine_type: offer.wine_type,
    country: offer.country,
    region: offer.region,
    vintage_year: offer.vintage_year,
    category_path: offer.category_path,
    bottle_volume_cl: offer.bottle_volume_cl,
    case_size: offer.case_size
  };
}

export async function upsertWineOffers(
  offers: ScrapedOffer[],
  client: SupabaseClient = createServerAdminClient()
): Promise<UpsertOffersResult> {
  if (offers.length === 0) {
    return { offers_requested: 0, canonical_created: 0, offers_written: 0, batch_count: 0 };
  }

  const canonicalSeeds = offers.map(toCanonicalSeed);
  const keys = Array.from(new Set(canonicalSeeds.map((seed) => seed.canonical_key)));

  const existingCanonicalRows: Array<{ id: string; canonical_key: string }> = [];
  for (let index = 0; index < keys.length; index += LOOKUP_BATCH_SIZE) {
    const batchKeys = keys.slice(index, index + LOOKUP_BATCH_SIZE);
    const { data: batchRows, error: batchError } = await client
      .from("canonical_wines")
      .select("id, canonical_key")
      .in("canonical_key", batchKeys);

    if (batchError) {
      throw new Error(`Canonical lookup failed: ${batchError.message}`);
    }
    existingCanonicalRows.push(...(batchRows ?? []));
  }

  const existingKeys = new Set((existingCanonicalRows ?? []).map((row) => row.canonical_key));
  const missingCanonicalRows = canonicalSeeds
    .filter((seed) => !existingKeys.has(seed.canonical_key))
    .filter((seed, index, arr) => arr.findIndex((item) => item.canonical_key === seed.canonical_key) === index);

  let canonicalCreated = 0;
  if (missingCanonicalRows.length > 0) {
    const { error: upsertCanonicalError } = await client
      .from("canonical_wines")
      .upsert(missingCanonicalRows, { onConflict: "canonical_key", ignoreDuplicates: true });
    if (upsertCanonicalError) {
      throw new Error(`Canonical upsert failed: ${upsertCanonicalError.message}`);
    }
    canonicalCreated = missingCanonicalRows.length;
  }

  const allCanonicalRows: Array<{ id: string; canonical_key: string }> = [];
  for (let index = 0; index < keys.length; index += LOOKUP_BATCH_SIZE) {
    const batchKeys = keys.slice(index, index + LOOKUP_BATCH_SIZE);
    const { data: batchRows, error: batchError } = await client
      .from("canonical_wines")
      .select("id, canonical_key")
      .in("canonical_key", batchKeys);

    if (batchError) {
      throw new Error(`Canonical reload failed: ${batchError.message}`);
    }
    allCanonicalRows.push(...(batchRows ?? []));
  }

  const canonicalIdByKey = new Map<string, string>();
  for (const row of allCanonicalRows ?? []) {
    canonicalIdByKey.set(row.canonical_key, row.id);
  }

  const seedByKey = new Map<string, ReturnType<typeof toCanonicalSeed>>();
  for (const seed of canonicalSeeds) {
    if (!seedByKey.has(seed.canonical_key)) {
      seedByKey.set(seed.canonical_key, seed);
    }
  }

  for (const key of keys) {
    if (canonicalIdByKey.has(key)) continue;
    const { data: singleRow, error: singleLookupError } = await client
      .from("canonical_wines")
      .select("id, canonical_key")
      .eq("canonical_key", key)
      .maybeSingle();

    if (singleLookupError) {
      throw new Error(`Canonical single-key lookup failed: ${singleLookupError.message}`);
    }

    if (singleRow?.id) {
      canonicalIdByKey.set(key, singleRow.id);
      continue;
    }

    const fallbackSeed = seedByKey.get(key);
    if (!fallbackSeed) continue;

    const { error: fallbackUpsertError } = await client
      .from("canonical_wines")
      .upsert(fallbackSeed, { onConflict: "canonical_key", ignoreDuplicates: true });

    if (fallbackUpsertError) {
      throw new Error(`Canonical fallback upsert failed: ${fallbackUpsertError.message}`);
    }

    const { data: insertedRow, error: fallbackReloadError } = await client
      .from("canonical_wines")
      .select("id, canonical_key")
      .eq("canonical_key", key)
      .maybeSingle();

    if (fallbackReloadError) {
      throw new Error(`Canonical fallback reload failed: ${fallbackReloadError.message}`);
    }
    if (!insertedRow?.id) {
      throw new Error(`Canonical fallback mapping still missing for key: ${key}`);
    }
    canonicalIdByKey.set(insertedRow.canonical_key, insertedRow.id);
  }

  const scrapedAt = new Date().toISOString();
  const offerRows = offers.map((offer) => {
    const canonicalKey = buildCanonicalKey(offer);
    const canonicalWineId = canonicalIdByKey.get(canonicalKey);
    if (!canonicalWineId) {
      throw new Error(`Missing canonical mapping for key: ${canonicalKey}`);
    }
    return {
      canonical_wine_id: canonicalWineId,
      shop: offer.shop,
      shop_product_id: offer.shop_product_id,
      source_url: offer.source_url,
      name: offer.name,
      image_url: offer.image_url,
      current_price: offer.current_price,
      base_price: offer.base_price,
      case_price: offer.case_price,
      case_base_price: offer.case_base_price,
      is_on_sale: offer.is_on_sale,
      last_scraped_at: scrapedAt,
      updated_at: scrapedAt
    };
  });

  let batchCount = 0;
  for (let index = 0; index < offerRows.length; index += BATCH_SIZE) {
    const batch = offerRows.slice(index, index + BATCH_SIZE);
    const { error } = await client
      .from("wine_offers")
      .upsert(batch, { onConflict: "shop,shop_product_id", ignoreDuplicates: false });
    if (error) {
      throw new Error(`Offer upsert failed: ${error.message}`);
    }
    batchCount += 1;
  }

  return {
    offers_requested: offers.length,
    canonical_created: canonicalCreated,
    offers_written: offers.length,
    batch_count: batchCount
  };
}

type OfferHistoryInsertResult = {
  requested: number;
  inserted: number;
  batch_count: number;
};

export async function insertOfferPriceHistory(
  offers: ScrapedOffer[],
  client: SupabaseClient = createServerAdminClient()
): Promise<OfferHistoryInsertResult> {
  if (offers.length === 0) {
    return { requested: 0, inserted: 0, batch_count: 0 };
  }

  const byShop = new Map<ShopId, string[]>();
  for (const offer of offers) {
    const list = byShop.get(offer.shop) ?? [];
    list.push(offer.shop_product_id);
    byShop.set(offer.shop, list);
  }

  const offerIdMap = new Map<string, string>();
  for (const [shop, ids] of byShop.entries()) {
    const uniqueIds = Array.from(new Set(ids));
    const { data, error } = await client
      .from("wine_offers")
      .select("id, shop, shop_product_id")
      .eq("shop", shop)
      .in("shop_product_id", uniqueIds);
    if (error) {
      throw new Error(`Offer id lookup failed for ${shop}: ${error.message}`);
    }
    for (const row of data ?? []) {
      offerIdMap.set(`${row.shop}|${row.shop_product_id}`, row.id);
    }
  }

  const scrapedAt = new Date().toISOString();
  const rows = offers
    .map((offer) => {
      const offerId = offerIdMap.get(`${offer.shop}|${offer.shop_product_id}`);
      if (!offerId) return null;
      return {
        wine_id: null,
        denner_product_id: null,
        offer_id: offerId,
        shop: offer.shop,
        shop_product_id: offer.shop_product_id,
        scraped_at: scrapedAt,
        current_price: offer.current_price,
        base_price: offer.base_price,
        case_price: offer.case_price,
        case_base_price: offer.case_base_price,
        is_on_sale: offer.is_on_sale,
        source_job: `scrape_${offer.shop}`
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  let batchCount = 0;
  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const batch = rows.slice(index, index + BATCH_SIZE);
    const { error } = await client.from("wine_price_history").insert(batch);
    if (error) {
      throw new Error(`Offer history insert failed: ${error.message}`);
    }
    batchCount += 1;
  }

  return { requested: offers.length, inserted: rows.length, batch_count: batchCount };
}
