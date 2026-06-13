-- =============================================================================
-- Daily login bonus with streak multiplier
--
-- Adds two columns to profiles and a claim_daily_bonus() RPC, called once on
-- app mount via a Server Action (see src/app/actions.ts and
-- src/components/daily-bonus-toast.tsx). Rewards users for visiting on
-- consecutive days, capped at a 7-day streak / 400-point bonus.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. COLUMNS
--
-- last_bonus_date: the UTC calendar date the user last claimed a bonus.
--   NULL = never claimed yet (existing rows + brand-new signups).
-- streak_count: consecutive days claimed so far (capped at 7 — see the RPC).
--   Defaults to 0; handle_new_user doesn't set it.
-- -----------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_bonus_date date,
  ADD COLUMN IF NOT EXISTS streak_count int NOT NULL DEFAULT 0;


-- -----------------------------------------------------------------------------
-- 2. RPC — claim_daily_bonus()
--
-- Called once per app load (client useEffect -> Server Action -> this RPC).
-- No arguments — operates on auth.uid(), the calling user's own row only.
--
-- SECURITY DEFINER + SET search_path = public: same pattern as
-- deduct_stake_on_bet / settle_match — `authenticated` only has SELECT on
-- profiles (see 20260610120000_grants.sql), so a non-definer UPDATE would
-- fail with "permission denied for table profiles".
--
-- Concurrency safety: a SINGLE atomic UPDATE ... WHERE <not claimed today>
-- ... RETURNING — NOT a SELECT-then-UPDATE. The WHERE guard means only the
-- first of two concurrent calls (e.g. two tabs) can match the row; the
-- second sees 0 rows updated (NOT FOUND) and returns 0.
--
-- Streak logic:
--   - last_bonus_date = today       -> already claimed; return 0 (no-op)
--   - last_bonus_date = today - 1   -> consecutive day; streak += 1 (cap 7)
--   - otherwise (NULL, or gap > 1)  -> streak broken / first-ever claim;
--                                      reset streak to 1
--
-- Bonus formula: 100 + (streak_count - 1) * 50, capped at 400.
--   day 1=100, day 2=150, day 3=200, ... day 7=400, day 8+ stays 400.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_daily_bonus()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_streak int;
  v_bonus      int;
BEGIN
  -- Atomic claim: only matches a row if not already claimed today. CASE
  -- computes the new streak in the same statement that checks it, so
  -- there's no separate read step that could race. RETURNING captures the
  -- NEW streak_count (the value just written by SET above).
  UPDATE public.profiles
     SET streak_count = CASE
                           WHEN last_bonus_date = CURRENT_DATE - 1
                             THEN LEAST(streak_count + 1, 7)
                           ELSE 1
                         END,
         last_bonus_date = CURRENT_DATE
   WHERE id = auth.uid()
     AND (last_bonus_date IS NULL OR last_bonus_date < CURRENT_DATE)
  RETURNING streak_count INTO v_new_streak;

  IF NOT FOUND THEN
    RETURN 0; -- already claimed today (or no matching profile row)
  END IF;

  -- 100 / 150 / 200 / 250 / 300 / 350 / 400, flat at 400 for day 8+
  -- (v_new_streak is capped at 7 above, so this naturally tops out at 400).
  v_bonus := LEAST(100 + (v_new_streak - 1) * 50, 400);

  UPDATE public.profiles
     SET points_balance = points_balance + v_bonus
   WHERE id = auth.uid();

  RETURN v_bonus;
END;
$$;


-- -----------------------------------------------------------------------------
-- 3. GRANT
-- -----------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.claim_daily_bonus() TO authenticated;
