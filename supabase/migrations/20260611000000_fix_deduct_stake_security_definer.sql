-- =============================================================================
-- Fix: "permission denied for table profiles" when placing a bet
--
-- deduct_stake_on_bet() is an AFTER INSERT trigger on public.bets. Triggers
-- run as the role that performed the INSERT — for a logged-in user that's
-- `authenticated`, which only has GRANT SELECT on public.profiles (see
-- 20260610120000_grants.sql). Its UPDATE on profiles.points_balance was
-- therefore rejected at the GRANT-check layer (before RLS is even
-- evaluated), with "permission denied for table profiles".
--
-- Fix: make the function SECURITY DEFINER (like handle_new_user and
-- settle_match already are), so it runs with the privileges of the function
-- owner regardless of who triggered the insert. Users still can't update
-- profiles directly — there's no RLS UPDATE policy or GRANT for them; this
-- function is the only path, and it only ever adjusts points_balance.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.deduct_stake_on_bet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
