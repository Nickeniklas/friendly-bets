-- =============================================================================
-- Knockout "wins in 90 minutes" bet mode (PR2 — builds on
-- 20260630000000_full_time_result.sql).
--
-- On knockout matches a player can now make a riskier, more specific TEAM pick:
-- instead of "this team advances" (standard — wins via 90 min OR extra
-- time/penalties), they can predict "this team is winning at full time (90
-- min)". A correct full-time call earns a +5 bonus on top of the usual scoring:
--   * standard correct team/draw pick : +10  (+5 underdog)            = 10 / 15
--   * ft-winner correct team pick      : +10  +5 ft-bonus (+5 underdog) = 15 / 20
--   * any wrong pick                   : -5
-- An ft-winner pick wins ONLY if `pick = result_ft` (the team led at 90); it
-- LOSES if the team only won in extra time/penalties (result_ft = 'draw').
--
-- The mode is TEAM-PICKS-ONLY and KNOCKOUT-ONLY:
--   * draw stays standard — a draw is already a full-time concept, so a 90-min
--     variant would have the same win condition (free bonus, no extra risk);
--   * group-stage matches have no extra time, so "wins in 90" == "wins" there —
--     again a free bonus — so ft_winner is rejected on group matches.
-- =============================================================================


-- =============================================================================
-- 1. bets — add the ft_winner flag (team picks only)
-- =============================================================================

-- false = standard pick (advances / full-time, graded leniently);
-- true  = "wins in 90 minutes" — graded strictly on the full-time result, +5.
ALTER TABLE public.bets
  ADD COLUMN IF NOT EXISTS ft_winner boolean NOT NULL DEFAULT false;

-- ft_winner only makes sense for a team pick (a draw can't "win in 90").
ALTER TABLE public.bets
  DROP CONSTRAINT IF EXISTS bets_ft_winner_team_only;

ALTER TABLE public.bets
  ADD CONSTRAINT bets_ft_winner_team_only
    CHECK (ft_winner = false OR pick IN ('team1', 'team2'));


-- =============================================================================
-- 2. enforce_bet_window trigger — also reject ft_winner on group-stage matches
--
-- The "knockout-only" rule needs the match's stage, which lives in another
-- table, so it belongs in this cross-table trigger (a CHECK constraint can't see
-- matches.stage). Everything else about the bet window is unchanged.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.check_bet_bettable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status     text;
  v_kickoff_at timestamptz;
  v_stage      text;
BEGIN
  SELECT status, kickoff_at, stage
    INTO v_status, v_kickoff_at, v_stage
    FROM public.matches
   WHERE id = NEW.match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'match % does not exist', NEW.match_id;
  END IF;

  IF v_status <> 'scheduled' THEN
    RAISE EXCEPTION 'betting is closed: match status is %', v_status;
  END IF;

  IF now() >= v_kickoff_at THEN
    RAISE EXCEPTION 'betting is closed: kickoff has passed (kickoff_at = %)', v_kickoff_at;
  END IF;

  -- "Wins in 90" is a knockout-only mode (group matches have no extra time, so
  -- the +5 bonus would be free). Reject it on the group stage.
  IF NEW.ft_winner AND v_stage = 'group' THEN
    RAISE EXCEPTION 'ft_winner picks are not allowed on group-stage matches';
  END IF;

  RETURN NEW;
END;
$$;


-- =============================================================================
-- 3. settle_match — grade ft_winner picks strictly on the full-time result
--
-- Same structure as 20260630000000; the only change is the per-bet correctness
-- test and the +5 ft-bonus:
--   * standard  (ft_winner = false): correct if pick = result OR pick = result_ft
--   * ft-winner (ft_winner = true) : correct if pick = result_ft  (strict 90-min)
-- Points for a correct pick = 10 + (5 if the picked outcome is an underdog)
--                                + (5 if ft_winner). Wrong = -5.
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
  -- Per-outcome counts drive the per-outcome underdog bonus. The crowd split is
  -- by picked outcome regardless of mode, so ft_winner doesn't affect it.
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE pick = 'team1'),
    COUNT(*) FILTER (WHERE pick = 'draw'),
    COUNT(*) FILTER (WHERE pick = 'team2')
  INTO v_total, v_count_team1, v_count_draw, v_count_team2
  FROM public.bets
  WHERE match_id = p_match_id;

  -- ── Award points to each bet ──────────────────────────────────────────────
  -- Correctness depends on the bet's mode:
  --   ft_winner  -> strict: pick must match the full-time (90-min) result
  --   standard   -> lenient: pick matches the overall result OR the 90-min one
  UPDATE public.bets
     SET points_awarded = CASE
           WHEN (CASE WHEN ft_winner
                        THEN pick = v_match.result_ft
                        ELSE pick = v_match.result OR pick = v_match.result_ft
                 END)
           THEN 10
                + CASE
                    WHEN v_total > 0
                     AND (CASE pick
                            WHEN 'team1' THEN v_count_team1
                            WHEN 'draw'  THEN v_count_draw
                            WHEN 'team2' THEN v_count_team2
                          END)::numeric / v_total < 0.33
                    THEN 5 ELSE 0
                  END
                + CASE WHEN ft_winner THEN 5 ELSE 0 END
           ELSE -5
         END,
         outcome = CASE
           WHEN (CASE WHEN ft_winner
                        THEN pick = v_match.result_ft
                        ELSE pick = v_match.result OR pick = v_match.result_ft
                 END)
           THEN 'won'
           ELSE 'lost'
         END
   WHERE match_id = p_match_id;

  -- ── Apply each award to the player's running points total ──────────────────
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
