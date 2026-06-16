"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type PlaceBetResult = {
  status: "success" | "error";
  message: string;
};

// The three pickable outcomes. team1 = home win, team2 = away win, draw = draw.
// (We keep the team1/team2 naming to match the matches table's columns and the
// openfootball result values; the UI labels them home/away.)
const VALID_PICKS = ["team1", "draw", "team2"] as const;

/**
 * Places a bet: insert a row into `bets`. There's no stake in the accuracy
 * model — a bet just records which outcome the player picked. The DB still
 * enforces the bet window via the `enforce_bet_window` trigger (aborts if the
 * match isn't 'scheduled' or kickoff has passed), and the UNIQUE
 * (user_id, match_id) constraint blocks a second bet on the same match.
 *
 * Called directly from match-card.tsx (not via a <form action>), so the result
 * can show as a toast and trigger a router.refresh() without a full page
 * navigation — the user stays right where they were.
 */
export async function placeBet(formData: FormData): Promise<PlaceBetResult> {
  const matchId = formData.get("matchId") as string;
  const pick = formData.get("pick") as string;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  if (!VALID_PICKS.includes(pick as (typeof VALID_PICKS)[number])) {
    return { status: "error", message: "Invalid bet" };
  }

  const { error } = await supabase.from("bets").insert({
    user_id: user.id,
    match_id: matchId,
    pick,
  });

  if (error) {
    return { status: "error", message: friendlyBetError(error.message) };
  }

  return { status: "success", message: "Bet placed!" };
}

function friendlyBetError(message: string): string {
  if (message.includes("betting is closed")) {
    return "Betting is closed for this match.";
  }
  if (message.includes("duplicate key value")) {
    return "You've already placed a bet on this match.";
  }
  return message;
}
