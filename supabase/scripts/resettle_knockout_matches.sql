-- =============================================================================
-- ONE-OFF data fix — re-grade already-settled KNOCKOUT matches under the new
-- full-time-result scoring model (migration 20260630000000_full_time_result.sql).
--
-- WHY THIS IS NEEDED
-- ------------------
-- settle_match is idempotent: it skips matches whose status is already
-- 'settled', so simply deploying the new scoring logic does NOT re-grade matches
-- that were settled under the old rules. Any knockout that went to extra time /
-- penalties was settled with result_ft missing, so 'draw' picks on it were
-- wrongly marked as losses.
--
-- WHAT THIS DOES
-- --------------
-- For every already-settled knockout match it:
--   1. Reverses the points it awarded (subtracts each bet's points_awarded back
--      out of the player's running balance),
--   2. Clears each bet's points_awarded / outcome,
--   3. Flips the match back to 'scheduled' and clears result_ft.
-- It does NOT touch the group stage (there result_ft == result, so the new model
-- grades those matches identically — re-running would be a no-op churn).
--
-- AFTER RUNNING THIS
-- ------------------
-- Trigger /api/sync once (cron-job.org "Run now", or wait for the 5-minute
-- cron). The sync will:
--   * re-fetch the feed and repopulate result + result_ft for these matches
--     (they're no longer 'settled', so the freeze in route.ts doesn't apply),
--   * re-settle them via the new settle_match (the >3h-after-kickoff guard is
--     already satisfied for finished matches).
-- Until that sync runs these matches briefly show as "Awaiting result" and their
-- points are removed from the leaderboard — that's the expected transient.
--
-- SAFE TO RUN MORE THAN ONCE: each run re-reverses whatever is currently settled.
-- Wrapped in a transaction so a failure rolls the whole thing back.
-- =============================================================================

BEGIN;

-- The knockout stages (everything except the group stage). Matches list the
-- short stage codes from openfootball.ts `mapStage`.
-- 1. Reverse the awarded points from each player's balance.
UPDATE public.profiles AS p
   SET points_balance = points_balance - b.points_awarded
  FROM public.bets AS b
  JOIN public.matches AS m ON m.id = b.match_id
 WHERE b.user_id = p.id
   AND m.status = 'settled'
   AND m.stage IN ('r32', 'r16', 'qf', 'sf', 'third_place', 'final');

-- 2. Clear each affected bet's award so re-settlement starts clean.
UPDATE public.bets AS b
   SET points_awarded = 0,
       outcome        = NULL
  FROM public.matches AS m
 WHERE b.match_id = m.id
   AND m.status = 'settled'
   AND m.stage IN ('r32', 'r16', 'qf', 'sf', 'third_place', 'final');

-- 3. Un-settle the matches so the next /api/sync repopulates result_ft and
--    re-settles them. Clearing result_ft forces the freshly-synced value to win.
UPDATE public.matches
   SET status     = 'scheduled',
       settled_at = NULL,
       result_ft  = NULL
 WHERE status = 'settled'
   AND stage IN ('r32', 'r16', 'qf', 'sf', 'third_place', 'final');

COMMIT;
