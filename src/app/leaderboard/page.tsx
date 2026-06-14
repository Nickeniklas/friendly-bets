import { createClient } from "@/lib/supabase/server";
import { ThemeToggle } from "@/components/theme-toggle";
import { BottomNav } from "@/components/bottom-nav";

type PointsEntry = {
  id: string;
  display_name: string | null;
  points_balance: number;
};

type AccuracyEntry = {
  user_id: string;
  display_name: string | null;
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
    { data: points, error: pointsError },
    { data: accuracy, error: accuracyError },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, points_balance")
      .order("points_balance", { ascending: false }),
    supabase
      .from("accuracy")
      .select("user_id, display_name, bets_placed, correct, wrong, win_rate_pct, streak")
      .order("win_rate_pct", { ascending: false })
      .order("bets_placed", { ascending: false }),
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

  // Podium-style top 3, then a plain ranked list for the rest. If there
  // aren't at least 3 players, skip the podium — it assumes 3 columns.
  const podium = pointsRows.length >= 3 ? pointsRows.slice(0, 3) : [];
  const rest = pointsRows.slice(podium.length);

  return (
    <div className="min-h-screen pb-[72px]">
      {/* Sticky header */}
      <div className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--background)]">
        <div className="mx-auto flex h-14 max-w-[600px] items-center justify-between px-4">
          <div className="flex items-center gap-2 text-base font-bold">
            <span>⚽</span>
            <span>Friendly Bets</span>
          </div>
          <ThemeToggle />
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

        {/* Ranked list 4+ */}
        {rest.length > 0 && (
          <ol className="mb-7 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
            {rest.map((entry, i) => (
              <li
                key={entry.id}
                className={`flex items-center gap-3 px-4 py-3.5 ${
                  i < rest.length - 1 ? "border-b border-[var(--line)]" : ""
                }`}
              >
                <span className="w-6 shrink-0 text-right text-[13px] font-semibold text-[var(--muted)]">
                  {podium.length + i + 1}.
                </span>
                <span className="flex-1 truncate text-sm font-medium">
                  {entry.display_name ?? "Unknown"}
                </span>
                <span className="shrink-0 text-[13px] font-semibold text-[var(--muted)]">
                  {entry.points_balance.toLocaleString()} pts
                </span>
              </li>
            ))}
          </ol>
        )}

        {/* Accuracy */}
        <div className="mb-3 text-[11px] font-bold tracking-[0.08em] text-[var(--muted)] uppercase">
          Accuracy
        </div>
        {accuracyRows.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No settled bets yet — check back once results come in.
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
            <div className="flex items-center gap-2 border-b border-[var(--line)] bg-[var(--surface-2)] px-4 py-2.5">
              <div className="w-5" />
              <div className="flex-1 text-[11px] font-semibold text-[var(--muted)]">Player</div>
              <div className="w-11 text-center text-[11px] font-semibold text-[var(--muted)]">W–L</div>
              <div className="w-11 text-center text-[11px] font-semibold text-[var(--muted)]">Win%</div>
              <div className="w-[52px] text-right text-[11px] font-semibold text-[var(--muted)]">Streak</div>
            </div>
            {accuracyRows.map((entry, i) => {
              const winPctColor =
                entry.correct > entry.wrong
                  ? "var(--green-text)"
                  : entry.wrong > entry.correct
                    ? "var(--red)"
                    : "var(--muted)";

              return (
                <div
                  key={entry.user_id}
                  className={`flex items-center gap-2 px-4 py-3.5 ${
                    i < accuracyRows.length - 1 ? "border-b border-[var(--line)]" : ""
                  }`}
                >
                  <div className="w-5 shrink-0 text-right text-xs font-semibold text-[var(--muted)]">
                    {i + 1}
                  </div>
                  <div className="flex-1 truncate text-sm font-medium">
                    {entry.display_name ?? "Unknown"}
                  </div>
                  <div className="w-11 shrink-0 text-center text-[13px] text-[var(--muted)]">
                    {entry.correct}–{entry.wrong}
                  </div>
                  <div
                    className="w-11 shrink-0 text-center text-[13px] font-semibold"
                    style={{ color: winPctColor }}
                  >
                    {entry.win_rate_pct}%
                  </div>
                  <div className="w-[52px] shrink-0 text-right text-[13px] text-[var(--muted)]">
                    {entry.streak > 0 ? `🔥 ${entry.streak}` : "—"}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
