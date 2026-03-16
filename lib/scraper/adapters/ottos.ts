import type { ScrapedOffer } from "../../supabase/types";

const OTTOS_PRODUCT_SEARCH_URL = "https://api.ottos.ch/occ/v2/ottos/products/search";
const OTTOS_PRODUCT_DETAIL_URL = "https://api.ottos.ch/occ/v2/ottos/products";
const OTTOS_DEFAULT_PAGE_SIZE = 96;
const OTTOS_DETAIL_CONCURRENCY = 8;
const RETRIES = 2;

type OttosSearchProduct = {
  code?: string;
  name?: string;
  url?: string;
  description?: string;
  purchasable?: boolean;
  price?: { value?: number };
  insteadOfPrice?: { value?: number };
  categories?: Array<{ name?: string }>;
  tags?: string[];
};

type OttosImage = {
  url?: string;
  src?: string;
  imageUrl?: string;
  format?: string;
  imageType?: string;
};

type OttosFeatureValue = {
  value?: string;
};

type OttosFeature = {
  name?: string;
  featureValues?: OttosFeatureValue[];
};

type OttosClassification = {
  features?: OttosFeature[];
};

type OttosProductDetail = {
  code?: string;
  name?: string;
  url?: string;
  description?: string;
  categories?: Array<{ name?: string }>;
  images?: OttosImage[];
  price?: { value?: number };
  insteadOfPrice?: { value?: number };
  classifications?: OttosClassification[];
};

type OttosSearchResponse = {
  products?: OttosSearchProduct[];
  pagination?: {
    totalPages?: number;
  };
};

async function fetchTextWithRetries(url: string, retries = RETRIES): Promise<string> {
  let attempt = 0;
  while (attempt <= retries) {
    attempt += 1;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      if (attempt > retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw new Error("Unreachable");
}

async function fetchJsonWithRetries<T>(url: string, retries = RETRIES): Promise<T> {
  const text = await fetchTextWithRetries(url, retries);
  return JSON.parse(text) as T;
}

function parseVintageYear(input: string | null | undefined): number | null {
  if (!input) return null;
  const match = input.match(/\b(19|20)\d{2}\b/);
  if (!match) return null;
  return Number(match[0]);
}

function parseBottleVolumeCl(input: string | null | undefined): number | null {
  if (!input) return null;
  const match = input.match(/(\d+(?:[.,]\d+)?)\s*cl/i);
  if (!match) return null;
  const normalized = match[1].replace(",", ".");
  const value = Number.parseFloat(normalized);
  if (Number.isNaN(value)) return null;
  return value;
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toAbsoluteOttosProductUrl(path: string | null | undefined): string | null {
  if (!path || !path.trim()) return null;
  try {
    return new URL(path, "https://www.ottos.ch").toString();
  } catch {
    return null;
  }
}

function normalizeTextToken(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function buildOttosDetailUrl(code: string): string {
  const params = new URLSearchParams({
    fields: "FULL",
    lang: "de",
    curr: "CHF"
  });
  return `${OTTOS_PRODUCT_DETAIL_URL}/${encodeURIComponent(code)}?${params.toString()}`;
}

function getPreferredOttosImage(images: OttosImage[] | undefined): string | null {
  if (!Array.isArray(images) || images.length === 0) return null;
  const preferred = images.find(
    (image) =>
      typeof image?.imageType === "string" &&
      image.imageType.toLowerCase().includes("primary")
  );
  const selected = preferred ?? images[0];
  const candidate = selected?.url ?? selected?.src ?? selected?.imageUrl ?? null;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function parseCaseSize(input: string | null | undefined): number | null {
  if (!input) return null;
  const match = input.match(/(\d+)\s*(?:er|x)/i);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function collectOttosFeatures(
  classifications: OttosClassification[] | undefined
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const classification of classifications ?? []) {
    for (const feature of classification.features ?? []) {
      const name = typeof feature.name === "string" ? feature.name.trim() : "";
      if (!name) continue;
      const key = normalizeTextToken(name);
      if (!key) continue;
      const values = (feature.featureValues ?? [])
        .map((entry) => (typeof entry.value === "string" ? entry.value.trim() : ""))
        .filter((value) => value.length > 0);
      if (values.length === 0) continue;
      const existing = out.get(key) ?? [];
      out.set(key, [...existing, ...values]);
    }
  }
  return out;
}

function firstFeatureValue(
  featureMap: Map<string, string[]>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const values = featureMap.get(normalizeTextToken(key));
    if (values && values.length > 0) {
      return values[0] ?? null;
    }
  }
  return null;
}

function mapOttosProductToOffer(
  product: OttosSearchProduct,
  detail: OttosProductDetail | null
): ScrapedOffer | null {
  const name = typeof product.name === "string" ? product.name.trim() : "";
  const code = typeof product.code === "string" ? product.code.trim() : "";
  if (!name || !code) return null;
  if (product.purchasable === false) return null;

  const currentPrice = toNumberOrNull(detail?.price?.value ?? product.price?.value);
  if (currentPrice == null) return null;

  const basePrice = toNumberOrNull(detail?.insteadOfPrice?.value ?? product.insteadOfPrice?.value);
  const tags = Array.isArray(product.tags)
    ? product.tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean)
    : [];
  const hasPromoTag = tags.some((tag) => tag.includes("promo") || tag.includes("aktion"));
  const sourceUrl =
    toAbsoluteOttosProductUrl(detail?.url) ??
    toAbsoluteOttosProductUrl(product.url) ??
    `https://www.ottos.ch/p/${code}`;
  const categoryTitles = Array.isArray(detail?.categories)
    ? detail.categories
        .map((category) => category?.name)
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : Array.isArray(product.categories)
      ? product.categories
          .map((category) => category?.name)
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];

  const featureMap = collectOttosFeatures(detail?.classifications);
  const wineType =
    firstFeatureValue(featureMap, "Weinsorte", "Traubensorte") ??
    categoryTitles.find((title) => /(Rotwein|Weisswein|Ros[eé]|Schaumwein|Champagner)/i.test(title)) ??
    null;
  const country =
    firstFeatureValue(featureMap, "Land") ??
    categoryTitles.find((title) =>
      /(Schweiz|Frankreich|Spanien|Italien|Portugal|Argentinien|Chile|USA|Australien|Südafrika|Oesterreich|Österreich)/i.test(
        title
      )
    ) ??
    null;
  const region = firstFeatureValue(featureMap, "Region", "Anbaugebiet", "Herkunft") ?? null;

  const vintageYear =
    parseVintageYear(firstFeatureValue(featureMap, "Jahrgang", "Jahrgang*")) ??
    parseVintageYear(name) ??
    parseVintageYear(detail?.description ?? product.description);
  const bottleVolumeCl =
    parseBottleVolumeCl(firstFeatureValue(featureMap, "Inhalt", "Flaschengrösse")) ??
    parseBottleVolumeCl(name) ??
    parseBottleVolumeCl(detail?.description ?? product.description);
  const caseSize = parseCaseSize(firstFeatureValue(featureMap, "Gebinde"));
  const imageUrl = getPreferredOttosImage(detail?.images);

  return {
    shop: "ottos",
    shop_product_id: code,
    source_url: sourceUrl,
    name,
    image_url: imageUrl,
    current_price: currentPrice,
    base_price: basePrice,
    case_price: null,
    case_base_price: null,
    wine_type: wineType,
    country,
    region,
    vintage_year: vintageYear,
    category_path: categoryTitles.length > 0 ? categoryTitles.join(" > ") : null,
    bottle_volume_cl: bottleVolumeCl,
    case_size: caseSize,
    is_on_sale: basePrice != null ? currentPrice < basePrice : hasPromoTag
  };
}

async function processInPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function runWorker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

async function fetchOttosProductDetail(code: string): Promise<OttosProductDetail | null> {
  try {
    return await fetchJsonWithRetries<OttosProductDetail>(buildOttosDetailUrl(code));
  } catch {
    return null;
  }
}

export async function fetchOttosOffers(maxProducts: number | null): Promise<{
  offers: ScrapedOffer[];
  selected: number;
  failed: number;
}> {
  const pageSize = OTTOS_DEFAULT_PAGE_SIZE;
  const params = new URLSearchParams({
    query: "::allCategories:m_10400",
    currentPage: "0",
    pageSize: String(pageSize),
    lang: "de",
    curr: "CHF"
  });

  const firstPage = await fetchJsonWithRetries<OttosSearchResponse>(
    `${OTTOS_PRODUCT_SEARCH_URL}?${params.toString()}`
  );
  const totalPages = Math.max(1, firstPage.pagination?.totalPages ?? 1);

  const searchProducts: OttosSearchProduct[] = [];
  let failed = 0;

  function consumeProducts(products: OttosSearchProduct[] | undefined) {
    for (const product of products ?? []) {
      searchProducts.push(product);
    }
  }

  consumeProducts(firstPage.products);

  for (let page = 1; page < totalPages; page += 1) {
    if (maxProducts != null && searchProducts.length >= maxProducts) break;
    const pageParams = new URLSearchParams({
      query: "::allCategories:m_10400",
      currentPage: String(page),
      pageSize: String(pageSize),
      lang: "de",
      curr: "CHF"
    });
    const response = await fetchJsonWithRetries<OttosSearchResponse>(
      `${OTTOS_PRODUCT_SEARCH_URL}?${pageParams.toString()}`
    );
    consumeProducts(response.products);
  }

  const deduplicatedProducts = Array.from(
    new Map(
      searchProducts
        .map((product) => {
          const code = typeof product.code === "string" ? product.code.trim() : "";
          if (!code) return null;
          return [code, product] as const;
        })
        .filter((entry): entry is readonly [string, OttosSearchProduct] => entry != null)
    ).values()
  );

  const cappedProducts =
    maxProducts != null
      ? deduplicatedProducts.slice(0, Math.max(0, Math.floor(maxProducts)))
      : deduplicatedProducts;

  const mappedResults = await processInPool(cappedProducts, OTTOS_DETAIL_CONCURRENCY, async (product) => {
    const code = typeof product.code === "string" ? product.code.trim() : "";
    const detail = code ? await fetchOttosProductDetail(code) : null;
    return mapOttosProductToOffer(product, detail);
  });

  const mappedOffers: ScrapedOffer[] = [];
  for (const mapped of mappedResults) {
    if (mapped) {
      mappedOffers.push(mapped);
    } else {
      failed += 1;
    }
  }

  const deduplicated = Array.from(
    new Map(mappedOffers.map((offer) => [`${offer.shop}|${offer.shop_product_id}`, offer])).values()
  );

  return {
    offers: deduplicated,
    selected: deduplicated.length,
    failed
  };
}
