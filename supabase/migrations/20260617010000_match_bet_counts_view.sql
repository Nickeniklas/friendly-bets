-- =============================================================================
-- match_bet_counts — crowd-split aggregation for /matches
--
-- /matches needs, per match, how many bets went to each outcome (for the
-- crowd-split display and the underdog-bonus hint). It used to fetch the ENTIRE
-- bets table and tally per-outcome counts in JS on every (public, uncached)
-- page load — O(all bets) transferred to every visitor. This view does the
-- COUNT ... FILTER aggregation in Postgres instead, returning one small row per
-- match.
--
-- Same exposure as the `accuracy` view: a plain (non-security_invoker) view
-- over `bets`, which is already publicly readable (see grants migration), so
-- logged-out visitors can read it too. Matches with no bets simply don't appear
-- — callers default missing matches to zero counts.
-- =============================================================================

CREATE OR REPLACE VIEW public.match_bet_counts AS
SELECT
  match_id,
  COUNT(*) FILTER (WHERE pick = 'team1')::int AS team1,
  COUNT(*) FILTER (WHERE pick = 'draw')::int  AS draw,
  COUNT(*) FILTER (WHERE pick = 'team2')::int AS team2
FROM public.bets
GROUP BY match_id;

GRANT SELECT ON public.match_bet_counts TO anon, authenticated, service_role;
