import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";
import { type LeaderboardRow } from "@/components/leaderboard-table";
import { LeaderboardView, type Period } from "@/components/leaderboard-view";

type PointsEntry = {
  id: string;
  display_name: string | null;
  points_balance: number;
};

type AccuracyEntry = {
  user_id: string;
  bets_placed: number;
  correct: number;
  wrong: number;
  win_rate_pct: number;
  streak: number;
};

// One settled bet joined to its match's round and the bettor's name. Supabase
// returns the embedded relations as an object for to-one joins, but its
// inferred types can also be an array — `related()` below normalizes both.
type SettledBetRow = {
  user_id: string;
  points_awarded: number;
  outcome: "won" | "lost";
  placed_at: string;
  matches: { stage: string } | { stage: string }[] | null;
  profiles: { display_name: string | null } | { display_name: string | null }[] | null;
};

// Display names + canonical order for the round periods (codes from
// `mapStage()` in src/lib/openfootball.ts).
const STAGE_LABELS: Record<string, string> = {
  group: "Group stage",
  r32: "Round of 32",
  r16: "Round of 16",
  qf: "Quarter-finals",
  sf: "Semi-finals",
  third_place: "Third place",
  final: "Final",
};
const STAGE_ORDER = ["group", "r32", "r16", "qf", "sf", "third_place", "final"];

// Pull the single embedded row out of a Supabase to-one relation, whether it
// came back as an object or a one-element array.
function related<T>(rel: T | T[] | null | undefined): T | undefined {
  if (rel == null) return undefined;
  return Array.isArray(rel) ? rel[0] : rel;
}

/**
 * Aggregate settled bets into per-round leaderboard rows, using the same
 * formulas as the all-time `accuracy` view: points = Σ points_awarded,
 * bets = count, correct/wrong by outcome, win% = round(correct/total*100, 1),
 * streak = consecutive wins from the most recent bet. Returns one sorted
 * (points desc) row list per stage that has any settled bets.
 */
function buildStageRows(bets: SettledBetRow[]): Map<string, LeaderboardRow[]> {
  type Acc = {
    id: string;
    display_name: string | null;
    points: number;
    correct: number;
    wrong: number;
    history: { outcome: "won" | "lost"; placed_at: string }[];
  };
  const byStage = new Map<string, Map<string, Acc>>();

  for (const b of bets) {
    const stage = related(b.matches)?.stage;
    if (!stage) continue;
    let users = byStage.get(stage);
    if (!users) {
      users = new Map();
      byStage.set(stage, users);
    }
    let acc = users.get(b.user_id);
    if (!acc) {
      acc = {
        id: b.user_id,
        display_name: related(b.profiles)?.display_name ?? null,
        points: 0,
        correct: 0,
        wrong: 0,
        history: [],
      };
      users.set(b.user_id, acc);
    }
    acc.points += b.points_awarded;
    if (b.outcome === "won") acc.correct += 1;
    else acc.wrong += 1;
    acc.history.push({ outcome: b.outcome, placed_at: b.placed_at });
  }

  const result = new Map<string, LeaderboardRow[]>();
  for (const [stage, users] of byStage) {
    const rows: LeaderboardRow[] = [];
    for (const acc of users.values()) {
      const total = acc.correct + acc.wrong;
      const winRate = total === 0 ? 0 : Math.round((acc.correct / total) * 1000) / 10;

      // streak: consecutive wins counting back from the most recent bet.
      const newestFirst = [...acc.history].sort((a, b) =>
        b.placed_at.localeCompare(a.placed_at)
      );
      let streak = 0;
      for (const h of newestFirst) {
        if (h.outcome !== "won") break;
        streak += 1;
      }

      rows.push({
        id: acc.id,
        display_name: acc.display_name,
        points_balance: acc.points,
        bets_placed: total,
        correct: acc.correct,
        wrong: acc.wrong,
        win_rate_pct: winRate,
        streak,
      });
    }
    rows.sort((a, b) => b.points_balance - a.points_balance);
    result.set(stage, rows);
  }
  return result;
}

/**
 * "Recent form": for each player, aggregate only their most recent `limit`
 * settled bets (across all rounds, newest first). Same formulas as
 * buildStageRows. Returns rows sorted by points desc; players with no settled
 * bets are omitted.
 */
function buildRecentRows(bets: SettledBetRow[], limit = 10): LeaderboardRow[] {
  type Acc = {
    id: string;
    display_name: string | null;
    history: { outcome: "won" | "lost"; placed_at: string; points: number }[];
  };
  const byUser = new Map<string, Acc>();

  for (const b of bets) {
    let acc = byUser.get(b.user_id);
    if (!acc) {
      acc = {
        id: b.user_id,
        display_name: related(b.profiles)?.display_name ?? null,
        history: [],
      };
      byUser.set(b.user_id, acc);
    }
    acc.history.push({ outcome: b.outcome, placed_at: b.placed_at, points: b.points_awarded });
  }

  const rows: LeaderboardRow[] = [];
  for (const acc of byUser.values()) {
    // Newest first, then keep only the most recent `limit`.
    const recent = [...acc.history]
      .sort((a, b) => b.placed_at.localeCompare(a.placed_at))
      .slice(0, limit);
    if (recent.length === 0) continue;

    let points = 0;
    let correct = 0;
    let wrong = 0;
    let streak = 0;
    let streakOpen = true; // counting wins back from the newest bet
    for (const h of recent) {
      points += h.points;
      if (h.outcome === "won") {
        correct += 1;
        if (streakOpen) streak += 1;
      } else {
        wrong += 1;
        streakOpen = false;
      }
    }
    const total = correct + wrong;
    rows.push({
      id: acc.id,
      display_name: acc.display_name,
      points_balance: points,
      bets_placed: total,
      correct,
      wrong,
      win_rate_pct: total === 0 ? 0 : Math.round((correct / total) * 1000) / 10,
      streak,
    });
  }
  rows.sort((a, b) => b.points_balance - a.points_balance);
  return rows;
}

// Build the top-3 podium for a period from its points-sorted rows, or null
// (skip the podium) when there aren't at least 3 players — PodiumColumn
// assumes exactly 3 columns.
function renderPodium(
  entries: { id: string; display_name: string | null; points_balance: number }[]
): ReactNode {
  if (entries.length < 3) return null;
  return (
    <div className="mb-7 flex items-end gap-2 px-1">
      <PodiumColumn place={2} entry={entries[1]} />
      <PodiumColumn place={1} entry={entries[0]} />
      <PodiumColumn place={3} entry={entries[2]} />
    </div>
  );
}

// Avatar initials for the podium: first letter of the first two "words"
// (splitting on the punctuation people use in usernames), or the first two
// characters if there's only one word.
function initials(name: string): string {
  const parts = name.replace(/[._-]/g, " ").split(" ").filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Keeps long usernames from overflowing the narrow podium columns.
function shortName(name: string): string {
  return name.length > 15 ? `${name.slice(0, 13)}…` : name;
}

// Visual styling for each podium position — sizes/colors per
// Leaderboard.dc.html (1st is tallest/largest, gold; 2nd silver; 3rd bronze).
const PODIUM_CONFIG = {
  1: {
    circleSize: 56,
    circleFont: 18,
    circleBg: "var(--gold-bg)",
    circleText: "var(--gold-text)",
    circleBorder: "var(--gold)",
    nameFont: 13,
    nameWeight: 700,
    pointsFont: 13,
    pointsWeight: 600,
    pointsColor: "var(--green-text)",
    baseHeight: 96,
    baseBg: "var(--gold-base-bg)",
    baseBorder: "var(--gold)",
    medal: "🥇",
    medalSize: 30,
  },
  2: {
    circleSize: 46,
    circleFont: 15,
    circleBg: "var(--silver-bg)",
    circleText: "var(--silver-text)",
    circleBorder: "var(--silver-border)",
    nameFont: 12,
    nameWeight: 600,
    pointsFont: 12,
    pointsWeight: 400,
    pointsColor: "var(--muted)",
    baseHeight: 64,
    baseBg: "var(--surface-2)",
    baseBorder: "var(--line)",
    medal: "🥈",
    medalSize: 24,
  },
  3: {
    circleSize: 40,
    circleFont: 14,
    circleBg: "var(--bronze-bg)",
    circleText: "var(--bronze-text)",
    circleBorder: "var(--bronze-border)",
    nameFont: 12,
    nameWeight: 600,
    pointsFont: 12,
    pointsWeight: 400,
    pointsColor: "var(--muted)",
    baseHeight: 48,
    baseBg: "var(--surface-2)",
    baseBorder: "var(--line)",
    medal: "🥉",
    medalSize: 20,
  },
} as const;

function PodiumColumn({ place, entry }: { place: 1 | 2 | 3; entry: PointsEntry }) {
  const c = PODIUM_CONFIG[place];
  const name = entry.display_name ?? "Unknown";

  return (
    <div className="flex flex-1 flex-col items-center">
      <div
        className="mb-2 flex items-center justify-center rounded-full border-2 font-bold"
        style={{
          width: c.circleSize,
          height: c.circleSize,
          fontSize: c.circleFont,
          background: c.circleBg,
          color: c.circleText,
          borderColor: c.circleBorder,
        }}
      >
        {initials(name)}
      </div>
      <div
        className="mb-[3px] w-full truncate text-center"
        style={{ fontSize: c.nameFont, fontWeight: c.nameWeight }}
      >
        {shortName(name)}
      </div>
      <div
        className="mb-2"
        style={{ fontSize: c.pointsFont, fontWeight: c.pointsWeight, color: c.pointsColor }}
      >
        {entry.points_balance.toLocaleString()} pts
      </div>
      <div
        className="flex w-full items-center justify-center rounded-t-lg border border-b-0"
        style={{ height: c.baseHeight, background: c.baseBg, borderColor: c.baseBorder }}
      >
        <span style={{ fontSize: c.medalSize }}>{c.medal}</span>
      </div>
    </div>
  );
}

export default async function LeaderboardPage() {
  // RLS allows everyone (including logged-out visitors) to read profiles and
  // the accuracy view, so this page works without auth — same as /matches.
  const supabase = await createClient();

  const [
    {
      data: { user },
    },
    { data: points, error: pointsError },
    { data: accuracy, error: accuracyError },
    { data: settledBets, error: betsError },
  ] = await Promise.all([
    // Only used to decide whether to show the header's "Sign out" button.
    supabase.auth.getUser(),
    supabase
      .from("profiles")
      .select("id, display_name, points_balance")
      .order("points_balance", { ascending: false }),
    // No ordering needed — the table below sorts client-side.
    supabase
      .from("accuracy")
      .select("user_id, bets_placed, correct, wrong, win_rate_pct, streak"),
    // Settled bets joined to their match's round + the bettor's name, used to
    // build the per-round periods. `!inner` drops bets without a joinable
    // match/profile; all-time still comes from profiles + accuracy above.
    supabase
      .from("bets")
      .select(
        "user_id, points_awarded, outcome, placed_at, matches!inner(stage), profiles!inner(display_name)"
      )
      .in("outcome", ["won", "lost"]),
  ]);

  if (pointsError || accuracyError || betsError) {
    return (
      <div className="p-8 text-red-600">
        Failed to load leaderboard:{" "}
        {(pointsError ?? accuracyError ?? betsError)?.message}
      </div>
    );
  }

  const pointsRows = (points ?? []) as PointsEntry[];
  const accuracyRows = (accuracy ?? []) as AccuracyEntry[];

  // Join points with accuracy so every player has a full row of stats —
  // players with no settled bets yet just get zeros (they won't be in the
  // accuracy view, since it derives from `bets`).
  const accuracyByUserId = new Map(accuracyRows.map((a) => [a.user_id, a]));
  const rows: LeaderboardRow[] = pointsRows.map((p) => {
    const acc = accuracyByUserId.get(p.id);
    return {
      id: p.id,
      display_name: p.display_name,
      points_balance: p.points_balance,
      bets_placed: acc?.bets_placed ?? 0,
      correct: acc?.correct ?? 0,
      wrong: acc?.wrong ?? 0,
      win_rate_pct: acc?.win_rate_pct ?? 0,
      streak: acc?.streak ?? 0,
    };
  });

  // Per-round standings, aggregated from settled bets. All-time stays on the
  // profiles + accuracy path above (authoritative balance, lists every
  // registered player); round periods are bets-derived (only players who had a
  // settled bet that round).
  const allSettledBets = (settledBets ?? []) as unknown as SettledBetRow[];
  const stageRows = buildStageRows(allSettledBets);

  // Period selector options: All time first, then each round that has any
  // settled bets, in canonical tournament order. Any unrecognized stage code
  // (a mapStage fallback slug) is appended last so its data is never dropped.
  const periods: Period[] = [
    { key: "all", label: "All time", podium: renderPodium(pointsRows), rows },
  ];

  // Recent-form view (each player's last 10 settled bets), right after
  // All time. Only shown once anyone has a settled bet.
  const recentRows = buildRecentRows(allSettledBets);
  if (recentRows.length > 0) {
    periods.push({
      key: "last10",
      label: "Last 10",
      podium: renderPodium(recentRows),
      rows: recentRows,
    });
  }

  const extraStages = [...stageRows.keys()].filter((s) => !STAGE_ORDER.includes(s));
  for (const stage of [...STAGE_ORDER, ...extraStages]) {
    const sRows = stageRows.get(stage);
    if (!sRows || sRows.length === 0) continue;
    periods.push({
      key: stage,
      label: STAGE_LABELS[stage] ?? stage,
      podium: renderPodium(sRows),
      rows: sRows,
    });
  }

  return (
    <div className="min-h-screen pb-[72px]">
      {/* Sticky header (no points pill on the leaderboard) */}
      <AppHeader loggedIn={!!user} />

      {/* Content */}
      <div className="mx-auto max-w-[600px] px-4 pt-5 pb-4">
        <h1 className="mb-1 text-[26px] font-bold tracking-[-0.5px]">Leaderboard</h1>
        <p className="mb-8 text-sm text-[var(--muted)]">
          World Cup 2026 · {pointsRows.length} player{pointsRows.length === 1 ? "" : "s"}
        </p>

        {pointsRows.length === 0 ? (
          <p className="mb-7 text-sm text-[var(--muted)]">No players yet.</p>
        ) : (
          // Period selector (All time + per round) wrapping the podium + table.
          <LeaderboardView periods={periods} />
        )}
      </div>

      <BottomNav />
    </div>
  );
}
