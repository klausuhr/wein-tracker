import { createClient } from "@supabase/supabase-js";
import { getPublicEnv } from "../env";

export function createServerPublicClient() {
  const env = getPublicEnv();

  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
