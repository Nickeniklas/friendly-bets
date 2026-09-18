-- =============================================================================
-- Multi-competition support: add the Liiga 2026-27 regular season alongside
-- the (finished) World Cup 2026.
--
-- 1. New `competitions` table (one row per league/season), seeded with the WC
--    and Liiga. The app picks which one to show from a cookie, falling back to
--    the first is_active competition by sort_order (src/lib/competitions.ts).
-- 2. matches.competition — every match belongs to one competition. Existing
--    rows are all World Cup, so the column is added with DEFAULT 'wc2026' to
--    backfill them, then the default is dropped so every future insert (the
--    sync job) must say which competition it belongs to.
-- 3. check_bet_bettable (enforce_bet_window trigger) — the "wins in 90′" mode
--    (bets.ft_winner) used to be rejected only on stage = 'group'. Liiga
--    matches use stage = 'regular', which that check would have let through
--    (free +5, since hockey is graded on the 60-min result anyway). It's now an
--    allow-list: ft_winner is only allowed on the World Cup knockout stages.
--
-- settle_match is unchanged: the Liiga parser sets result = result_ft = the
-- 60-minute (regulation) outcome, so the existing grading just works.
-- =============================================================================


-- =============================================================================
-- 1. competitions
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.competitions (
  id         text    PRIMARY KEY,           -- e.g. 'wc2026', 'liiga-2027'
  name       text    NOT NULL,              -- display name, e.g. 'Liiga 2026–27'
  sport      text    NOT NULL,              -- 'football' | 'hockey' — drives sport-specific display
  is_active  boolean NOT NULL DEFAULT false, -- currently running (default selection + 14-day match window)
  sort_order int     NOT NULL DEFAULT 0      -- dropdown order, lowest first
);

INSERT INTO public.competitions (id, name, sport, is_active, sort_order) VALUES
  ('wc2026',     'World Cup 2026', 'football', false, 2),
  ('liiga-2027', 'Liiga 2026–27',  'hockey',   true,  1)
ON CONFLICT (id) DO NOTHING;

-- Same access model as `matches`: everyone reads, only service_role writes.
ALTER TABLE public.competitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "competitions: read all" ON public.competitions;
CREATE POLICY "competitions: read all"
  ON public.competitions FOR SELECT
  USING (true);

-- Baseline GRANTs are checked before RLS (see 20260610120000_grants.sql).
GRANT SELECT ON public.competitions TO anon, authenticated;
GRANT ALL    ON public.competitions TO service_role;


-- =============================================================================
-- 2. matches.competition
-- =============================================================================

-- The DEFAULT backfills every existing (World Cup) row in one step.
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS competition text NOT NULL DEFAULT 'wc2026'
    REFERENCES public.competitions (id);

-- Drop it afterwards so a sync that forgets to set the competition fails loudly
-- instead of silently filing matches under the World Cup.
ALTER TABLE public.matches ALTER COLUMN competition DROP DEFAULT;

-- Every page filters matches by competition and orders/windows by kickoff.
CREATE INDEX IF NOT EXISTS matches_competition_kickoff_idx
  ON public.matches (competition, kickoff_at);


-- =============================================================================
-- 3. enforce_bet_window — ft_winner only on WC knockout stages
--
-- Identical to 20260701000000_ft_winner_pick.sql except the ft_winner check,
-- which is now an allow-list of knockout stage codes (see mapStage() in
-- src/lib/openfootball.ts and KNOCKOUT_STAGES in src/lib/competitions.ts —
-- keep them in sync).
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

  -- "Wins in 90" is a knockout-only mode: anywhere without extra time (WC group
  -- stage, Liiga regular season, ...) the +5 bonus would be free.
  IF NEW.ft_winner
     AND v_stage NOT IN ('r32', 'r16', 'qf', 'sf', 'third_place', 'final') THEN
    RAISE EXCEPTION 'ft_winner picks are not allowed on non-knockout matches (stage = %)', v_stage;
  END IF;

  RETURN NEW;
END;
$$;
