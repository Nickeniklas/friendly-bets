-- =============================================================================
-- ONE-OFF data fix — re-grade already-settled Liiga games that went to
-- OVERTIME / SHOOTOUT under the new hockey grading (2026-10-16).
--
-- WHY THIS IS NEEDED
-- ------------------
-- Until 2026-10-16 the Liiga parser (src/lib/liiga.ts) set
-- result = result_ft = the 60-minute (regulation) result, so on a game tied
-- after 60 and won in OT/SO only 'draw' picks won — a pick on the team that
-- actually won was always marked wrong. The parser now sets result = the FINAL
-- winner (after OT/SO) and keeps result_ft = the regulation result, so
-- settle_match (unchanged) grades both the draw AND the final winner as
-- correct. But settle_match is idempotent: it skips matches already 'settled',
-- so deploying the new parser does NOT re-grade games settled under the old one.
--
-- WHAT THIS DOES
-- --------------
-- For every settled liiga-2027 game that went past regulation
-- (et_team1 IS NOT NULL — the parser sets et_* for OT and SO games only) it:
--   1. Reverses the points it awarded (subtracts each bet's points_awarded back
--      out of the player's running balance),
--   2. Clears each bet's points_awarded / outcome,
--   3. Flips the match back to 'closed' (unsettled; kickoff has passed, so
--      betting stays shut — 'closed' is the honest state, and nothing in the
--      app treats it differently from an unsettled 'scheduled' past match),
--      clears settled_at, and clears result / result_ft.
-- Regulation-time games are untouched (there result = result_ft, so the new
-- model grades them identically). No pre-existing ft_winner bets exist on
-- hockey (the trigger rejected them until 20261016000000_hockey_ft_winner.sql).
--
-- Clearing result (not just result_ft) is deliberate: /api/sync settles any
-- unsettled match with a non-NULL result. If the Liiga feed failed or timed out
-- on the next tick, a stale result = 'draw' would be re-settled under the old
-- grading. With result NULL the match just waits until the feed fills it in.
--
-- RUN ORDER (see CLAUDE.md): apply migration 20261016000000_hockey_ft_winner.sql
-- → deploy the new parser → run THIS script → trigger /api/sync. Running it
-- before the deploy would let the old parser write result = 'draw' back and
-- re-settle the same wrong way.
--
-- AFTER RUNNING THIS
-- ------------------
-- Trigger /api/sync once (cron-job.org "Run now", or wait for the 5-minute
-- cron). It re-fetches the feed, writes result (final winner) + result_ft
-- (regulation) for these games — they're no longer 'settled', so the result
-- freeze in route.ts doesn't apply — and re-settles them (the >3h guard is
-- long satisfied). Until then they show under Live as "Awaiting result" and
-- their points are missing from the leaderboard — the expected transient.
--
-- DRY RUN — paste this alone first to see what will be touched:
--
--   SELECT COUNT(DISTINCT m.id) AS matches,
--          COUNT(b.id)          AS bets,
--          COALESCE(SUM(b.points_awarded), 0) AS points_to_reverse
--     FROM public.matches AS m
--     LEFT JOIN public.bets AS b ON b.match_id = m.id
--    WHERE m.competition = 'liiga-2027'
--      AND m.status = 'settled'
--      AND m.et_team1 IS NOT NULL;
--
-- IDEMPOTENT: it only selects matches that are currently 'settled', so a second
-- run before the sync is a no-op; a run after the sync just un-settles and
-- re-settles them to the same result. Wrapped in a transaction so a failure
-- rolls the whole thing back.
-- =============================================================================

BEGIN;

-- 1. Reverse the awarded points from each player's balance. (UNIQUE
--    (user_id, match_id) → one bet per player per match, but a player can have
--    bets on several of these matches, so sum them per player first: an
--    UPDATE ... FROM with several matching rows only applies ONE of them.)
UPDATE public.profiles AS p
   SET points_balance = p.points_balance - r.total
  FROM (
    SELECT b.user_id, SUM(b.points_awarded) AS total
      FROM public.bets AS b
      JOIN public.matches AS m ON m.id = b.match_id
     WHERE m.competition = 'liiga-2027'
       AND m.status = 'settled'
       AND m.et_team1 IS NOT NULL
     GROUP BY b.user_id
  ) AS r
 WHERE r.user_id = p.id;

-- 2. Clear each affected bet's award so re-settlement starts clean.
UPDATE public.bets AS b
   SET points_awarded = 0,
       outcome        = NULL
  FROM public.matches AS m
 WHERE b.match_id = m.id
   AND m.competition = 'liiga-2027'
   AND m.status = 'settled'
   AND m.et_team1 IS NOT NULL;

-- 3. Un-settle the matches so the next /api/sync rewrites result / result_ft
--    from the feed and re-settles them.
UPDATE public.matches
   SET status     = 'closed',
       settled_at = NULL,
       result     = NULL,
       result_ft  = NULL
 WHERE competition = 'liiga-2027'
   AND status = 'settled'
   AND et_team1 IS NOT NULL;

COMMIT;
