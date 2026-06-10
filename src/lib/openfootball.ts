/**
 * Fetch + parse the openfootball World Cup 2026 fixture/results feed.
 * Source: https://github.com/openfootball/worldcup.json/blob/master/2026/worldcup.json
 *
 * This file only deals with translating openfootball's JSON shape into rows
 * for our `matches` table — it doesn't talk to Supabase.
 */

const WORLDCUP_JSON_URL =
  "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";

/** Score sub-object as it appears once a match has been played. */
interface OpenFootballScore {
  /** Half-time score [team1, team2]. */
  ht?: [number, number];
  /** Full-time score [team1, team2]. */
  ft?: [number, number];
  /** Extra-time score [team1, team2] (knockout matches only). */
  et?: [number, number];
  /** Penalty shoot-out score [team1, team2] (knockout matches only). */
  p?: [number, number];
}

/** One match entry from worldcup.json. */
export interface OpenFootballMatch {
  round: string;
  /** Match number — present for knockout matches, absent for group stage. */
  num?: number;
  /** ISO date, e.g. "2026-06-11". */
  date: string;
  /** e.g. "13:00 UTC-6" or sometimes just "22:00" with no offset. */
  time?: string;
  team1: string;
  team2: string;
  /** e.g. "Group A" — absent for knockout matches. */
  group?: string;
  ground?: string;
  score?: OpenFootballScore;
}

interface OpenFootballData {
  name: string;
  matches: OpenFootballMatch[];
}

/** A row shape ready to upsert into `public.matches` (keyed on external_ref). */
export interface MatchRow {
  external_ref: string;
  team1: string;
  team2: string;
  kickoff_at: string; // ISO timestamp
  group_label: string | null;
  stage: string;
  result: "team1" | "team2" | "draw" | null;
}

export async function fetchWorldCupMatches(): Promise<OpenFootballMatch[]> {
  const res = await fetch(WORLDCUP_JSON_URL, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch openfootball data: ${res.status} ${res.statusText}`
    );
  }
  const data: OpenFootballData = await res.json();
  return data.matches;
}

/**
 * Build a stable dedupe key for upserting.
 *
 * Group-stage matches have fixed team names and dates from the start, so
 * "{date}-{team1}-{team2}" (slugified) is stable across re-syncs.
 *
 * Knockout matches start with placeholder team names ("2A" = runner-up of
 * Group A, "W74" = winner of match 74) that get overwritten with real team
 * names as the bracket resolves. If we keyed on team names there, a re-sync
 * after the bracket updates would create a *new* row instead of updating the
 * existing one. openfootball gives knockout matches a stable `num`, so we
 * key on that instead.
 */
export function buildExternalRef(match: OpenFootballMatch): string {
  if (match.num !== undefined) {
    return `wc2026-m${match.num}`;
  }
  return `${match.date}-${slugify(match.team1)}-${slugify(match.team2)}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Map openfootball's free-text `round` to the short stage codes used in
 * SCHEMA.md (group / r32 / r16 / qf / sf / final). Anything unrecognized
 * falls back to a slugified version of the round name so nothing is lost.
 */
export function mapStage(round: string): string {
  const r = round.toLowerCase();
  if (r.startsWith("matchday")) return "group";
  if (r.includes("round of 32")) return "r32";
  if (r.includes("round of 16")) return "r16";
  if (r.includes("quarter")) return "qf";
  if (r.includes("semi")) return "sf";
  if (r.includes("third place") || r.includes("3rd place")) return "third_place";
  if (r.includes("final")) return "final";
  return slugify(round);
}

/**
 * Combine openfootball's `date` + `time` ("HH:MM UTC±N") into an ISO
 * timestamp. If `time` is missing or doesn't include a UTC offset, it's
 * treated as UTC — close enough for a friendly game where being off by an
 * hour or two doesn't change anything except exactly when betting closes.
 */
export function parseKickoffAt(date: string, time?: string): string {
  const base = new Date(`${date}T00:00:00Z`);

  if (!time) return base.toISOString();

  const match = time.match(/^(\d{1,2}):(\d{2})(?:\s*UTC([+-]\d+))?/);
  if (!match) return base.toISOString();

  const [, hourStr, minuteStr, offsetStr] = match;
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const offsetHours = offsetStr ? Number(offsetStr) : 0;

  // "13:00 UTC-6" means local time is 6 hours behind UTC, so
  // UTC time = local time - offset = 13:00 - (-6) = 19:00.
  // setUTCHours handles values outside 0-23 by rolling the date over.
  base.setUTCHours(hour - offsetHours, minute, 0, 0);
  return base.toISOString();
}

/**
 * Determine the match result from the score, in the order that actually
 * decides a knockout tie: penalties > extra time > full time. Only a
 * full-time draw (group stage; knockouts go to extra time/penalties) can
 * produce 'draw'.
 */
export function parseResult(
  score?: OpenFootballScore
): "team1" | "team2" | "draw" | null {
  if (!score) return null;
  if (score.p) return compareGoals(score.p);
  if (score.et) return compareGoals(score.et);
  if (score.ft) return compareGoals(score.ft);
  return null;
}

function compareGoals([g1, g2]: [number, number]): "team1" | "team2" | "draw" {
  if (g1 > g2) return "team1";
  if (g2 > g1) return "team2";
  return "draw";
}

/** Convert one openfootball match into a row ready for `matches` upsert. */
export function toMatchRow(match: OpenFootballMatch): MatchRow {
  return {
    external_ref: buildExternalRef(match),
    team1: match.team1,
    team2: match.team2,
    kickoff_at: parseKickoffAt(match.date, match.time),
    group_label: match.group ?? null,
    stage: mapStage(match.round),
    result: parseResult(match.score),
  };
}
