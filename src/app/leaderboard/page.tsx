import { createClient } from "@/lib/supabase/server";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignOutButton } from "@/components/sign-out-button";
import { BottomNav } from "@/components/bottom-nav";
import { LeaderboardTable, type LeaderboardRow } from "@/components/leaderboard-table";

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
  ]);

  if (pointsError || accuracyError) {
    return (
      <div className="p-8 text-red-600">
        Failed to load leaderboard:{" "}
        {(pointsError ?? accuracyError)?.message}
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

  // Podium-style top 3 by points — a permanent showcase, separate from the
  // sortable table below. If there aren't at least 3 players, skip it — it
  // assumes 3 columns.
  const podium = pointsRows.length >= 3 ? pointsRows.slice(0, 3) : [];

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
            <ThemeToggle />
            {user && <SignOutButton />}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-[600px] px-4 pt-5 pb-4">
        <h1 className="mb-1 text-[26px] font-bold tracking-[-0.5px]">Leaderboard</h1>
        <p className="mb-8 text-sm text-[var(--muted)]">
          World Cup 2026 · {pointsRows.length} player{pointsRows.length === 1 ? "" : "s"}
        </p>

        {pointsRows.length === 0 && (
          <p className="mb-7 text-sm text-[var(--muted)]">No players yet.</p>
        )}

        {/* Podium (top 3) */}
        {podium.length === 3 && (
          <div className="mb-7 flex items-end gap-2 px-1">
            <PodiumColumn place={2} entry={podium[1]} />
            <PodiumColumn place={1} entry={podium[0]} />
            <PodiumColumn place={3} entry={podium[2]} />
          </div>
        )}

        {/* All players: one sortable table covering points + accuracy */}
        {pointsRows.length > 0 && (
          <>
            <div className="mb-1 text-[11px] font-bold tracking-[0.08em] text-[var(--muted)] uppercase">
              All players
            </div>
            <p className="mb-3 text-xs text-[var(--muted)]">
              Tap a column header to sort.
            </p>
            <LeaderboardTable rows={rows} />
          </>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
