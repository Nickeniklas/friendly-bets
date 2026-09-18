-- =============================================================================
-- Make the public views security_invoker
--
-- The Supabase Security Advisor flagged `accuracy` and `match_bet_counts` as
-- CRITICAL "Security Definer View": by default a Postgres view runs with its
-- OWNER's permissions, so RLS on the underlying tables is bypassed for whoever
-- queries the view. With security_invoker = on, the view instead checks the
-- CALLER's grants + RLS policies, like a direct table query would.
--
-- Nothing actually leaked here: both views only read `bets` and `profiles`,
-- which anon/authenticated already have SELECT grants on (20260610120000_grants.sql)
-- plus "read all" USING (true) RLS policies (initial schema). So guests still
-- see the same rows through the views after this change.
--
-- Any future view should be created WITH (security_invoker = on). Note that a
-- later CREATE OR REPLACE VIEW without that option can drop the setting.
-- =============================================================================

ALTER VIEW public.accuracy         SET (security_invoker = on);
ALTER VIEW public.match_bet_counts SET (security_invoker = on);
