"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Claims today's login-streak bonus for the current user, if not already
 * claimed. Returns the points awarded (0 if not logged in, already claimed
 * today, or on error) — see claim_daily_bonus() in
 * supabase/migrations/20260613000000_daily_bonus.sql for the streak/cap
 * logic. Safe to call on every app load: the RPC is idempotent per UTC day.
 */
export async function claimDailyBonus(): Promise<number> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return 0;

  const { data, error } = await supabase.rpc("claim_daily_bonus");
  if (error || typeof data !== "number") return 0;

  return data;
}
