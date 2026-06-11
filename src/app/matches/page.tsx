import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { placeBet } from "./actions";

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

type Bet = {
  match_id: string;
  pick: string;
  stake: number;
  payout: number | null;
  outcome: string | null;
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

// The bet-placement form, the user's existing bet on this match, or a
// "log in to bet" link — whichever applies. Mirrors the bettable window
// enforced server-side by the `enforce_bet_window` trigger (status =
// 'scheduled' AND now() < kickoff_at), so the UI doesn't offer bets the DB
// would reject.
function BetSection({
  match,
  now,
  loggedIn,
  balance,
  bet,
}: {
  match: Match;
  now: number;
  loggedIn: boolean;
  balance: number | null;
  bet: Bet | undefined;
}) {
  if (bet) {
    const pickedTeam = bet.pick === "team1" ? match.team1 : match.team2;
    let outcomeLabel = "";
    if (bet.outcome === "won") outcomeLabel = ` — won ${bet.payout} pts`;
    else if (bet.outcome === "lost") outcomeLabel = " — lost";
    else if (bet.outcome === "refunded") outcomeLabel = " — refunded";

    return (
      <p className="text-xs text-zinc-500">
        Your bet: {bet.stake} pts on {pickedTeam}
        {outcomeLabel}
      </p>
    );
  }

  const bettable =
    match.status === "scheduled" &&
    new Date(match.kickoff_at).getTime() > now;

  if (!bettable) return null;

  if (!loggedIn) {
    return (
      <Link href="/login" className="text-xs underline">
        Log in to bet
      </Link>
    );
  }

  return (
    <form action={placeBet} className="flex items-center gap-2 text-xs">
      <input type="hidden" name="matchId" value={match.id} />
      <select
        name="pick"
        className="rounded border border-zinc-300 bg-transparent px-1 py-0.5 dark:border-zinc-700"
      >
        <option value="team1">{match.team1}</option>
        <option value="team2">{match.team2}</option>
      </select>
      <input
        type="number"
        name="stake"
        min={1}
        max={balance ?? undefined}
        defaultValue={10}
        required
        className="w-16 rounded border border-zinc-300 bg-transparent px-1 py-0.5 dark:border-zinc-700"
      />
      <button
        type="submit"
        className="rounded bg-foreground px-2 py-1 text-background"
      >
        Bet
      </button>
    </form>
  );
}

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; error?: string }>;
}) {
  const { message, error: errorMessage } = await searchParams;
  // This is a Server Component — Date.now() here is the request time, which
  // is exactly what we want for "is betting still open?". The react-hooks
  // purity rule is aimed at client components re-rendering with stale
  // values, which doesn't apply to a fresh per-request server render.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

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

  // For logged-in users, fetch their points balance and any bets they've
  // already placed, so we can show "your bet" instead of a betting form.
  let balance: number | null = null;
  const betsByMatch = new Map<string, Bet>();

  if (user) {
    const [{ data: profile }, { data: bets }] = await Promise.all([
      supabase
        .from("profiles")
        .select("points_balance")
        .eq("id", user.id)
        .single(),
      supabase
        .from("bets")
        .select("match_id, pick, stake, payout, outcome")
        .eq("user_id", user.id),
    ]);

    balance = profile?.points_balance ?? null;
    for (const bet of bets ?? []) {
      betsByMatch.set(bet.match_id, bet);
    }
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

      {user && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Balance: {balance ?? "—"} points
        </p>
      )}
      {message && <p className="text-sm text-green-600">{message}</p>}
      {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}

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
                className="flex flex-col gap-2 rounded border border-zinc-300 px-4 py-3 dark:border-zinc-700"
              >
                <div className="flex items-center justify-between gap-4">
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
                </div>
                <BetSection
                  match={match}
                  now={now}
                  loggedIn={!!user}
                  balance={balance}
                  bet={betsByMatch.get(match.id)}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
