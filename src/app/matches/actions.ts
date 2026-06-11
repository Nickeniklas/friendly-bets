"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Places a bet: insert a row into `bets`. The DB does the heavy lifting —
 * two triggers (see 20260609000000_initial_schema.sql) run on insert:
 *   - `enforce_bet_window` aborts if match.status != 'scheduled' or kickoff
 *     has passed
 *   - `deduct_stake_on_bet` atomically checks and deducts points_balance,
 *     aborting if the user can't afford the stake
 * The UNIQUE (user_id, match_id) constraint also blocks a second bet on the
 * same match. We just translate whatever error comes back into something
 * readable and redirect with it as a query param, mirroring the /login page.
 */
export async function placeBet(formData: FormData) {
  const matchId = formData.get("matchId") as string;
  const pick = formData.get("pick") as string;
  const stake = Number(formData.get("stake"));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  if ((pick !== "team1" && pick !== "team2") || !Number.isInteger(stake) || stake <= 0) {
    redirect(`/matches?error=${encodeURIComponent("Invalid bet")}`);
  }

  const { error } = await supabase.from("bets").insert({
    user_id: user.id,
    match_id: matchId,
    pick,
    stake,
  });

  if (error) {
    redirect(`/matches?error=${encodeURIComponent(friendlyBetError(error.message))}`);
  }

  redirect("/matches?message=Bet placed!");
}

function friendlyBetError(message: string): string {
  if (message.includes("insufficient points balance")) {
    return "You don't have enough points for that stake.";
  }
  if (message.includes("betting is closed")) {
    return "Betting is closed for this match.";
  }
  if (message.includes("duplicate key value")) {
    return "You've already placed a bet on this match.";
  }
  return message;
}
