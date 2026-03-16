import { pathToFileURL } from "node:url";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import { getServerEnv } from "../lib/env";
import { recordJobRun } from "../lib/monitoring/job-runs";
import {
  deduplicateByDennerProductId,
  deduplicateBySlug,
  extractProductIdFromUrl,
  normalizeFallbackRawWine,
  parsePrice,
  slugifyName,
  toAbsoluteProductUrl,
  toSlugFromUrl,
  type FallbackRawWine
} from "../lib/scraper/normalize";
import { loadLocalEnvForScripts } from "../lib/scripts/load-local-env";
import type { ScrapedOffer, ScrapedWine } from "../lib/supabase/types";
import { insertWinePriceHistory } from "../lib/wines/history";
import { insertOfferPriceHistory, upsertWineOffers } from "../lib/wines/offers";
import { upsertWines } from "../lib/wines/upsert";

const SITEMAP_URL = "https://www.denner.ch/sitemap.product.xml";
const PRODUCT_API_URL = "https://www.denner.ch/api/product";
const OTTOS_PRODUCT_SEARCH_URL = "https://api.ottos.ch/occ/v2/ottos/products/search";
const WINE_PATH_PATTERN = "/de/weinshop/";
const API_CONCURRENCY = 10;
const RETRIES = 2;
const OTTOS_DEFAULT_PAGE_SIZE = 96;

type RunScrapeWinesOptions = {
  useFallback?: boolean;
  loadLocalEnv?: boolean;
};

type RunScrapeWinesResult = {
  discovered: number;
  selected: number;
  api_success: number;
  api_skipped: number;
  api_failed: number;
  fallback_success: number;
  fallback_failed: number;
  upsert_written_count: number;
  history_inserted: number;
  offers_written: number;
  offer_history_inserted: number;
  ottos_api_success: number;
  ottos_api_failed: number;
};

function log(event: string, payload: Record<string, unknown> = {}) {
  console.info(`[scraper] ${event}`, payload);
}

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

function parseSitemapUrls(xml: string): string[] {
  const matches = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].trim());
  return matches.filter((url) => url.includes(WINE_PATH_PATTERN));
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

function getImageUrl(images: unknown): string | null {
  if (!Array.isArray(images) || images.length === 0) return null;
  for (const image of images) {
    if (!image || typeof image !== "object") continue;
    const obj = image as Record<string, unknown>;
    const candidates = [obj.src, obj.url, obj.path, obj.imageUrl];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate;
      }
    }
  }
  return null;
}

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

type OttosSearchResponse = {
  products?: OttosSearchProduct[];
  pagination?: {
    totalPages?: number;
    totalResults?: number;
    currentPage?: number;
    pageSize?: number;
  };
};

function mapOttosProductToOffer(product: OttosSearchProduct): ScrapedOffer | null {
  const name = typeof product.name === "string" ? product.name.trim() : "";
  const code = typeof product.code === "string" ? product.code.trim() : "";
  if (!name || !code) return null;
  if (product.purchasable === false) return null;

  const currentPrice = toNumberOrNull(product.price?.value);
  if (currentPrice == null) return null;

  const basePrice = toNumberOrNull(product.insteadOfPrice?.value);
  const tags = Array.isArray(product.tags)
    ? product.tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean)
    : [];
  const hasPromoTag = tags.some((tag) => tag.includes("promo") || tag.includes("aktion"));
  const sourceUrl = toAbsoluteOttosProductUrl(product.url) ?? `https://www.ottos.ch/p/${code}`;
  const categoryTitles = Array.isArray(product.categories)
    ? product.categories
        .map((category) => category?.name)
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];

  const wineType =
    categoryTitles.find((title) => /(Rotwein|Weisswein|Ros[eé]|Schaumwein|Champagner)/i.test(title)) ??
    null;
  const country =
    categoryTitles.find((title) =>
      /(Schweiz|Frankreich|Spanien|Italien|Portugal|Argentinien|Chile|USA|Australien|Südafrika|Oesterreich|Österreich)/i.test(
        title
      )
    ) ?? null;

  const vintageYear = parseVintageYear(name) ?? parseVintageYear(product.description);
  const bottleVolumeCl = parseBottleVolumeCl(name) ?? parseBottleVolumeCl(product.description);

  return {
    shop: "ottos",
    shop_product_id: code,
    source_url: sourceUrl,
    name,
    image_url: null,
    current_price: currentPrice,
    base_price: basePrice,
    case_price: null,
    case_base_price: null,
    wine_type: wineType,
    country,
    region: null,
    vintage_year: vintageYear,
    category_path: categoryTitles.length > 0 ? categoryTitles.join(" > ") : null,
    bottle_volume_cl: bottleVolumeCl,
    case_size: null,
    is_on_sale: basePrice != null ? currentPrice < basePrice : hasPromoTag
  };
}

async function fetchOttosOffers(maxProducts: number | null): Promise<{
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

  const mappedOffers: ScrapedOffer[] = [];
  let failed = 0;

  function consumeProducts(products: OttosSearchProduct[] | undefined) {
    for (const product of products ?? []) {
      const mapped = mapOttosProductToOffer(product);
      if (mapped) {
        mappedOffers.push(mapped);
      } else {
        failed += 1;
      }
    }
  }

  consumeProducts(firstPage.products);

  for (let page = 1; page < totalPages; page += 1) {
    if (maxProducts != null && mappedOffers.length >= maxProducts) break;
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

  const deduplicated = Array.from(
    new Map(mappedOffers.map((offer) => [`${offer.shop}|${offer.shop_product_id}`, offer])).values()
  );

  const capped =
    maxProducts != null ? deduplicated.slice(0, Math.max(0, Math.floor(maxProducts))) : deduplicated;

  return {
    offers: capped,
    selected: capped.length,
    failed
  };
}

function mapDennerWineToOffer(wine: ScrapedWine): ScrapedOffer {
  return {
    shop: "denner",
    shop_product_id: wine.denner_product_id,
    source_url: wine.source_url,
    name: wine.name,
    image_url: wine.image_url,
    current_price: wine.current_price,
    base_price: wine.base_price,
    case_price: wine.case_price,
    case_base_price: wine.case_base_price,
    wine_type: wine.wine_type,
    country: wine.country,
    region: wine.region,
    vintage_year: wine.vintage_year,
    category_path: wine.category_path,
    bottle_volume_cl: wine.bottle_volume_cl,
    case_size: wine.case_size,
    is_on_sale: wine.is_on_sale
  };
}

function mapApiWine(data: Record<string, unknown>, sourceUrl: string, fallbackId: string): ScrapedWine | null {
  const name = typeof data.title === "string" ? data.title.trim() : "";
  if (!name) return null;

  const slug = toSlugFromUrl(sourceUrl) ?? slugifyName(name);
  const dennerProductId =
    typeof data.remoteId === "string"
      ? data.remoteId
      : typeof data.sapId === "string"
        ? data.sapId
        : typeof data.legacyNavisionId === "string"
          ? data.legacyNavisionId
          : fallbackId;

  const sales = (data.sales as Record<string, unknown> | undefined) ?? {};
  const priceSingleUnit = (sales.priceSingleUnit as Record<string, unknown> | undefined) ?? {};
  const priceCase = (sales.price as Record<string, unknown> | undefined) ?? {};

  const currentPrice = toNumberOrNull(priceSingleUnit.raw);
  if (currentPrice == null) return null;

  const basePrice = toNumberOrNull(
    (priceSingleUnit.insteadPrice as Record<string, unknown> | undefined)?.raw
  );
  const casePrice = toNumberOrNull(priceCase.raw);
  const caseBasePrice = toNumberOrNull(
    (priceCase.insteadPrice as Record<string, unknown> | undefined)?.raw
  );
  const caseSize = toNumberOrNull(sales.amount);

  const tracking = (data._tracking as Record<string, unknown> | undefined) ?? {};
  const categories = Array.isArray(data.categories)
    ? (data.categories as Array<Record<string, unknown>>)
    : [];

  const categoryTitles = categories
    .map((category) => category.title)
    .filter((title): title is string => typeof title === "string" && title.trim().length > 0);

  const trackingItemCategory2 =
    typeof tracking.item_category2 === "string" ? tracking.item_category2 : "";
  const wineTypeFromTracking = trackingItemCategory2.split("/")[0]?.trim() ?? "";
  const wineType =
    wineTypeFromTracking ||
    categoryTitles.find((title) => /(Rotwein|Weisswein|Ros[eé]|Champagner|Schaumwein)/i.test(title)) ||
    null;

  const country =
    (typeof tracking.item_category === "string" && tracking.item_category.trim()) ||
    categoryTitles.find((title) =>
      /(Schweiz|Frankreich|Spanien|Italien|Portugal|Argentinien|Chile|USA|Australien|Südafrika|Oesterreich|Österreich)/i.test(
        title
      )
    ) ||
    null;

  const region =
    (typeof tracking.item_brand === "string" && tracking.item_brand.trim()) ||
    categoryTitles[categoryTitles.length - 1] ||
    null;

  const description = typeof data.description === "string" ? data.description : null;
  const vintageYear = parseVintageYear(description ?? trackingItemCategory2);

  const bottleVariant =
    typeof tracking.item_variant === "string" ? tracking.item_variant : description ?? null;
  const bottleVolumeCl = parseBottleVolumeCl(bottleVariant);

  const imageUrl = getImageUrl(data.images);

  return {
    name,
    slug,
    denner_product_id: dennerProductId,
    source_url: sourceUrl,
    image_url: imageUrl,
    current_price: currentPrice,
    base_price: basePrice,
    case_price: casePrice,
    case_base_price: caseBasePrice,
    wine_type: wineType,
    country,
    region,
    vintage_year: vintageYear,
    category_path: categoryTitles.length > 0 ? categoryTitles.join(" > ") : null,
    bottle_volume_cl: bottleVolumeCl,
    case_size: caseSize == null ? null : Math.round(caseSize),
    is_on_sale: basePrice != null ? currentPrice < basePrice : false
  };
}

async function mapSingleProductFromApi(productUrl: string): Promise<ScrapedWine | null> {
  const productId = extractProductIdFromUrl(productUrl);
  if (!productId) return null;

  type ApiResponse = {
    data?: Record<string, unknown>;
  };

  const url = `${PRODUCT_API_URL}/${productId}?locale=de`;
  const response = await fetchJsonWithRetries<ApiResponse>(url);
  if (!response.data) return null;

  const forSale = Boolean(
    (response.data.availability as Record<string, unknown> | undefined)?.forSale
  );
  if (!forSale) return null;

  const absoluteUrl = toAbsoluteProductUrl(productUrl);
  if (!absoluteUrl) return null;
  return mapApiWine(response.data, absoluteUrl, productId);
}

async function acceptCookiesIfPresent(page: Page): Promise<void> {
  const selectors = [
    "button:has-text('Akzeptieren')",
    "button:has-text('Alle akzeptieren')",
    "button:has-text('Accept')",
    "#onetrust-accept-btn-handler"
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0) {
      try {
        await locator.click({ timeout: 2500 });
        return;
      } catch {
        // continue
      }
    }
  }
}

async function getFirstText(root: Locator, selector: string): Promise<string | null> {
  try {
    const text = await root.locator(selector).first().textContent({ timeout: 700 });
    return text?.trim() || null;
  } catch {
    return null;
  }
}

async function getFirstAttr(
  root: Locator,
  selector: string,
  attribute: "src" | "data-src" | "href"
): Promise<string | null> {
  try {
    const value = await root.locator(selector).first().getAttribute(attribute, { timeout: 700 });
    return value?.trim() || null;
  } catch {
    return null;
  }
}

async function scrapeSingleProductWithPlaywright(
  page: Page,
  productUrl: string
): Promise<ScrapedWine | null> {
  const absoluteUrl = toAbsoluteProductUrl(productUrl);
  if (!absoluteUrl) return null;
  await page.goto(absoluteUrl, { waitUntil: "domcontentloaded" });

  const root = page.locator("main").first();
  const name =
    (await getFirstText(root, "h1")) ??
    (await getFirstText(root, ".product-detail__title")) ??
    (await getFirstText(root, ".product-item__title"));

  const currentPrice =
    (await getFirstText(root, ".price-tag__final-price")) ??
    (await getFirstText(root, ".product-price__price")) ??
    (await getFirstText(root, ".price-current"));

  const basePrice =
    (await getFirstText(root, ".price-tag__instead")) ??
    (await getFirstText(root, ".product-price__instead")) ??
    (await getFirstText(root, ".price-old"));

  const imageUrl =
    (await getFirstAttr(root, ".product-detail img", "src")) ??
    (await getFirstAttr(root, "img", "src")) ??
    (await getFirstAttr(root, "img", "data-src"));

  const raw: FallbackRawWine = {
    name,
    currentPrice,
    basePrice,
    imageUrl,
    productUrl: absoluteUrl,
    dennerProductId: extractProductIdFromUrl(absoluteUrl)
  };

  return normalizeFallbackRawWine(raw);
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

async function run(startedAt: Date, options: RunScrapeWinesOptions): Promise<RunScrapeWinesResult> {
  const env = getServerEnv();

  log("run_started", {
    source: "api-first",
    headless: env.SCRAPER_HEADLESS,
    timeoutMs: env.SCRAPER_TIMEOUT_MS,
    maxProducts: env.SCRAPER_MAX_PRODUCTS
  });

  const sitemapXml = await fetchTextWithRetries(SITEMAP_URL);
  const discovered = Array.from(new Set(parseSitemapUrls(sitemapXml)));
  const targetUrls =
    env.SCRAPER_MAX_PRODUCTS != null ? discovered.slice(0, env.SCRAPER_MAX_PRODUCTS) : discovered;
  log("sitemap_loaded", { discovered: discovered.length, selected: targetUrls.length });

  let apiSuccess = 0;
  let apiSkipped = 0;
  let apiFailed = 0;

  type ApiResult =
    | { url: string; status: "success"; wine: ScrapedWine }
    | { url: string; status: "skipped"; wine: null }
    | { url: string; status: "failed"; wine: null };

  const apiResults = await processInPool<string, ApiResult>(targetUrls, API_CONCURRENCY, async (url) => {
    try {
      const mapped = await mapSingleProductFromApi(url);
      if (mapped) {
        apiSuccess += 1;
        return { url, status: "success", wine: mapped };
      }
      apiSkipped += 1;
      return { url, status: "skipped", wine: null };
    } catch {
      apiFailed += 1;
      return { url, status: "failed", wine: null };
    }
  });

  const apiWines = apiResults
    .filter((item): item is Extract<ApiResult, { status: "success" }> => item.status === "success")
    .map((item) => item.wine);
  log("api_fetched", { success: apiSuccess, skipped: apiSkipped, failed: apiFailed });

  const fallbackTargets = apiResults
    .filter((item): item is Extract<ApiResult, { status: "failed" }> => item.status === "failed")
    .map((item) => item.url);

  let fallbackSuccess = 0;
  let fallbackFailed = 0;
  const fallbackWines: ScrapedWine[] = [];

  if (options.useFallback !== false && fallbackTargets.length > 0) {
    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({ headless: env.SCRAPER_HEADLESS });
      const page = await browser.newPage();
      page.setDefaultTimeout(env.SCRAPER_TIMEOUT_MS);
      await page.goto("https://www.denner.ch/de/weinshop", { waitUntil: "domcontentloaded" });
      await acceptCookiesIfPresent(page);

      for (const url of fallbackTargets) {
        try {
          const wine = await scrapeSingleProductWithPlaywright(page, url);
          if (wine) {
            fallbackWines.push(wine);
            fallbackSuccess += 1;
          } else {
            fallbackFailed += 1;
          }
        } catch {
          fallbackFailed += 1;
        }
      }
      await page.close();
    } finally {
      if (browser) await browser.close();
    }
  }
  log("fallback_fetched", {
    targets: fallbackTargets.length,
    success: fallbackSuccess,
    failed: fallbackFailed
  });

  const merged = deduplicateByDennerProductId(deduplicateBySlug([...apiWines, ...fallbackWines]));
  log("products_valid", {
    valid: merged.length,
    api: apiWines.length,
    fallback: fallbackWines.length
  });

  if (merged.length === 0) {
    throw new Error("No valid wine records extracted from API and fallback.");
  }

  const result = await upsertWines(merged);
  log("db_upsert_completed", result);

  const historyResult = await insertWinePriceHistory(merged);
  log("history_insert_completed", historyResult);

  let ottosOffers: ScrapedOffer[] = [];
  let ottosFailed = 0;
  let ottosErrorMessage: string | null = null;
  try {
    const ottosResult = await fetchOttosOffers(env.SCRAPER_MAX_PRODUCTS);
    ottosOffers = ottosResult.offers;
    ottosFailed = ottosResult.failed;
    log("ottos_api_fetched", {
      selected: ottosResult.selected,
      failed: ottosResult.failed
    });
  } catch (error) {
    ottosErrorMessage = error instanceof Error ? error.message : "unknown_error";
    log("ottos_api_failed", { message: ottosErrorMessage });
  }

  const dennerOffers = merged.map(mapDennerWineToOffer);
  const allOffers = [...dennerOffers, ...ottosOffers];
  const offerUpsertResult = await upsertWineOffers(allOffers);
  const offerHistoryResult = await insertOfferPriceHistory(allOffers);
  log("offers_upsert_completed", offerUpsertResult);
  log("offer_history_insert_completed", offerHistoryResult);

  const finishedAt = new Date();
  log("run_finished", {
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    status: ottosErrorMessage ? "partial" : "ok"
  });

  try {
    await recordJobRun({
      jobName: "scrape_wines",
      status: ottosErrorMessage ? "failed" : "ok",
      startedAt,
      finishedAt,
      details: {
        discovered: discovered.length,
        selected: targetUrls.length,
        api_success: apiSuccess,
        api_skipped: apiSkipped,
        api_failed: apiFailed,
        fallback_success: fallbackSuccess,
        fallback_failed: fallbackFailed,
        upsert_written_count: result.writtenCount,
        history_inserted: historyResult.inserted,
        offers_written: offerUpsertResult.offers_written,
        offer_history_inserted: offerHistoryResult.inserted,
        ottos_api_success: ottosOffers.length,
        ottos_api_failed: ottosFailed,
        shop_errors: ottosErrorMessage ? [{ shop: "ottos", message: ottosErrorMessage }] : []
      }
    });
  } catch (error) {
    log("job_run_log_failed", {
      message: error instanceof Error ? error.message : "unknown_error"
    });
  }

  return {
    discovered: discovered.length,
    selected: targetUrls.length,
    api_success: apiSuccess,
    api_skipped: apiSkipped,
    api_failed: apiFailed,
    fallback_success: fallbackSuccess,
    fallback_failed: fallbackFailed,
    upsert_written_count: result.writtenCount,
    history_inserted: historyResult.inserted,
    offers_written: offerUpsertResult.offers_written,
    offer_history_inserted: offerHistoryResult.inserted,
    ottos_api_success: ottosOffers.length,
    ottos_api_failed: ottosFailed
  };
}

export async function runScrapeWines(
  options: RunScrapeWinesOptions = {}
): Promise<RunScrapeWinesResult> {
  if (options.loadLocalEnv) {
    loadLocalEnvForScripts();
  }

  const startedAt = new Date();

  try {
    return await run(startedAt, options);
  } catch (error) {
    const finishedAt = new Date();
    log("run_finished", {
      status: "failed",
      message: error instanceof Error ? error.message : "unknown_error"
    });
    try {
      await recordJobRun({
        jobName: "scrape_wines",
        status: "failed",
        startedAt,
        finishedAt,
        details: {
          message: error instanceof Error ? error.message : "unknown_error"
        }
      });
    } catch {
      // no-op
    }
    throw error;
  }
}

const isDirectExecution =
  process.argv[1] != null && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectExecution) {
  runScrapeWines({ loadLocalEnv: true, useFallback: true }).catch(() => {
    process.exit(1);
  });
}
