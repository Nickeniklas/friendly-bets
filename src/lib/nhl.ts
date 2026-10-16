/**
 * Fetch + parse the NHL regular-season schedule/results.
 * Source: the NHL's public web API (unofficial, undocumented, no key):
 *   https://api-web.nhle.com/v1/schedule/{YYYY-MM-DD}
 * Each call returns the 7 days starting at that date in `gameWeek[].games[]`.
 *
 * Mirrors src/lib/liiga.ts: this file only translates the NHL's JSON shape into
 * `matches` rows; it doesn't talk to Supabase.
 *
 * Grading is the same hockey model as Liiga (settle_match is unchanged):
 *   * result    = the FINAL winner, after overtime / the shootout;
 *   * result_ft = the 60-minute (regulation) result — 'draw' if tied after 60.
 * The schedule feed has no per-period goals, only the final score and
 * `gameOutcome.lastPeriodType`, so the regulation score is reconstructed:
 *   * REG — the final score IS the regulation score.
 *   * OT  — sudden death, so exactly one goal was scored in overtime:
 *           regulation was tied at the loser's score.
 *   * SO  — the NHL credits the shootout winner with one extra goal in the
 *           final score, so regulation (and the scoreless OT) was tied at the
 *           loser's score too; the shootout is stored as a 1–0 decider.
 * If an OT/SO game's final margin isn't exactly 1, that reconstruction is
 * wrong — we log it and leave the result empty rather than guess.
 */
import { UPSTREAM_TIMEOUT_MS, type MatchRow } from "@/lib/openfootball";

/** The competitions.id these rows belong to. */
export const NHL_COMPETITION_ID = "nhl-2027";

const NHL_SCHEDULE_URL = "https://api-web.nhle.com/v1/schedule";

/** gameType 1 = preseason, 2 = regular season, 3 = playoffs. */
const REGULAR_SEASON = 2;

/**
 * Week 1 of the 2026–27 season = the Monday-start week containing the
 * schedule's `regularSeasonStartDate`, 2026-09-29 (a Tuesday) — so Week 1
 * starts Monday 2026-09-28. Update this when the season rolls over.
 */
const WEEK_1_MONDAY = "2026-09-28";

interface NhlTeam {
  abbrev: string;
  /** e.g. { default: "Maple Leafs" } — what we store as team1/team2. */
  commonName: { default: string };
  /** Final goals, INCLUDING the OT winner / the +1 shootout goal. Absent before the game. */
  score?: number;
  logo: string;
  darkLogo: string;
}

/** One game from the schedule API (only the fields we use). */
export interface NhlGame {
  id: number;
  gameType: number;
  /** UTC ISO timestamp, e.g. "2026-10-15T23:00:00Z". */
  startTimeUTC: string;
  /** Seen: FUT, PRE, LIVE, CRIT, FINAL, OFF. A result exists only for FINAL / OFF. */
  gameState: string;
  /** NOTE: the feed lists awayTeam first; homeTeam is still team1. */
  awayTeam: NhlTeam;
  homeTeam: NhlTeam;
  gameOutcome?: { lastPeriodType: "REG" | "OT" | "SO" | string };
}

interface NhlScheduleResponse {
  gameWeek?: { date: string; games: NhlGame[] }[];
}

/** "YYYY-MM-DD" for `base` shifted by `days` (UTC calendar arithmetic). */
function isoDate(base: Date, days: number): string {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function fetchScheduleWeek(date: string): Promise<NhlGame[]> {
  const res = await fetch(`${NHL_SCHEDULE_URL}/${date}`, {
    cache: "no-store",
    // Don't let a hung upstream eat the whole cron run (see UPSTREAM_TIMEOUT_MS).
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch NHL schedule ${date}: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as NhlScheduleResponse;
  if (!Array.isArray(data.gameWeek)) {
    throw new Error(`Unexpected NHL schedule response for ${date}: no gameWeek array`);
  }
  return data.gameWeek.flatMap((day) => day.games ?? []);
}

/**
 * Regular-season games from today−14 to today+13 days: four 7-day windows,
 * fetched in parallel (so the whole feed still fits in one UPSTREAM_TIMEOUT_MS),
 * deduped by game id. No backfill of older games — they have no bets and fall
 * outside /matches' ±14-day window anyway; their already-synced rows just stop
 * being updated, which is fine once they're settled.
 */
export async function fetchNhlGames(): Promise<NhlGame[]> {
  const today = new Date();
  const weeks = await Promise.all(
    [-14, -7, 0, 7].map((offset) => fetchScheduleWeek(isoDate(today, offset)))
  );
  const byId = new Map<number, NhlGame>();
  for (const game of weeks.flat()) {
    if (game.gameType === REGULAR_SEASON) byId.set(game.id, game);
  }
  return [...byId.values()];
}

/** The Europe/Helsinki calendar date of a UTC instant, as "YYYY-MM-DD". */
const helsinkiDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Helsinki",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Whole days since the Unix epoch for a "YYYY-MM-DD" date. */
function dayNumber(isoDay: string): number {
  return Math.floor(Date.parse(`${isoDay}T00:00:00Z`) / 86_400_000);
}

/**
 * "Week N" for a kickoff: Monday-start weeks counted from WEEK_1_MONDAY, using
 * the kickoff's date in FINNISH time (Europe/Helsinki) — the same clock the app
 * shows kickoffs in. Most NHL games start 01:00–05:00 Helsinki time, so a
 * Sunday-evening game in North America lands on Monday here and counts toward
 * the next week, matching the date header the user sees it under. Returns null
 * for a kickoff before Week 1.
 */
export function nhlWeekLabel(kickoffUtc: string): string | null {
  const day = helsinkiDate.format(new Date(kickoffUtc)); // en-CA → "YYYY-MM-DD"
  const week = Math.floor((dayNumber(day) - dayNumber(WEEK_1_MONDAY)) / 7) + 1;
  return week >= 1 ? `Week ${week}` : null;
}

function compareGoals(g1: number, g2: number): "team1" | "team2" | "draw" {
  if (g1 > g2) return "team1";
  if (g2 > g1) return "team2";
  return "draw";
}

type Graded = Pick<
  MatchRow,
  "result" | "result_ft" | "ft_team1" | "ft_team2" | "et_team1" | "et_team2" | "p_team1" | "p_team2"
>;

const UNGRADED: Graded = {
  result: null,
  result_ft: null,
  ft_team1: null,
  ft_team2: null,
  et_team1: null,
  et_team2: null,
  p_team1: null,
  p_team2: null,
};

/** Result + display scores for one game (team1 = home), or all-null if not final. */
function gradeGame(game: NhlGame): Graded {
  if (game.gameState !== "OFF" && game.gameState !== "FINAL") return UNGRADED;

  const home = game.homeTeam.score;
  const away = game.awayTeam.score;
  const lastPeriod = game.gameOutcome?.lastPeriodType;
  if (home == null || away == null || !lastPeriod) {
    console.warn(`[nhl] game ${game.id} is ${game.gameState} but has no score/outcome; leaving it ungraded`);
    return UNGRADED;
  }

  if (lastPeriod === "REG") {
    const outcome = compareGoals(home, away);
    return { ...UNGRADED, result: outcome, result_ft: outcome, ft_team1: home, ft_team2: away };
  }

  if (lastPeriod !== "OT" && lastPeriod !== "SO") {
    console.warn(`[nhl] game ${game.id}: unknown lastPeriodType "${lastPeriod}"; leaving it ungraded`);
    return UNGRADED;
  }

  // Guard: the regulation tie below is only derivable if the winner won by one.
  if (Math.abs(home - away) !== 1) {
    console.warn(
      `[nhl] game ${game.id}: ${lastPeriod} final ${home}–${away} isn't a one-goal margin; leaving it ungraded`
    );
    return UNGRADED;
  }

  const tied = Math.min(home, away); // regulation score, both teams
  const homeWon = home > away;
  const result = homeWon ? "team1" : "team2";

  if (lastPeriod === "OT") {
    // et = the final score (regulation + the OT winner).
    return {
      ...UNGRADED,
      result,
      result_ft: "draw",
      ft_team1: tied,
      ft_team2: tied,
      et_team1: home,
      et_team2: away,
    };
  }

  // SO: no et (OT was scoreless); p = the 1–0 shootout decider, which
  // matchScore() in /matches adds back onto ft for the "2–1 SO" note.
  return {
    ...UNGRADED,
    result,
    result_ft: "draw",
    ft_team1: tied,
    ft_team2: tied,
    p_team1: homeWon ? 1 : 0,
    p_team2: homeWon ? 0 : 1,
  };
}

/** Convert one NHL game into a row ready for `matches` upsert. */
export function toNhlMatchRow(game: NhlGame): MatchRow {
  return {
    external_ref: `nhl-${game.id}`,
    competition: NHL_COMPETITION_ID,
    team1: game.homeTeam.commonName.default,
    team2: game.awayTeam.commonName.default,
    kickoff_at: new Date(game.startTimeUTC).toISOString(),
    group_label: nhlWeekLabel(game.startTimeUTC),
    stage: "regular",
    ...gradeGame(game),
  };
}
