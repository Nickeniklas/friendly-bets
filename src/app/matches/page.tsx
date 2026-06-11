import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

type Match = {
  id: string;
  team1: string;
  team2: string;
  kickoff_at: string;
  group_label: string | null;
  stage: string;
  status: string;
  result: string | null;
};

// Maps the short stage codes stored in the DB (see SCHEMA.md / openfootball.ts
// `mapStage`) to friendly labels. Falls back to the raw code for anything
// unrecognized so nothing is hidden if openfootball adds a new round name.
const STAGE_LABELS: Record<string, string> = {
  group: "Group Stage",
  r32: "Round of 32",
  r16: "Round of 16",
  qf: "Quarter-final",
  sf: "Semi-final",
  third_place: "Third-place Play-off",
  final: "Final",
};

// Matches are stored in UTC (kickoff_at). We render times in UTC rather than
// the visitor's local timezone so the server-rendered HTML is the same for
// everyone — converting to local time would need client-side JS and could
// produce a "hydration mismatch" if the server and browser ever disagreed.
const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
};

const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", DATE_FORMAT);
}

function formatTime(iso: string): string {
  return `${new Date(iso).toLocaleTimeString("en-GB", TIME_FORMAT)} UTC`;
}

// status === 'settled' is the only case with a result; 'scheduled' and
// 'closed' both just mean "no result yet" (closed = kickoff has passed but
// the sync job hasn't recorded a result yet).
function statusLabel(match: Match): string {
  if (match.status === "settled") {
    if (match.result === "team1") return `${match.team1} won`;
    if (match.result === "team2") return `${match.team2} won`;
    return "Draw — bets refunded";
  }
  if (match.status === "closed") return "Awaiting result";
  return "Upcoming";
}

export default async function MatchesPage() {
  const supabase = await createClient();

  // RLS allows everyone (including logged-out visitors) to read matches,
  // so this page works without auth.
  const { data: matches, error } = await supabase
    .from("matches")
    .select("id, team1, team2, kickoff_at, group_label, stage, status, result")
    .order("kickoff_at", { ascending: true });

  if (error) {
    return (
      <div className="p-8 text-red-600">
        Failed to load matches: {error.message}
      </div>
    );
  }

  // Group matches under a heading for each kickoff date (UTC).
  const groups = new Map<string, Match[]>();
  for (const match of matches ?? []) {
    const day = formatDate(match.kickoff_at);
    const dayMatches = groups.get(day);
    if (dayMatches) {
      dayMatches.push(match);
    } else {
      groups.set(day, [match]);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Matches</h1>
        <Link href="/" className="text-sm underline">
          Home
        </Link>
      </div>

      {(matches ?? []).length === 0 && (
        <p className="text-zinc-600 dark:text-zinc-400">
          No matches yet — check back once the schedule has synced.
        </p>
      )}

      {[...groups.entries()].map(([day, dayMatches]) => (
        <section key={day}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            {day}
          </h2>
          <ul className="flex flex-col gap-2">
            {dayMatches.map((match) => (
              <li
                key={match.id}
                className="flex items-center justify-between gap-4 rounded border border-zinc-300 px-4 py-3 dark:border-zinc-700"
              >
                <div className="flex flex-col gap-1">
                  <span className="font-medium">
                    {match.team1} vs {match.team2}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {STAGE_LABELS[match.stage] ?? match.stage}
                    {match.group_label ? ` · ${match.group_label}` : ""}
                  </span>
                </div>
                <div className="flex flex-col items-end gap-1 text-sm">
                  <span>{formatTime(match.kickoff_at)}</span>
                  <span
                    className={
                      match.status === "settled"
                        ? "font-medium"
                        : "text-zinc-500"
                    }
                  >
                    {statusLabel(match)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
