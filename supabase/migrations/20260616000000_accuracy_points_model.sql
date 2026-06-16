-- =============================================================================
-- Move from the parimutuel staking model to a pure accuracy / points model.
--
-- Before this migration the game was a betting pool: players staked points on a
-- side, the stake was deducted immediately, and at settlement winners split the
-- pool proportional to their stake (with a seed-to-300 rule and refund-on-push).
--
-- The new model is much simpler and is about prediction *skill*, not wagering:
--   - A bet just PICKS one of three outcomes — team1 (home win), draw, or
--     team2 (away win). No stake, no pool, no multipliers.
--   - At settlement each bet earns/loses a fixed number of points:
--       * correct pick                          -> +10
--       * correct pick of an "underdog" outcome -> +15  (10 + 5 bonus)
--         where "underdog" = that outcome got fewer than 33% of all the
--         bets placed on the match (a crowd-based bonus for going against
--         the grain and being right)
--       * wrong pick                            -> -5
--   - Each bet's award is recorded in bets.points_awarded and added to the
--     player's running points total (profiles.points_balance, which now starts
--     at 0 and may go negative — that's intended).
--
-- Draw is now a first-class, pickable outcome: it can be picked, it can win,
-- and it counts toward the bet-distribution math for the underdog bonus. All
-- prior push / refund-on-draw / refund-on-no-winner logic is removed.
--
-- Nothing in this file edits earlier migrations — it only ALTERs/REPLACEs.
-- =============================================================================


-- =============================================================================
-- 1. profiles — points now start at 0 (a running +/- total), not 1000
-- =============================================================================

-- New signups should start at 0.
ALTER TABLE public.profiles
  ALTER COLUMN points_balance SET DEFAULT 0;

-- Reset every existing player to 0. The old balances were denominated in the
-- staking model (everyone started at 1000, stakes moved around a pool) and are
-- meaningless under the new points model, so we zero them out for a clean start.
-- (This wipes balances — see the migration's manual-steps note.)
UPDATE public.profiles
   SET points_balance = 0;

-- Keep the new-user trigger in sync: hand out 0 points instead of 1000.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, points_balance)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'display_name',
      split_part(NEW.email, '@', 1)   -- fallback: "alice" from "alice@example.com"
    ),
    0                                 -- running points total starts at 0
  )
  ON CONFLICT (id) DO NOTHING;  -- idempotent in case of replay / duplicate events
  RETURN NEW;
END;
$$;


-- =============================================================================
-- 2. bets — drop stake mechanics, add points_awarded, allow 'draw' as a pick
-- =============================================================================

-- stake is no longer used. We keep the column (so historical rows and any
-- external readers don't break) but make it nullable and drop the "> 0" check
-- so new bets can be inserted without a stake.
ALTER TABLE public.bets
  ALTER COLUMN stake DROP NOT NULL;

ALTER TABLE public.bets
  DROP CONSTRAINT IF EXISTS bets_stake_check;   -- the inline CHECK (stake > 0)

-- Record what each bet earned at settlement (can be negative). Defaults to 0
-- so an un-settled bet reads as "nothing awarded yet".
ALTER TABLE public.bets
  ADD COLUMN IF NOT EXISTS points_awarded int NOT NULL DEFAULT 0;

-- Allow 'draw' as a third pick (was team1 / team2 only). Drop the old inline
-- check and re-add it with the third value.
ALTER TABLE public.bets
  DROP CONSTRAINT IF EXISTS bets_pick_check;

ALTER TABLE public.bets
  ADD CONSTRAINT bets_pick_check CHECK (pick IN ('team1', 'draw', 'team2'));

-- Note: the outcome CHECK is left as-is. settle_match now only ever writes
-- 'won' / 'lost' (no more 'refunded'), but leaving 'refunded' in the allowed
-- set keeps any pre-existing refunded rows valid.


-- =============================================================================
-- 3. Drop the stake-deduction trigger — no deduction on bet placement anymore
--
-- The bet-window trigger (enforce_bet_window / check_bet_bettable) STAYS — a
-- bet may still only be placed while the match is scheduled and before kickoff.
-- Only the stake deduction / balance-check trigger goes away.
-- =============================================================================

DROP TRIGGER IF EXISTS deduct_stake ON public.bets;
DROP FUNCTION IF EXISTS public.deduct_stake_on_bet();


-- =============================================================================
-- 4. settle_match(p_match_id uuid) — rewritten for the points model
--
-- Still SECURITY DEFINER (it writes profiles.points_balance, which RLS blocks
-- for normal callers), still idempotent (returns immediately if already
-- settled), still atomic (one transaction; FOR UPDATE locks the match row so
-- two concurrent sync-job calls can't double-award).
--
-- Algorithm:
--   1. Count all bets on the match (v_total) and how many picked the actual
--      result (v_result_count).
--   2. The result outcome is an "underdog" if it received fewer than 33% of
--      all bets — i.e. v_result_count / v_total < 0.33. A correct pick of an
--      underdog outcome gets the +5 bonus. (Only correct picks can earn the
--      bonus, and a correct pick's outcome is by definition the result, so the
--      whole match shares one underdog determination.)
--   3. Award each bet: +10 (or +15 if underdog) for a correct pick, -5 for a
--      wrong one; record it in points_awarded and set outcome won/lost.
--   4. Add each bet's points_awarded to its player's running total.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.settle_match(p_match_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match        public.matches%ROWTYPE;
  v_total        int;
  v_result_count int;
  v_underdog     boolean;
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
  -- result must be set and kickoff must be >3h in the past. The sync job should
  -- only call us when these hold, but we double-check.
  IF v_match.result IS NULL THEN
    RAISE EXCEPTION 'match % has no result yet', p_match_id;
  END IF;

  IF v_match.kickoff_at > now() - interval '3 hours' THEN
    RAISE EXCEPTION 'match % kickoff is less than 3h ago (kickoff_at = %)',
      p_match_id, v_match.kickoff_at;
  END IF;

  -- ── Bet distribution ──────────────────────────────────────────────────────
  -- v_total       = every bet on the match (across all three outcomes)
  -- v_result_count = bets that picked the actual result
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE pick = v_match.result)
  INTO v_total, v_result_count
  FROM public.bets
  WHERE match_id = p_match_id;

  -- An outcome is an "underdog" if it drew fewer than 33% of all bets. With no
  -- bets at all there's nothing to settle besides flipping the status.
  v_underdog := v_total > 0
                AND v_result_count::numeric / v_total < 0.33;

  -- ── Award points to each bet ──────────────────────────────────────────────
  -- Correct pick: +10, plus +5 if the result was an underdog outcome.
  -- Wrong pick:  -5.
  UPDATE public.bets
     SET points_awarded = CASE
                            WHEN pick = v_match.result
                              THEN CASE WHEN v_underdog THEN 15 ELSE 10 END
                            ELSE -5
                          END,
         outcome        = CASE
                            WHEN pick = v_match.result THEN 'won'
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


-- =============================================================================
-- 5. accuracy view — no change needed
--
-- The view never referenced stake/pool fields; it counts settled bets by
-- outcome ('won' / 'lost'). "Correct" (outcome = 'won') now naturally includes
-- correctly-picked draws, since a draw is a real winning outcome. Refunds no
-- longer occur, so the 'refunded' exclusion is simply a no-op going forward.
-- Left intact from 20260609000000_initial_schema.sql.
-- =============================================================================
