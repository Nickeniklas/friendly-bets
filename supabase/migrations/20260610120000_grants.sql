-- =============================================================================
-- Baseline table grants for Supabase's built-in roles
--
-- Supabase exposes three Postgres roles via the API: `anon` (logged-out),
-- `authenticated` (logged-in users), and `service_role` (server-only —
-- used by /api/sync).
--
-- RLS policies (added in the initial migration) control row-level access,
-- but Postgres checks ordinary table GRANTs *first*, before RLS is even
-- evaluated. Without a GRANT, every query fails with
-- "permission denied for table ..." regardless of RLS policies — and
-- `service_role`'s BYPASSRLS attribute only skips RLS, not GRANT checks.
--
-- Supabase normally sets these up automatically for new tables, but that
-- didn't take effect here, so we grant explicitly.
-- =============================================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- profiles: everyone can read (leaderboard); writes only via the
-- handle_new_user trigger and settle_match RPC (both SECURITY DEFINER,
-- run as the function owner — but service_role still needs this for
-- completeness / future server-side use).
GRANT SELECT ON public.profiles TO anon, authenticated;
GRANT ALL ON public.profiles TO service_role;

-- matches: everyone can read; only the sync job (service_role) writes.
GRANT SELECT ON public.matches TO anon, authenticated;
GRANT ALL ON public.matches TO service_role;

-- bets: everyone can read (pool visibility); authenticated users can insert
-- their own (RLS restricts to auth.uid() = user_id); service_role does
-- everything (used by settlement bookkeeping).
GRANT SELECT ON public.bets TO anon, authenticated;
GRANT INSERT ON public.bets TO authenticated;
GRANT ALL ON public.bets TO service_role;

-- accuracy view: everyone can read.
GRANT SELECT ON public.accuracy TO anon, authenticated, service_role;
