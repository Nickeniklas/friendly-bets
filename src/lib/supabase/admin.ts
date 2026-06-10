import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client using the service-role key.
 *
 * This bypasses Row Level Security entirely, so it must NEVER be imported
 * from a Client Component or any code that could end up in the browser
 * bundle. It's for trusted server-side jobs only (e.g. /api/sync), which is
 * also why it's the only thing allowed to write to `matches` and call
 * `settle_match`.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      // Service-role client doesn't need a user session.
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
