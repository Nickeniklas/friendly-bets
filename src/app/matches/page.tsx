import { createClient } from "@/lib/supabase/server";
import { ThemeToggle } from "@/components/theme-toggle";
import { BottomNav } from "@/components/bottom-nav";
import { IntroCard } from "./intro-card";
import { MatchCard, type ExistingBet } from "./match-card";
import { MatchesTabs } from "./matches-tabs";

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

type Pool = { team1: number; team2: number };

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

// Matches are stored in UTC (kickoff_at). We render times in Finnish time
// (most players are in Finland) using the fixed "Europe/Helsinki" IANA zone
// rather than the visitor's local timezone, so the server-rendered HTML is
// still the same for everyone — converting to the visitor's own local time
// would need client-side JS and could produce a "hydration mismatch" if the
// server and browser ever disagreed. "Europe/Helsinki" handles the EET/EEST
// (UTC+2/+3) daylight-saving switch automatically.
const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "Europe/Helsinki",
};

const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Europe/Helsinki",
};

function formatDate(iso: string): string {
  return new Date(iso)
    .toLocaleDateString("en-GB", DATE_FORMAT)
    .toUpperCase()
    .replace(",", "");
}

function formatTime(iso: string): string {
  return `${new Date(iso).toLocaleTimeString("en-GB", TIME_FORMAT)} Finnish time`;
}

function stageLabel(match: Match): string {
  const base = STAGE_LABELS[match.stage] ?? match.stage;
  return match.group_label ? `${base} · ${match.group_label}` : base;
}

// status === 'settled' is the only case with a result; 'scheduled' and
// 'closed' both just mean "no result yet" (closed = kickoff has passed but
// the sync job hasn't recorded a result yet).
function statusInfo(
  match: Match,
  bettable: boolean,
): { label: string; color: "muted" | "gold" } {
  if (match.status === "settled") {
    if (match.result === "team1") return { label: `${match.team1} won`, color: "muted" };
    if (match.result === "team2") return { label: `${match.team2} won`, color: "muted" };
    return { label: "Draw", color: "gold" };
  }
  if (bettable) return { label: "Upcoming", color: "muted" };
  return { label: "Awaiting result", color: "muted" };
}

// Mirrors the payout math in `settle_match` (see
// 20260609000000_initial_schema.sql) so the displayed numbers match what
// would actually happen if the match settled right now:
//   - pot = sum(all stakes), seeded up to 300 if the pool is thin (the house
//     funds the gap, same as at settlement).
//   - For a side with stake S, settle_match pays each winning bet
//     `ROUND(stake / S * pot)` — i.e. every point on that side is multiplied
//     by `pot / S`. That's the "implied multiplier" shown here.
//   - A side with no stake (`null` multiplier) would be a push/refund if it
//     won, so there's no multiplier to show.
function computePool(stakes: Pool): {
  pot: number;
  mult1: number | null;
  mult2: number | null;
} {
  const pot = Math.max(stakes.team1 + stakes.team2, 300);
  return {
    pot,
    mult1: stakes.team1 > 0 ? pot / stakes.team1 : null,
    mult2: stakes.team2 > 0 ? pot / stakes.team2 : null,
  };
}

function formatMultiplier(mult: number | null): string {
  return mult === null ? "—" : `${mult.toFixed(2)}x`;
}

type DayGroup = { day: string; matches: Match[] };

// Groups matches by their kickoff date (formatted via formatDate),
// preserving the order in which days first appear in `matches` — so an
// ascending-sorted input produces chronological groups, and a
// descending-sorted input produces reverse-chronological groups.
function groupByDay(matches: Match[]): DayGroup[] {
  const groups: DayGroup[] = [];
  const indexByDay = new Map<string, number>();
  for (const match of matches) {
    const day = formatDate(match.kickoff_at);
    const existingIndex = indexByDay.get(day);
    if (existingIndex !== undefined) {
      groups[existingIndex].matches.push(match);
    } else {
      indexByDay.set(day, groups.length);
      groups.push({ day, matches: [match] });
    }
  }
  return groups;
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

  // RLS allows everyone (including logged-out visitors) to read matches and
  // bets, so this page — and the pool/multiplier info below — works without
  // auth.
  const [{ data: matches, error }, { data: allBets }] = await Promise.all([
    supabase
      .from("matches")
      .select("id, team1, team2, kickoff_at, group_label, stage, status, result")
      .order("kickoff_at", { ascending: true }),
    supabase.from("bets").select("match_id, pick, stake"),
  ]);

  if (error) {
    return (
      <div className="p-8 text-red-600">
        Failed to load matches: {error.message}
      </div>
    );
  }

  // Sum every bettor's stake per match/pick, for the pool/multiplier display.
  const poolsByMatch = new Map<string, Pool>();
  for (const bet of allBets ?? []) {
    const pool = poolsByMatch.get(bet.match_id) ?? { team1: 0, team2: 0 };
    pool[bet.pick as "team1" | "team2"] += bet.stake;
    poolsByMatch.set(bet.match_id, pool);
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

  // Split matches into the three tabs. "settled" always means Past,
  // regardless of kickoff time. Otherwise, a match is Upcoming if its
  // kickoff is still in the future (these are the bettable ones — see
  // `bettable` below, which mirrors this same future-kickoff check for
  // status === 'scheduled'), or Live if kickoff has passed but the sync job
  // hasn't recorded a result yet (status is still 'scheduled' or 'closed').
  // The query above already orders by kickoff_at ascending, which is the
  // order we want for Upcoming/Live ("soonest first"); Past wants
  // most-recent-first, so we reverse it.
  const upcomingMatches: Match[] = [];
  const liveMatches: Match[] = [];
  const pastMatches: Match[] = [];
  for (const match of matches ?? []) {
    if (match.status === "settled") {
      pastMatches.push(match);
    } else if (new Date(match.kickoff_at).getTime() > now) {
      upcomingMatches.push(match);
    } else {
      liveMatches.push(match);
    }
  }
  pastMatches.reverse();

  const upcomingGroups = groupByDay(upcomingMatches);
  const liveGroups = groupByDay(liveMatches);
  const pastGroups = groupByDay(pastMatches);

  // Renders a single match as a MatchCard, computing its pool/multiplier
  // display and the visitor's existing bet (if any) along the way.
  function renderMatchCard(match: Match) {
    const bettable =
      match.status === "scheduled" && new Date(match.kickoff_at).getTime() > now;
    const { label, color } = statusInfo(match, bettable);
    const pool = poolsByMatch.get(match.id) ?? { team1: 0, team2: 0 };
    const { pot, mult1, mult2 } = computePool(pool);
    const poolInfo = `Pool ${pot} pts · ${match.team1} ${formatMultiplier(mult1)} · ${match.team2} ${formatMultiplier(mult2)}`;
    const bet = betsByMatch.get(match.id);
    const existingBet: ExistingBet | undefined = bet
      ? {
          pick: bet.pick as "team1" | "team2",
          stake: bet.stake,
          outcome: bet.outcome as ExistingBet["outcome"],
          payout: bet.payout,
        }
      : undefined;

    return (
      <MatchCard
        key={match.id}
        matchId={match.id}
        stage={stageLabel(match)}
        time={formatTime(match.kickoff_at)}
        statusLabel={label}
        statusColor={color}
        homeName={match.team1}
        awayName={match.team2}
        homeIsWinner={match.status === "settled" && match.result === "team1"}
        awayIsWinner={match.status === "settled" && match.result === "team2"}
        poolInfo={poolInfo}
        multipliers={{ team1: mult1, team2: mult2 }}
        bettable={bettable}
        loggedIn={!!user}
        balance={balance}
        existingBet={existingBet}
      />
    );
  }

  // Renders a tab's match groups under sticky date headers, or a short
  // empty-state message if the tab has no matches.
  function renderDayGroups(groups: DayGroup[], emptyMessage: string) {
    if (groups.length === 0) {
      return <p className="text-sm text-[var(--muted)]">{emptyMessage}</p>;
    }
    return groups.map(({ day, matches: dayMatches }) => (
      <div key={day}>
        {/* Sticky date header — top offset (104px) clears the sticky page
            header (56px) and the sticky tab bar (48px) above it. The
            "washi tape" strip (clipped corners, bleeding slightly past the
            cards) sits inside a full-width sticky wrapper so it covers the
            cards scrolling underneath without them showing through the
            clipped corners. */}
        <div className="sticky top-[104px] z-30 bg-[var(--background)] pt-3 pb-2.5">
          <div
            className="-mx-1 flex items-center justify-between px-4 py-2 text-[11px] font-bold uppercase tracking-wider shadow-sm"
            style={{
              background: "var(--green-bg)",
              color: "var(--green-text)",
              clipPath: "polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%)",
            }}
          >
            <span>{day}</span>
            <span className="text-[10px] font-semibold normal-case tracking-normal opacity-70">
              {dayMatches.length} {dayMatches.length === 1 ? "match" : "matches"}
            </span>
          </div>
        </div>
        {dayMatches.map(renderMatchCard)}
      </div>
    ));
  }

  return (
    <div className="min-h-screen pb-[72px]">
      {/* Sticky header */}
      <div className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--background)]">
        <div className="mx-auto flex h-14 max-w-[600px] items-center justify-between px-4">
          <div className="flex items-center gap-2 text-base font-bold">
            <span>⚽</span>
            <span>Friendly Bets</span>
          </div>
          <div className="flex items-center gap-2">
            {user && (
              <div className="rounded-full bg-[var(--green-bg)] px-3 py-[5px] text-[13px] font-semibold text-[var(--green-text)]">
                {(balance ?? 0).toLocaleString()} pts
              </div>
            )}
            <ThemeToggle />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-[600px] px-4 pt-4 pb-2">
        <IntroCard />

        {message && (
          <p className="mb-4 text-sm text-[var(--green-text)]">{message}</p>
        )}
        {errorMessage && (
          <p className="mb-4 text-sm text-[var(--red)]">{errorMessage}</p>
        )}

        {(matches ?? []).length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No matches yet — check back once the schedule has synced.
          </p>
        ) : (
          <MatchesTabs
            counts={{
              upcoming: upcomingMatches.length,
              live: liveMatches.length,
              past: pastMatches.length,
            }}
            upcoming={renderDayGroups(upcomingGroups, "No upcoming matches")}
            live={renderDayGroups(liveGroups, "No live matches right now")}
            past={renderDayGroups(pastGroups, "No past matches yet")}
          />
        )}
      </div>

      <BottomNav />
    </div>
  );
}
