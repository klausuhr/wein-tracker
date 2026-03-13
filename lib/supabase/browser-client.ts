"use client";

import { createClient } from "@supabase/supabase-js";
import { getPublicEnv } from "../env";

const env = getPublicEnv();

export function createBrowserSupabaseClient() {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
