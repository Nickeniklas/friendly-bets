-- =============================================================================
-- Match scores — store the actual goal counts for display on Past matches.
--
-- WHY
-- ---
-- Until now the matches table only recorded WHO won (result / result_ft =
-- team1/draw/team2), never the SCORE. The openfootball feed already carries the
-- goal counts (score.ft/et/p), but src/lib/openfootball.ts discarded them. The
-- /matches Past tab wants to show "2 – 1" (with an "(a.e.t.)" / "(4–2 pens)"
-- note for knockouts), so we persist the raw goals here.
--
-- These columns are DISPLAY-ONLY and are NEVER read by settle_match — grading
-- still keys solely off result / result_ft. That has two consequences the sync
-- job relies on (see src/app/api/sync/route.ts):
--   * They are written on EVERY sync, including for already-settled matches —
--     unlike result/result_ft they are deliberately NOT added to the sync
--     "freeze". A later feed correction to a score can't desync awarded points
--     (settlement never looked at them), so re-writing them is harmless.
--   * There is NO DB backfill: nothing in the DB holds historical scores. Every
--     already-settled match will show NULL scores until the next /api/sync
--     re-fetches the feed and upserts them (a normal cron tick, or "Run now").
--
-- Three tiers mirror the existing result / result_ft split (overall vs 90'):
--   * ft_*  = score after 90 minutes (always present once played).
--   * et_*  = score after extra time (knockouts that went to ET; else NULL).
--   * p_*   = penalty shoot-out score (knockouts decided on pens; else NULL).
--
-- This migration only ALTERs — it doesn't touch earlier migrations. The existing
-- "matches: read all" SELECT policy already covers new columns, and the sync job
-- writes via the service role, so no RLS/grant change is needed.
-- =============================================================================

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS ft_team1 smallint CHECK (ft_team1 >= 0),
  ADD COLUMN IF NOT EXISTS ft_team2 smallint CHECK (ft_team2 >= 0),
  ADD COLUMN IF NOT EXISTS et_team1 smallint CHECK (et_team1 >= 0),
  ADD COLUMN IF NOT EXISTS et_team2 smallint CHECK (et_team2 >= 0),
  ADD COLUMN IF NOT EXISTS p_team1  smallint CHECK (p_team1  >= 0),
  ADD COLUMN IF NOT EXISTS p_team2  smallint CHECK (p_team2  >= 0);
