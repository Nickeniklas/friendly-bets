import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";
import { IntroCard } from "./intro-card";
import { MatchCard, type ExistingBet, type Distribution } from "./match-card";
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
  outcome: string | null;
  points_awarded: number;
};

// Count of bets per outcome on a match, used for the crowd-split display and
// the underdog-bonus hint (an outcome under 33% of bets earns the bonus).
type PickCounts = { team1: number; draw: number; team2: number };

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

export default async function MatchesPage() {
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
  // bets, so this page — and the crowd-split display below — works without
  // auth. The per-outcome bet counts come pre-aggregated from the
  // `match_bet_counts` view (one small row per match) rather than fetching and
  // tallying the whole bets table in JS.
  const [{ data: matches, error }, { data: betCounts }] = await Promise.all([
    supabase
      .from("matches")
      .select("id, team1, team2, kickoff_at, group_label, stage, status, result")
      .order("kickoff_at", { ascending: true }),
    supabase.from("match_bet_counts").select("match_id, team1, draw, team2"),
  ]);

  if (error) {
    return (
      <div className="p-8 text-red-600">
        Failed to load matches: {error.message}
      </div>
    );
  }

  // Index the crowd-split counts by match id for the display and the
  // underdog-bonus hint (an outcome under 33% of bets earns the bonus).
  // Matches with no bets are absent from the view and default to zeros below.
  const countsByMatch = new Map<string, PickCounts>();
  for (const row of betCounts ?? []) {
    countsByMatch.set(row.match_id, {
      team1: row.team1,
      draw: row.draw,
      team2: row.team2,
    });
  }

  // For logged-in users, fetch their points balance (shown in the header) and
  // any bets they've already placed, so we can show "your prediction" instead
  // of a betting form.
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
        .select("match_id, pick, outcome, points_awarded")
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

  // Renders a single match as a MatchCard, computing its crowd-split
  // distribution and the visitor's existing bet (if any) along the way.
  function renderMatchCard(match: Match) {
    const bettable =
      match.status === "scheduled" && new Date(match.kickoff_at).getTime() > now;
    const { label, color } = statusInfo(match, bettable);
    const counts = countsByMatch.get(match.id) ?? { team1: 0, draw: 0, team2: 0 };
    const distribution: Distribution = {
      team1: counts.team1,
      draw: counts.draw,
      team2: counts.team2,
      total: counts.team1 + counts.draw + counts.team2,
    };
    const bet = betsByMatch.get(match.id);
    const existingBet: ExistingBet | undefined = bet
      ? {
          pick: bet.pick as ExistingBet["pick"],
          outcome: bet.outcome as ExistingBet["outcome"],
          pointsAwarded: bet.points_awarded,
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
        drawIsWinner={match.status === "settled" && match.result === "draw"}
        awayIsWinner={match.status === "settled" && match.result === "team2"}
        distribution={distribution}
        bettable={bettable}
        loggedIn={!!user}
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
      {/* Sticky header — points pill is the matches-specific right-side slot */}
      <AppHeader loggedIn={!!user}>
        {user && (
          <div className="rounded-full bg-[var(--green-bg)] px-3 py-[5px] text-[13px] font-semibold text-[var(--green-text)]">
            {(balance ?? 0).toLocaleString()} pts
          </div>
        )}
      </AppHeader>

      {/* Content */}
      <div className="mx-auto max-w-[600px] px-4 pt-4 pb-2">
        <IntroCard />

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
