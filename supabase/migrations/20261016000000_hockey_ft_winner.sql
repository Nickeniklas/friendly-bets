-- =============================================================================
-- Hockey "Win in 60′" pick mode — allow bets.ft_winner on hockey matches.
--
-- Liiga now uses the World Cup knockout grading model (src/lib/liiga.ts):
--   * result    = the final winner, after overtime / the shootout;
--   * result_ft = the 60-minute (regulation) result ('draw' if tied after 60).
-- settle_match is unchanged: a standard pick wins on `pick = result OR
-- pick = result_ft`, an ft_winner pick only on `pick = result_ft` (+5). Since a
-- hockey game can now be won after regulation, "this team wins in 60 minutes"
-- is a real, riskier call — so the strict mode is offered on hockey too.
--
-- check_bet_bettable (enforce_bet_window trigger) is identical to
-- 20260918120000_competitions.sql except the ft_winner check, which now also
-- allows the mode when the match's competition has sport = 'hockey'. The
-- stage allow-list is mirrored by KNOCKOUT_STAGES / strictModeAvailable() in
-- src/lib/competitions.ts — keep them in sync. The team-picks-only CHECK
-- (bets_ft_winner_team_only) is untouched.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.check_bet_bettable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status     text;
  v_kickoff_at timestamptz;
  v_stage      text;
  v_sport      text;
BEGIN
  SELECT m.status, m.kickoff_at, m.stage, c.sport
    INTO v_status, v_kickoff_at, v_stage, v_sport
    FROM public.matches AS m
    JOIN public.competitions AS c ON c.id = m.competition
   WHERE m.id = NEW.match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'match % does not exist', NEW.match_id;
  END IF;

  IF v_status <> 'scheduled' THEN
    RAISE EXCEPTION 'betting is closed: match status is %', v_status;
  END IF;

  IF now() >= v_kickoff_at THEN
    RAISE EXCEPTION 'betting is closed: kickoff has passed (kickoff_at = %)', v_kickoff_at;
  END IF;

  -- The strict "win in regulation" mode needs a way to win after regulation,
  -- or its +5 bonus is free: WC knockouts (extra time / penalties) and hockey
  -- (overtime / shootout). The WC group stage has neither.
  IF NEW.ft_winner
     AND v_sport <> 'hockey'
     AND v_stage NOT IN ('r32', 'r16', 'qf', 'sf', 'third_place', 'final') THEN
    RAISE EXCEPTION 'ft_winner picks are not allowed on non-knockout matches (stage = %)', v_stage;
  END IF;

  RETURN NEW;
END;
$$;
