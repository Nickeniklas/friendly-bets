import { createClient } from "@/lib/supabase/server";
import { getSelectedCompetition, isKnockoutStage } from "@/lib/competitions";
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
  result_ft: string | null;
  // Actual goal counts (display only) — null until the sync job records them.
  // ft = after 90'; et/p = extra time / penalties (knockouts only).
  ft_team1: number | null;
  ft_team2: number | null;
  et_team1: number | null;
  et_team2: number | null;
  p_team1: number | null;
  p_team2: number | null;
};

type Bet = {
  match_id: string;
  pick: string;
  outcome: string | null;
  points_awarded: number;
  ft_winner: boolean;
};

// For a competition that's still running (competitions.is_active), Upcoming and
// Past only show this many days either side of now — a full hockey regular
// season is ~540 games. Finished competitions (the World Cup) show everything.
const ACTIVE_WINDOW_DAYS = 14;

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
  regular: "Regular season",
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
  sport: string,
): { label: string; color: "muted" | "gold" } {
  if (match.status === "settled" && sport === "hockey") {
    // Hockey is graded on the 60-minute result (result = result_ft), so a game
    // tied after regulation is a "Draw" even if it was won in OT/shootout —
    // say so, since the score note below will show the OT/SO winner.
    if (match.result === "team1") return { label: `${match.team1} won`, color: "muted" };
    if (match.result === "team2") return { label: `${match.team2} won`, color: "muted" };
    return { label: "Draw after 60′", color: "gold" };
  }
  if (match.status === "settled") {
    // A knockout level after 90 minutes (result_ft === 'draw') but won on
    // extra time / penalties advanced one team — note "(a.e.t.)" so the label
    // doesn't look like it contradicts a winning 'draw' pick on the same card.
    const wentToExtraTime = match.result_ft === "draw" && match.result !== "draw";
    const suffix = wentToExtraTime ? " (a.e.t.)" : "";
    if (match.result === "team1") return { label: `${match.team1} won${suffix}`, color: "muted" };
    if (match.result === "team2") return { label: `${match.team2} won${suffix}`, color: "muted" };
    return { label: "Draw", color: "gold" };
  }
  if (bettable) return { label: "Upcoming", color: "muted" };
  return { label: "Awaiting result", color: "muted" };
}

// The score to show on a settled match card. `home`/`away` are the headline
// goal counts (the extra-time aggregate when a knockout went to ET, otherwise
// the 90-minute score); `note` adds "a.e.t." / "4–2 pens" context so the score
// doesn't look like it contradicts a knockout winner. Returns undefined for
// matches that aren't settled or have no recorded score yet (older settled
// matches stay note-less until the next /api/sync backfills their goals).
type MatchScore = { home: number; away: number; note?: string };

function matchScore(match: Match, sport: string): MatchScore | undefined {
  if (match.status !== "settled") return undefined;

  // Hockey: same headline rule (score after OT if it went there, else
  // regulation), labelled "OT" / "SO" instead of "a.e.t." / "pens". et_* is
  // only set by the Liiga parser when the game actually went to overtime.
  if (sport === "hockey") {
    const home = match.et_team1 ?? match.ft_team1;
    const away = match.et_team2 ?? match.ft_team2;
    if (home == null || away == null) return undefined;
    let note: string | undefined;
    if (match.p_team1 != null && match.p_team2 != null) {
      note = `${match.p_team1}–${match.p_team2} SO`;
    } else if (match.et_team1 != null) {
      note = "OT";
    }
    return { home, away, note };
  }

  // Prefer the extra-time aggregate as the headline when it exists (a knockout
  // that went to ET), otherwise the 90-minute score.
  const home = match.et_team1 ?? match.ft_team1;
  const away = match.et_team2 ?? match.ft_team2;
  if (home == null || away == null) return undefined;

  // A knockout level at 90 but decided later (result_ft = 'draw', result not) —
  // same signal statusInfo uses for its "(a.e.t.)" label.
  const wentToExtraTime = match.result_ft === "draw" && match.result !== "draw";
  let note: string | undefined;
  if (match.p_team1 != null && match.p_team2 != null) {
    note = `${match.p_team1}–${match.p_team2} pens`;
  } else if (wentToExtraTime) {
    note = "a.e.t.";
  }

  return { home, away, note };
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
  const { competition, competitions } = await getSelectedCompetition();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // RLS allows everyone (including logged-out visitors) to read matches and
  // bets, so this page — and the crowd-split display below — works without
  // auth. The per-outcome bet counts come pre-aggregated from the
  // `match_bet_counts` view (one small row per match) rather than fetching and
  // tallying the whole bets table in JS.
  //
  // Everything is scoped to the selected competition. For an active one, only
  // matches within ACTIVE_WINDOW_DAYS of now are loaded (that's what the
  // Upcoming/Past windows show; Live matches kicked off minutes ago anyway).
  let matchesQuery = supabase
    .from("matches")
    .select(
      "id, team1, team2, kickoff_at, group_label, stage, status, result, result_ft, ft_team1, ft_team2, et_team1, et_team2, p_team1, p_team2",
    )
    .eq("competition", competition.id)
    .order("kickoff_at", { ascending: true });
  if (competition.is_active) {
    const windowMs = ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    matchesQuery = matchesQuery
      .gte("kickoff_at", new Date(now - windowMs).toISOString())
      .lte("kickoff_at", new Date(now + windowMs).toISOString());
  }

  const [{ data: matches, error }, { data: betCounts }] = await Promise.all([
    matchesQuery,
    supabase
      .from("match_bet_counts")
      .select("match_id, team1, draw, team2, matches!inner(competition)")
      .eq("matches.competition", competition.id),
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

  // For logged-in users, fetch the bets they've placed in this competition, so
  // we can show "your prediction" instead of a betting form, and sum their
  // points for the header pill. (profiles.points_balance is a cross-competition
  // running total now, so the pill uses this competition's bets instead.)
  let balance: number | null = null;
  const betsByMatch = new Map<string, Bet>();

  if (user) {
    const { data: bets } = await supabase
      .from("bets")
      .select("match_id, pick, outcome, points_awarded, ft_winner, matches!inner(competition)")
      .eq("user_id", user.id)
      .eq("matches.competition", competition.id);

    balance = 0;
    for (const bet of bets ?? []) {
      betsByMatch.set(bet.match_id, bet);
      balance += bet.points_awarded;
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
    const { label, color } = statusInfo(match, bettable, competition.sport);
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
          ftWinner: bet.ft_winner,
        }
      : undefined;

    // A pick wins on either the overall result or the full-time (90-min)
    // result, so on a knockout decided in extra time BOTH the advancer and
    // 'draw' are flagged as winners (Option B).
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
        score={matchScore(match, competition.sport)}
        isKnockout={isKnockoutStage(match.stage)}
        homeIsWinner={
          match.status === "settled" &&
          (match.result === "team1" || match.result_ft === "team1")
        }
        drawIsWinner={match.status === "settled" && match.result_ft === "draw"}
        awayIsWinner={
          match.status === "settled" &&
          (match.result === "team2" || match.result_ft === "team2")
        }
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
      <AppHeader loggedIn={!!user} competition={competition} competitions={competitions}>
        {user && (
          <div className="rounded-full bg-[var(--green-bg)] px-3 py-[5px] text-[13px] font-semibold text-[var(--green-text)]">
            {(balance ?? 0).toLocaleString()} pts
          </div>
        )}
      </AppHeader>

      {/* Content */}
      <div className="mx-auto max-w-[600px] px-4 pt-4 pb-2">
        <IntroCard sport={competition.sport} />

        {(matches ?? []).length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            {competition.is_active
              ? `No ${competition.name} matches in the next or last ${ACTIVE_WINDOW_DAYS} days.`
              : "No matches yet — check back once the schedule has synced."}
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
