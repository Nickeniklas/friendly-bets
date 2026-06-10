-- =============================================================================
-- Friendly Bets — Initial Schema
-- World Cup 2026 prediction game (family & friends, no real money)
--
-- How to run:
--   Option A (recommended): supabase db push  (requires Supabase CLI)
--   Option B: paste this file into the Supabase Dashboard → SQL editor
--
-- Dependency order:
--   1. profiles, matches, bets tables
--   2. bet-bettability check trigger (BEFORE INSERT on bets)
--   3. stake-deduction trigger       (AFTER INSERT on bets)
--   4. new-user profile trigger      (AFTER INSERT on auth.users)
--   5. settle_match RPC
--   6. accuracy VIEW
--   7. RLS policies
-- =============================================================================


-- =============================================================================
-- 1. TABLES
-- =============================================================================

-- profiles
-- One row per user. Hangs off auth.users (Supabase Auth owns passwords/emails).
-- points_balance is only ever mutated by:
--   (a) new-user trigger (sets 1000)
--   (b) bet-deduction trigger (subtracts stake)
--   (c) settle_match RPC (credits payout / refund)
-- Direct client writes are blocked by RLS.
CREATE TABLE IF NOT EXISTS public.profiles (
  id             uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name   text,
  points_balance int  NOT NULL DEFAULT 1000,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- matches
-- One row per game, upserted from openfootball (by the /api/sync route).
-- external_ref is the stable dedup key — build it as "{date}-{team1}-{team2}".
-- status flow: scheduled → closed → settled
--   scheduled = betting open
--   closed    = kickoff passed, result not yet confirmed (set by the sync job)
--   settled   = settle_match has run
CREATE TABLE IF NOT EXISTS public.matches (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  external_ref text        UNIQUE NOT NULL,
  team1        text        NOT NULL,
  team2        text        NOT NULL,
  kickoff_at   timestamptz NOT NULL,
  group_label  text,                         -- e.g. "Group A"; null for knockout rounds
  stage        text        NOT NULL,         -- group / r32 / r16 / qf / sf / final
  status       text        NOT NULL DEFAULT 'scheduled'
                           CHECK (status IN ('scheduled', 'closed', 'settled')),
  result       text        CHECK (result IN ('team1', 'team2', 'draw')),
  settled_at   timestamptz
);

-- bets
-- One row per bet. Stake is deducted immediately on insert (trigger below).
-- payout and outcome are null until settle_match runs.
-- pick is team1 or team2 — no 'draw' pick in v1.
CREATE TABLE IF NOT EXISTS public.bets (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  match_id   uuid        NOT NULL REFERENCES public.matches(id)  ON DELETE CASCADE,
  pick       text        NOT NULL CHECK (pick IN ('team1', 'team2')),
  stake      int         NOT NULL CHECK (stake > 0),
  payout     int,                            -- null until settled
  outcome    text        CHECK (outcome IN ('won', 'lost', 'refunded')),
  placed_at  timestamptz NOT NULL DEFAULT now(),
  -- Prevent duplicate bets: one bet per user per match
  UNIQUE (user_id, match_id)
);

-- Indexes to speed up the queries settlement and the leaderboard do most often
CREATE INDEX IF NOT EXISTS bets_match_id_idx  ON public.bets(match_id);
CREATE INDEX IF NOT EXISTS bets_user_id_idx   ON public.bets(user_id);
CREATE INDEX IF NOT EXISTS matches_status_idx ON public.matches(status);


-- =============================================================================
-- 2. TRIGGER — enforce bet window (BEFORE INSERT on bets)
--
-- The DB-level guard: a bet may only be placed while
--   match.status = 'scheduled'  AND  now() < kickoff_at
-- This runs BEFORE the row is written so the insert is aborted cleanly.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.check_bet_bettable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status     text;
  v_kickoff_at timestamptz;
BEGIN
  SELECT status, kickoff_at
    INTO v_status, v_kickoff_at
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

  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_bet_window
  BEFORE INSERT ON public.bets
  FOR EACH ROW
  EXECUTE FUNCTION public.check_bet_bettable();


-- =============================================================================
-- 3. TRIGGER — deduct stake on bet placement (AFTER INSERT on bets)
--
-- Uses an UPDATE … WHERE points_balance >= stake so the check and deduction
-- are one atomic operation. If the user doesn't have enough points, NOT FOUND
-- fires and the whole bet INSERT is rolled back.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.deduct_stake_on_bet()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.profiles
     SET points_balance = points_balance - NEW.stake
   WHERE id = NEW.user_id
     AND points_balance >= NEW.stake;  -- atomic balance check + deduction

  IF NOT FOUND THEN
    RAISE EXCEPTION 'insufficient points balance for user %', NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER deduct_stake
  AFTER INSERT ON public.bets
  FOR EACH ROW
  EXECUTE FUNCTION public.deduct_stake_on_bet();


-- =============================================================================
-- 4. TRIGGER — create profiles row for every new auth user
--
-- SECURITY DEFINER lets this trigger write through RLS.
-- SET search_path = public is a safety best practice (prevents search-path
-- hijacking — a Supabase-recommended hardening step).
-- display_name defaults to the part of the email before the @.
-- =============================================================================

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
    1000
  )
  ON CONFLICT (id) DO NOTHING;  -- idempotent in case of replay / duplicate events
  RETURN NEW;
END;
$$;

-- The trigger lives on auth.users, which is in the auth schema.
-- Supabase creates this schema and owns it; we're just adding a trigger to it.
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();


-- =============================================================================
-- 5. RPC — settle_match(p_match_id uuid)
--
-- SECURITY DEFINER: runs with the privileges of the defining role (postgres),
-- not the caller. This lets it update profiles.points_balance even though RLS
-- blocks direct client writes.
--
-- Idempotent: if status = 'settled', returns immediately. The sync job can
-- call this as many times as it likes on finished matches.
--
-- Atomic: everything runs in one implicit transaction. The FOR UPDATE lock on
-- the match row prevents two concurrent sync-job calls from racing.
--
-- Settlement algorithm (from SCHEMA.md):
--   pot = sum(all stakes); if pot < 300 → pot = 300 (house funds the gap)
--   draw OR no winning bets → push: refund every stake
--   otherwise → winners get ROUND(stake / winning_stake * pot); losers get 0
-- =============================================================================

CREATE OR REPLACE FUNCTION public.settle_match(p_match_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match         public.matches%ROWTYPE;
  v_pot           int;
  v_winning_pick  text;
  v_winning_stake int;
BEGIN
  -- Lock the match row. If two sync-job calls race, the second waits here
  -- and then hits the idempotent guard below — no double payment.
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
  -- result must be set and kickoff must be >3h in the past.
  -- The sync job should only call us when these hold, but we double-check.
  IF v_match.result IS NULL THEN
    RAISE EXCEPTION 'match % has no result yet', p_match_id;
  END IF;

  IF v_match.kickoff_at > now() - interval '3 hours' THEN
    RAISE EXCEPTION 'match % kickoff is less than 3h ago (kickoff_at = %)',
      p_match_id, v_match.kickoff_at;
  END IF;

  -- ── Compute pot (with seed-to-300 rule) ───────────────────────────────────
  SELECT COALESCE(SUM(stake), 0) INTO v_pot
    FROM public.bets
   WHERE match_id = p_match_id;

  IF v_pot < 300 THEN
    v_pot := 300;  -- house tops up thin pools so winners always share at least 300
  END IF;

  -- ── Draw handling (v1 = push) ─────────────────────────────────────────────
  -- A draw means nobody can have picked correctly (no 'draw' pick exists in v1),
  -- so we refund every bet — same path as the no-winner push below.
  IF v_match.result = 'draw' THEN
    -- Refund everyone
    UPDATE public.profiles AS p
       SET points_balance = points_balance + b.stake
      FROM public.bets AS b
     WHERE b.match_id = p_match_id
       AND b.user_id  = p.id;

    UPDATE public.bets
       SET payout  = stake,
           outcome = 'refunded'
     WHERE match_id = p_match_id;

    UPDATE public.matches
       SET status     = 'settled',
           settled_at = now()
     WHERE id = p_match_id;

    RETURN;
  END IF;

  -- ── Normal result (team1 or team2 wins) ───────────────────────────────────
  v_winning_pick := v_match.result;  -- 'team1' or 'team2'

  SELECT COALESCE(SUM(stake), 0) INTO v_winning_stake
    FROM public.bets
   WHERE match_id = p_match_id
     AND pick = v_winning_pick;

  IF v_winning_stake = 0 THEN
    -- ── Push: nobody picked the winner ──────────────────────────────────────
    UPDATE public.profiles AS p
       SET points_balance = points_balance + b.stake
      FROM public.bets AS b
     WHERE b.match_id = p_match_id
       AND b.user_id  = p.id;

    UPDATE public.bets
       SET payout  = stake,
           outcome = 'refunded'
     WHERE match_id = p_match_id;

  ELSE
    -- ── Proportional payout to winners ──────────────────────────────────────
    -- ROUND() gives whole points; rounding errors can leave 1–2 pts in the house.
    -- That's fine — the game is informal.
    UPDATE public.profiles AS p
       SET points_balance = points_balance
                          + ROUND(b.stake::numeric / v_winning_stake * v_pot)
      FROM public.bets AS b
     WHERE b.match_id = p_match_id
       AND b.pick     = v_winning_pick
       AND b.user_id  = p.id;

    UPDATE public.bets
       SET payout  = ROUND(stake::numeric / v_winning_stake * v_pot),
           outcome = 'won'
     WHERE match_id = p_match_id
       AND pick     = v_winning_pick;

    -- Losers: stake was already deducted at placement; just record the outcome.
    UPDATE public.bets
       SET payout  = 0,
           outcome = 'lost'
     WHERE match_id = p_match_id
       AND pick    <> v_winning_pick;

  END IF;

  -- ── Finalize match ────────────────────────────────────────────────────────
  UPDATE public.matches
     SET status     = 'settled',
         settled_at = now()
   WHERE id = p_match_id;

END;
$$;


-- =============================================================================
-- 6. VIEW — accuracy
--
-- Derived from bets + matches so it can never drift out of sync with the truth.
-- Only counts settled, non-refunded bets for correct/wrong/win_rate.
-- Streak = current consecutive-wins run, computed newest→oldest via a window
-- function (cumulative loss count; streak = rows where that count is still 0).
-- =============================================================================

CREATE OR REPLACE VIEW public.accuracy AS
WITH settled_bets AS (
  -- One row per settled (non-refunded) bet, with the cumulative loss count
  -- going from newest to oldest. While that count is 0 the user is on a streak.
  SELECT
    b.user_id,
    b.outcome,
    b.placed_at,
    SUM(CASE WHEN b.outcome = 'lost' THEN 1 ELSE 0 END)
      OVER (
        PARTITION BY b.user_id
        ORDER BY b.placed_at DESC          -- newest first
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS losses_from_newest
  FROM public.bets b
  WHERE b.outcome IN ('won', 'lost')       -- exclude refunded bets from accuracy stats
)
SELECT
  sb.user_id,
  p.display_name,
  COUNT(*)                                                  AS bets_placed,
  COUNT(*) FILTER (WHERE sb.outcome = 'won')               AS correct,
  COUNT(*) FILTER (WHERE sb.outcome = 'lost')              AS wrong,
  CASE
    WHEN COUNT(*) = 0 THEN 0::numeric
    ELSE ROUND(
      COUNT(*) FILTER (WHERE sb.outcome = 'won')::numeric
        / COUNT(*) * 100,
      1
    )
  END                                                       AS win_rate_pct,
  -- Streak: how many consecutive wins from the most recent settled bet
  COUNT(*) FILTER (WHERE sb.losses_from_newest = 0)        AS streak
FROM settled_bets sb
JOIN public.profiles p ON p.id = sb.user_id
GROUP BY sb.user_id, p.display_name;


-- =============================================================================
-- 7. RLS (Row-Level Security)
--
-- Supabase uses Postgres RLS. The "anon" role is unauthenticated visitors;
-- "authenticated" is a logged-in user. The service role bypasses RLS entirely
-- (used by the sync job and settle_match, which runs SECURITY DEFINER).
-- =============================================================================

-- ── profiles ─────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Anyone (including logged-out visitors) can read all profiles for the leaderboard.
CREATE POLICY "profiles: read all"
  ON public.profiles FOR SELECT
  USING (true);

-- No INSERT policy — the handle_new_user trigger (SECURITY DEFINER) creates rows.
-- No UPDATE / DELETE policies — balances only change via RPC / triggers.

-- ── matches ───────────────────────────────────────────────────────────────────
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

-- Anyone can read matches.
CREATE POLICY "matches: read all"
  ON public.matches FOR SELECT
  USING (true);

-- No INSERT / UPDATE / DELETE policies for normal users.
-- The sync job uses the service role, which bypasses RLS.

-- ── bets ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.bets ENABLE ROW LEVEL SECURITY;

-- Anyone can read all bets (lets users see the pool size and who bet what).
CREATE POLICY "bets: read all"
  ON public.bets FOR SELECT
  USING (true);

-- A logged-in user may only insert bets for themselves.
-- The match-bettability check is enforced by the trigger, not here.
-- (RLS policies are the right place for "who can do this"; triggers are the right
-- place for cross-table business-logic checks like "is this match still open".)
CREATE POLICY "bets: insert own"
  ON public.bets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- No UPDATE / DELETE policies — outcome/payout are set only by settle_match.
