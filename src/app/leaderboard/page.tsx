import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

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

  const accuracyRows = (accuracy ?? []) as AccuracyEntry[];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Leaderboard</h1>
        <div className="flex gap-4">
          <Link href="/matches" className="text-sm underline">
            Matches
          </Link>
          <Link href="/" className="text-sm underline">
            Home
          </Link>
        </div>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Points
        </h2>
        <ol className="flex flex-col gap-2">
          {((points ?? []) as PointsEntry[]).map((entry, i) => (
            <li
              key={entry.id}
              className="flex items-center justify-between rounded border border-zinc-300 px-4 py-2 dark:border-zinc-700"
            >
              <span>
                <span className="mr-2 text-zinc-500">{i + 1}.</span>
                {entry.display_name ?? "Unknown"}
              </span>
              <span className="font-medium">{entry.points_balance} pts</span>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Accuracy
        </h2>
        {accuracyRows.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            No settled bets yet — check back once results come in.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500">
                <th className="py-1 pr-2 font-medium">#</th>
                <th className="py-1 pr-2 font-medium">Player</th>
                <th className="py-1 pr-2 text-right font-medium">W–L</th>
                <th className="py-1 pr-2 text-right font-medium">Win %</th>
                <th className="py-1 text-right font-medium">Streak</th>
              </tr>
            </thead>
            <tbody>
              {accuracyRows.map((entry, i) => (
                <tr
                  key={entry.user_id}
                  className="border-t border-zinc-200 dark:border-zinc-800"
                >
                  <td className="py-1 pr-2 text-zinc-500">{i + 1}</td>
                  <td className="py-1 pr-2">
                    {entry.display_name ?? "Unknown"}
                  </td>
                  <td className="py-1 pr-2 text-right">
                    {entry.correct}–{entry.wrong}
                  </td>
                  <td className="py-1 pr-2 text-right">
                    {entry.win_rate_pct}%
                  </td>
                  <td className="py-1 text-right">{entry.streak}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
