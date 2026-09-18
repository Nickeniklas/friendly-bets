/**
 * Fetch + parse the Liiga (Finnish ice hockey) regular-season schedule/results.
 * Source: liiga.fi's own public site API (unofficial, no key) — one request per
 * sync.
 *
 * Mirrors src/lib/openfootball.ts: this file only translates Liiga's JSON shape
 * into `matches` rows; it doesn't talk to Supabase.
 *
 * Grading is the standard hockey 1X2 on the 60-MINUTE (regulation) result: a
 * game tied after three periods is a 'draw' even if someone wins it in
 * overtime or the shootout. So result = result_ft = the regulation outcome and
 * settle_match needs no hockey-specific logic.
 */
import type { MatchRow } from "@/lib/openfootball";

/** The competitions.id these rows belong to. */
export const LIIGA_COMPETITION_ID = "liiga-2027";

// `season=2027` is liiga.fi's id for the 2026–27 season.
const LIIGA_GAMES_URL =
  "https://liiga.fi/api/v2/games?tournament=runkosarja&season=2027";

type PeriodCategory = "NORMAL" | "OVERTIME" | "WINNING_SHOT_COMPETITION";

interface LiigaPeriod {
  index: number;
  category: PeriodCategory;
  homeTeamGoals: number;
  awayTeamGoals: number;
}

interface LiigaTeam {
  teamName: string;
  /** Final goals, INCLUDING the OT winner / the +1 shootout decider. */
  goals: number;
}

/** One game from the API (only the fields we use). */
export interface LiigaGame {
  id: number;
  /** UTC ISO timestamp, e.g. "2026-09-01T15:30:00Z". */
  start: string;
  homeTeam: LiigaTeam;
  awayTeam: LiigaTeam;
  /**
   * Always lists all five periods (3× NORMAL, OVERTIME, WINNING_SHOT_COMPETITION),
   * zero-filled if unplayed — so use `finishedType` to tell whether OT/SO happened.
   */
  periods: LiigaPeriod[];
  /**
   * Seen 2026-09-18: ACTIVE_OR_NOT_STARTED, ENDED_DURING_REGULAR_GAME_TIME,
   * ENDED_DURING_EXTENDED_GAME_TIME (overtime), ENDED_DURING_WINNING_SHOT_COMPETITION.
   */
  finishedType: string;
  started: boolean;
  ended: boolean;
  gameWeek: number;
}

export async function fetchLiigaGames(): Promise<LiigaGame[]> {
  const res = await fetch(LIIGA_GAMES_URL, {
    cache: "no-store",
    // Don't let a hung upstream eat the whole cron run.
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch Liiga games: ${res.status} ${res.statusText}`);
  }
  const data: unknown = await res.json();
  if (!Array.isArray(data)) {
    throw new Error("Unexpected Liiga API response: expected an array of games");
  }
  return data as LiigaGame[];
}

/** Sum home/away goals over the periods of one category. */
function sumPeriods(game: LiigaGame, category: PeriodCategory): [number, number] {
  let home = 0;
  let away = 0;
  for (const p of game.periods ?? []) {
    if (p.category !== category) continue;
    home += p.homeTeamGoals ?? 0;
    away += p.awayTeamGoals ?? 0;
  }
  return [home, away];
}

function compareGoals([g1, g2]: [number, number]): "team1" | "team2" | "draw" {
  if (g1 > g2) return "team1";
  if (g2 > g1) return "team2";
  return "draw";
}

/** Convert one Liiga game into a row ready for `matches` upsert. */
export function toLiigaMatchRow(game: LiigaGame): MatchRow {
  const wentToOvertime =
    game.finishedType === "ENDED_DURING_EXTENDED_GAME_TIME" ||
    game.finishedType === "ENDED_DURING_WINNING_SHOT_COMPETITION";
  const wentToShootout = game.finishedType === "ENDED_DURING_WINNING_SHOT_COMPETITION";

  // Only a finished game gets a result/score. (settle_match additionally waits
  // until 3h after kickoff — see SETTLE_DELAY_HOURS in /api/sync.)
  const regulation = game.ended ? sumPeriods(game, "NORMAL") : null;
  const result = regulation ? compareGoals(regulation) : null;

  // Display-only scores (never graded): ft = regulation, et = after overtime,
  // p = the shootout period (the decider, e.g. 1–0).
  const overtime = sumPeriods(game, "OVERTIME");
  const shootout = sumPeriods(game, "WINNING_SHOT_COMPETITION");
  const afterOvertime =
    regulation && wentToOvertime
      ? [regulation[0] + overtime[0], regulation[1] + overtime[1]]
      : null;
  const shootoutScore = regulation && wentToShootout ? shootout : null;

  return {
    external_ref: `liiga-${game.id}`,
    competition: LIIGA_COMPETITION_ID,
    team1: game.homeTeam.teamName,
    team2: game.awayTeam.teamName,
    kickoff_at: new Date(game.start).toISOString(),
    group_label: game.gameWeek ? `Week ${game.gameWeek}` : null,
    stage: "regular",
    result,
    result_ft: result,
    ft_team1: regulation?.[0] ?? null,
    ft_team2: regulation?.[1] ?? null,
    et_team1: afterOvertime?.[0] ?? null,
    et_team2: afterOvertime?.[1] ?? null,
    p_team1: shootoutScore?.[0] ?? null,
    p_team2: shootoutScore?.[1] ?? null,
  };
}
