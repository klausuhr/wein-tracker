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
import type { ScrapedWine } from "../lib/supabase/types";
import { insertWinePriceHistory } from "../lib/wines/history";
import { upsertWines } from "../lib/wines/upsert";

const SITEMAP_URL = "https://www.denner.ch/sitemap.product.xml";
const PRODUCT_API_URL = "https://www.denner.ch/api/product";
const WINE_PATH_PATTERN = "/de/weinshop/";
const API_CONCURRENCY = 10;
const RETRIES = 2;

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

  const finishedAt = new Date();
  log("run_finished", { durationMs: finishedAt.getTime() - startedAt.getTime(), status: "ok" });

  try {
    await recordJobRun({
      jobName: "scrape_wines",
      status: "ok",
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
        history_inserted: historyResult.inserted
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
    history_inserted: historyResult.inserted
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
