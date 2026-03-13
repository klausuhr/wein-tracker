import { z } from "zod";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1)
});

const serverEnvSchema = publicEnvSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  APP_BASE_URL: z
    .string()
    .optional()
    .transform((value) => value ?? "http://localhost:3000"),
  RESEND_API_KEY: z.string().optional(),
  TRACKING_TOKEN_SECRET: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  SCRAPER_MAX_PRODUCTS: z.string().optional(),
  SCRAPER_HEADLESS: z
    .string()
    .optional()
    .transform((value) => value ?? "true"),
  SCRAPER_TIMEOUT_MS: z
    .string()
    .optional()
    .transform((value) => value ?? "45000")
});

export function getPublicEnv() {
  return publicEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  });
}

export function getServerEnv() {
  const parsed = serverEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    APP_BASE_URL: process.env.APP_BASE_URL,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    TRACKING_TOKEN_SECRET: process.env.TRACKING_TOKEN_SECRET,
    CRON_SECRET: process.env.CRON_SECRET,
    SCRAPER_MAX_PRODUCTS: process.env.SCRAPER_MAX_PRODUCTS,
    SCRAPER_HEADLESS: process.env.SCRAPER_HEADLESS,
    SCRAPER_TIMEOUT_MS: process.env.SCRAPER_TIMEOUT_MS
  });

  return {
    ...parsed,
    SCRAPER_HEADLESS: parsed.SCRAPER_HEADLESS === "true",
    SCRAPER_TIMEOUT_MS: (() => {
      const value = Number(parsed.SCRAPER_TIMEOUT_MS);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("SCRAPER_TIMEOUT_MS must be a positive number.");
      }
      return value;
    })(),
    SCRAPER_MAX_PRODUCTS: (() => {
      if (!parsed.SCRAPER_MAX_PRODUCTS) return null;
      const value = Number(parsed.SCRAPER_MAX_PRODUCTS);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("SCRAPER_MAX_PRODUCTS must be a positive number when set.");
      }
      return Math.floor(value);
    })()
  };
}
