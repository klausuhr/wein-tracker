import type { ScrapedWine } from "../supabase/types";

export type FallbackRawWine = {
  name: string | null;
  currentPrice: string | null;
  basePrice: string | null;
  imageUrl: string | null;
  productUrl: string | null;
  dennerProductId: string | null;
};

export function parsePrice(input: string | null): number | null {
  if (!input) return null;
  const normalized = input
    .replace(/CHF|Fr\.?/gi, "")
    .replace(/[^\d,.'-]/g, "")
    .replace(/'/g, "")
    .replace(",", ".")
    .trim();

  if (!normalized) return null;
  const match = normalized.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const value = Number.parseFloat(match[0]);
  if (Number.isNaN(value)) return null;
  return Math.round(value * 100) / 100;
}

export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function toSlugFromUrl(productUrl: string | null): string | null {
  if (!productUrl) return null;
  try {
    const url = new URL(productUrl, "https://www.denner.ch");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return null;
    return parts[parts.length - 1].replace(/\.html?$/i, "");
  } catch {
    return null;
  }
}

export function toAbsoluteProductUrl(productUrl: string | null): string | null {
  if (!productUrl) return null;
  try {
    return new URL(productUrl, "https://www.denner.ch").toString();
  } catch {
    return null;
  }
}

export function extractProductIdFromUrl(productUrl: string | null): string | null {
  if (!productUrl) return null;
  const match = productUrl.match(/~p(\d+)/i);
  return match?.[1] ?? null;
}

export function normalizeFallbackRawWine(raw: FallbackRawWine): ScrapedWine | null {
  const name = raw.name?.trim().replace(/\s+/g, " ") ?? "";
  if (!name) return null;

  const currentPrice = parsePrice(raw.currentPrice);
  if (currentPrice == null) return null;

  const sourceUrl = toAbsoluteProductUrl(raw.productUrl);
  const slug = toSlugFromUrl(raw.productUrl) ?? slugifyName(name);
  const dennerProductId = raw.dennerProductId ?? extractProductIdFromUrl(raw.productUrl);

  if (!slug || !sourceUrl || !dennerProductId) return null;

  const basePrice = parsePrice(raw.basePrice);

  return {
    name,
    slug,
    denner_product_id: dennerProductId,
    source_url: sourceUrl,
    image_url: raw.imageUrl?.trim() || null,
    current_price: currentPrice,
    base_price: basePrice,
    case_price: null,
    case_base_price: null,
    wine_type: null,
    country: null,
    region: null,
    vintage_year: null,
    category_path: null,
    bottle_volume_cl: null,
    case_size: null,
    is_on_sale: basePrice != null ? currentPrice < basePrice : false
  };
}

export function deduplicateBySlug(wines: ScrapedWine[]): ScrapedWine[] {
  const bySlug = new Map<string, ScrapedWine>();
  for (const wine of wines) {
    bySlug.set(wine.slug, wine);
  }
  return Array.from(bySlug.values());
}

export function deduplicateByDennerProductId(wines: ScrapedWine[]): ScrapedWine[] {
  const byProductId = new Map<string, ScrapedWine>();
  for (const wine of wines) {
    byProductId.set(wine.denner_product_id, wine);
  }
  return Array.from(byProductId.values());
}
