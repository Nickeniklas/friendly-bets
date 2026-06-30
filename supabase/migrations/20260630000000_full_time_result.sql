-- =============================================================================
-- Knockout scoring fix — grade picks against BOTH the full-time (90-minute)
-- result and the overall advancer.
--
-- THE BUG THIS FIXES
-- ------------------
-- openfootball resolves a knockout tie by penalties > extra time > full time,
-- so a match that was level after 90 minutes is stored with result = the team
-- that eventually advanced (team1/team2) — never 'draw'. settle_match graded a
-- pick as correct only when `pick = result`, so a player who picked 'draw' on a
-- knockout that went to extra time / penalties ALWAYS lost, even though the
-- match really was a draw at full time. In the Round of 32 a player picked draw,
-- the game went to overtime, and they were (wrongly) marked wrong.
--
-- THE NEW MODEL ("Option B")
-- --------------------------
-- We now track the full-time (90-minute) result separately, in the new
-- matches.result_ft column:
--   * result    = the overall outcome / who advanced (penalties > et > ft).
--                 For knockouts this is always team1/team2; for the group stage
--                 it equals the full-time result.
--   * result_ft = the result after 90 minutes only (team1/draw/team2). For the
--                 group stage this equals `result`; for a knockout decided in
--                 extra time / penalties it is 'draw'.
--
-- A pick now WINS if it matches EITHER value:
--   pick = result  OR  pick = result_ft
-- so on a knockout that was 1-1 after 90 and won by team1 on penalties:
--   * 'draw'  wins  (matches result_ft)
--   * 'team1' wins  (matches result — they advanced)
--   * 'team2' loses
-- For the group stage result_ft = result, so this reduces to the old behavior
-- (no change to any already-settled group match).
--
-- UNDERDOG BONUS — now per-outcome
-- --------------------------------
-- Because two outcomes can now win the same match, the underdog bonus is
-- computed per *picked outcome* instead of once per match: a correct pick earns
-- the +5 bonus if the outcome it picked drew fewer than 33% of all the bets on
-- the match. For a match with a single winning outcome this is identical to the
-- old "result outcome share < 33%" rule.
--
-- This migration only ALTERs/REPLACEs — it doesn't touch earlier migrations.
-- =============================================================================


-- =============================================================================
-- 1. matches — add the full-time (90-minute) result column
-- =============================================================================

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS result_ft text
    CHECK (result_ft IN ('team1', 'draw', 'team2'));

-- Backfill: for every match that already has a result, default result_ft to it.
-- This is exactly correct for the group stage (no extra time, so the full-time
-- result IS the result). For knockout matches already settled under the old
-- model it is only approximate (it can't recover a 90-minute draw from a stored
-- advancer), so those are re-graded by the companion one-off script
-- supabase/scripts/resettle_knockout_matches.sql, which un-settles them and lets
-- the next /api/sync repopulate result_ft from the feed and re-settle them.
UPDATE public.matches
   SET result_ft = result
 WHERE result IS NOT NULL
   AND result_ft IS NULL;


-- =============================================================================
-- 2. settle_match — grade against (result OR result_ft), per-outcome underdog
--
-- Still SECURITY DEFINER, still idempotent (returns if already settled), still
-- atomic (FOR UPDATE locks the match row against racing sync calls).
--
-- result_ft may be NULL for a match that predates this column and hasn't been
-- re-synced yet; `pick = NULL` is NULL (falsy), so such a match simply grades on
-- `result` alone — i.e. exactly the old behavior until the feed refreshes it.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.settle_match(p_match_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match       public.matches%ROWTYPE;
  v_total       int;
  v_count_team1 int;
  v_count_draw  int;
  v_count_team2 int;
BEGIN
  -- Lock the match row. If two sync-job calls race, the second waits here and
  -- then hits the idempotent guard below — no double award.
  SELECT * INTO v_match
    FROM public.matches
   WHERE id = p_match_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'match % not found', p_match_id;
  END IF;

  -- ── Idempotent guard ──────────────────────────────────────────────────────
  IF v_match.status = 'settled' THEN
    RETURN;  -- already done; nothing to do
  END IF;

  -- ── Pre-conditions ────────────────────────────────────────────────────────
  IF v_match.result IS NULL THEN
    RAISE EXCEPTION 'match % has no result yet', p_match_id;
  END IF;

  IF v_match.kickoff_at > now() - interval '3 hours' THEN
    RAISE EXCEPTION 'match % kickoff is less than 3h ago (kickoff_at = %)',
      p_match_id, v_match.kickoff_at;
  END IF;

  -- ── Bet distribution ──────────────────────────────────────────────────────
  -- Per-outcome counts drive the per-outcome underdog bonus (an outcome that
  -- drew fewer than 33% of all bets on the match is an underdog).
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE pick = 'team1'),
    COUNT(*) FILTER (WHERE pick = 'draw'),
    COUNT(*) FILTER (WHERE pick = 'team2')
  INTO v_total, v_count_team1, v_count_draw, v_count_team2
  FROM public.bets
  WHERE match_id = p_match_id;

  -- ── Award points to each bet ──────────────────────────────────────────────
  -- Correct (pick matches the full-time result OR the overall advancer): +10,
  -- plus +5 if the picked outcome is an underdog (its own share < 33%).
  -- Wrong: -5.
  UPDATE public.bets
     SET points_awarded = CASE
           WHEN pick = v_match.result OR pick = v_match.result_ft THEN
             CASE
               WHEN v_total > 0
                AND (CASE pick
                       WHEN 'team1' THEN v_count_team1
                       WHEN 'draw'  THEN v_count_draw
                       WHEN 'team2' THEN v_count_team2
                     END)::numeric / v_total < 0.33
               THEN 15
               ELSE 10
             END
           ELSE -5
         END,
         outcome = CASE
           WHEN pick = v_match.result OR pick = v_match.result_ft THEN 'won'
           ELSE 'lost'
         END
   WHERE match_id = p_match_id;

  -- ── Apply each award to the player's running points total ──────────────────
  -- UNIQUE (user_id, match_id) guarantees at most one bet per user per match,
  -- so this join adds exactly one bet's award per player.
  UPDATE public.profiles AS p
     SET points_balance = points_balance + b.points_awarded
    FROM public.bets AS b
   WHERE b.match_id = p_match_id
     AND b.user_id  = p.id;

  -- ── Finalize match ────────────────────────────────────────────────────────
  UPDATE public.matches
     SET status     = 'settled',
         settled_at = now()
   WHERE id = p_match_id;

END;
$$;
