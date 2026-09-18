import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

/**
 * Competitions (a league/tournament season, e.g. the World Cup 2026 or the
 * Liiga 2026–27 regular season). Every match belongs to one; /matches,
 * /leaderboard and /stats show only the currently selected competition.
 *
 * Adding a new one (e.g. NHL) = insert a `competitions` row + write a feed
 * parser for /api/sync. The pages only read what's here, so they need no
 * changes. Sport-specific display (OT/SO labels, the sport icon) keys off
 * `sport`, never the competition id.
 */
export type Competition = {
  id: string;
  name: string;
  sport: string; // "football" | "hockey"
  is_active: boolean;
  sort_order: number;
};

/** Cookie holding the visitor's selected competition id. */
export const COMPETITION_COOKIE = "fb-competition";

/** Header/brand icon per sport. Unknown sports fall back to the football ball. */
export function sportIcon(sport: string): string {
  return sport === "hockey" ? "🏒" : "⚽";
}

/**
 * WC knockout stage codes (from mapStage() in src/lib/openfootball.ts) — the
 * only stages where the "wins in 90′" pick mode exists. Mirrored by the
 * allow-list in the enforce_bet_window trigger
 * (supabase/migrations/20260918120000_competitions.sql) — keep them in sync.
 */
export const KNOCKOUT_STAGES = ["r32", "r16", "qf", "sf", "third_place", "final"];

export function isKnockoutStage(stage: string): boolean {
  return KNOCKOUT_STAGES.includes(stage);
}

/**
 * All competitions (dropdown order) plus the one the visitor has selected.
 *
 * Server-only: reads the `fb-competition` cookie. An unknown/missing id falls
 * back to the first active competition by sort_order (or, if none is active,
 * the first one at all). Throws if the table is empty or unreadable — every
 * page that calls this needs a competition to filter by.
 */
export async function getSelectedCompetition(): Promise<{
  competition: Competition;
  competitions: Competition[];
}> {
  const supabase = await createClient();
  const cookieStore = await cookies();

  const { data, error } = await supabase
    .from("competitions")
    .select("id, name, sport, is_active, sort_order")
    .order("sort_order", { ascending: true });

  if (error) throw new Error(`Failed to load competitions: ${error.message}`);
  const competitions = (data ?? []) as Competition[];
  if (competitions.length === 0) throw new Error("No competitions configured");

  const wanted = cookieStore.get(COMPETITION_COOKIE)?.value;
  const competition =
    competitions.find((c) => c.id === wanted) ??
    competitions.find((c) => c.is_active) ??
    competitions[0];

  return { competition, competitions };
}
