import { LIIGA_TEAM_LOGOS } from "./team-logos-liiga";
import { NHL_TEAM_LOGOS } from "./team-logos-nhl";

/**
 * Club logos, looked up PER COMPETITION so two leagues can never collide on a
 * team name (e.g. a future league with its own "Jokerit" or "Kings").
 *
 * The per-league maps are GENERATED — re-run the script instead of editing:
 *   Liiga → src/lib/team-logos-liiga.ts by scripts/copy-team-logos.mjs
 *   NHL   → src/lib/team-logos-nhl.ts   by scripts/copy-nhl-logos.mjs
 * Keys are team names exactly as stored in `matches.team1` / `matches.team2`.
 * `Flag` (src/components/flag.tsx) falls back to these when a team has no
 * country flag.
 */
export type TeamLogo = {
  light: string;
  /** Dark-background variant; without one, `light` sits on a near-white circle in dark mode. */
  dark?: string;
};

/** competitions.id → that league's team-name → logo map. */
const LOGOS_BY_COMPETITION: Record<string, Record<string, TeamLogo>> = {
  "liiga-2027": LIIGA_TEAM_LOGOS,
  "nhl-2027": NHL_TEAM_LOGOS,
};

export function teamLogo(competition: string, team: string): TeamLogo | undefined {
  return LOGOS_BY_COMPETITION[competition]?.[team];
}
