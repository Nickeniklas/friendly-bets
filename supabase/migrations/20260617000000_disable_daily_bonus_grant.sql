-- =============================================================================
-- Disable (not drop) the daily-bonus RPC at the permission layer.
--
-- The daily login bonus was removed from the app on 2026-06-16 (all frontend
-- wiring deleted — see CLAUDE.md), but the claim_daily_bonus() function was
-- left in the DB "dormant". It is SECURITY DEFINER and directly UPDATEs
-- profiles.points_balance, and migration 20260613000000 GRANTed EXECUTE on it
-- to `authenticated`. That grant was never revoked, so any logged-in user
-- could still call supabase.rpc('claim_daily_bonus') directly from the browser
-- and award themselves 100-400 points once per UTC day.
--
-- This violates the core invariant (CLAUDE.md): "Balances never change via
-- direct client writes — only via the settlement RPC." This migration closes
-- that hole by revoking EXECUTE so no client role can invoke it.
--
-- We DROP nothing: the function (and the profiles.last_bonus_date /
-- streak_count columns) are kept so the feature can be re-enabled later by
-- restoring the grant + the toast/action wiring. After this migration the only
-- role that can still call it is a superuser / the function's owner (e.g. via
-- the SQL editor) — never a normal app client.
--
-- Note: Postgres grants EXECUTE to PUBLIC by default on CREATE FUNCTION, so we
-- must revoke from PUBLIC as well — revoking only `authenticated` would leave
-- the function callable through the default PUBLIC grant. We also cover `anon`
-- explicitly for clarity.
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.claim_daily_bonus() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_daily_bonus() FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_daily_bonus() FROM PUBLIC;
