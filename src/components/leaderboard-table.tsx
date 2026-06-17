"use client";

import { useMemo, useState } from "react";

/** One row of the all-players stats table — points joined with accuracy. */
export type LeaderboardRow = {
  id: string;
  display_name: string | null;
  points_balance: number;
  bets_placed: number;
  correct: number;
  wrong: number;
  win_rate_pct: number;
  streak: number;
};

// "#" and "Player" are never sortable (rank is derived from the sort, and
// name sorting isn't useful here) — every numeric stat column is.
type SortKey =
  | "points_balance"
  | "bets_placed"
  | "correct"
  | "wrong"
  | "win_rate_pct"
  | "streak";
type SortDirection = "asc" | "desc";

// The sortable numeric columns, in display order. Drives both the header row
// and the data cells below, so a column is added/removed in one place.
const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "points_balance", label: "Points" },
  { key: "bets_placed", label: "Bets" },
  { key: "correct", label: "Correct" },
  { key: "wrong", label: "Wrong" },
  { key: "win_rate_pct", label: "Win%" },
  { key: "streak", label: "Streak" },
];

/** Clickable column header showing an arrow when it's the active sort key. */
function SortableHeader({
  sortKeyName,
  label,
  activeKey,
  direction,
  onSort,
}: {
  sortKeyName: SortKey;
  label: string;
  activeKey: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
}) {
  const active = sortKeyName === activeKey;
  return (
    <th
      onClick={() => onSort(sortKeyName)}
      className="cursor-pointer select-none whitespace-nowrap px-2 py-2.5 text-right text-[11px] font-semibold text-[var(--muted)]"
    >
      {label}
      {active && <span className="ml-0.5">{direction === "asc" ? "▲" : "▼"}</span>}
    </th>
  );
}

/**
 * Single sortable stats table covering all players (points + accuracy).
 * Sorting is entirely client-side over the rows passed in — no refetch, so
 * re-sorting is instant. Rank (the "#" column) reflects whatever the current
 * sort order is, so it recomputes whenever the sort changes.
 */
export function LeaderboardTable({ rows }: { rows: LeaderboardRow[] }) {
  // Default: points descending, matching the podium above.
  const [sortKey, setSortKey] = useState<SortKey>("points_balance");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const sortedRows = useMemo(() => {
    const sign = sortDirection === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => sign * (a[sortKey] - b[sortKey]));
  }, [rows, sortKey, sortDirection]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      // Clicking the active column toggles direction.
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      // New column: switch to it, default descending.
      setSortKey(key);
      setSortDirection("desc");
    }
  }

  if (rows.length === 0) {
    return <p className="text-sm text-[var(--muted)]">No players yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-[var(--line)] bg-[var(--surface-2)]">
            <th className="whitespace-nowrap px-2 py-2.5 text-left text-[11px] font-semibold text-[var(--muted)]">
              #
            </th>
            <th className="whitespace-nowrap px-2 py-2.5 text-left text-[11px] font-semibold text-[var(--muted)]">
              Player
            </th>
            {SORT_COLUMNS.map(({ key, label }) => (
              <SortableHeader
                key={key}
                sortKeyName={key}
                label={label}
                activeKey={sortKey}
                direction={sortDirection}
                onSort={handleSort}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, i) => {
            const winPctColor =
              row.correct > row.wrong
                ? "var(--green-text)"
                : row.wrong > row.correct
                  ? "var(--red)"
                  : "var(--muted)";

            return (
              <tr
                key={row.id}
                className={i < sortedRows.length - 1 ? "border-b border-[var(--line)]" : ""}
              >
                <td className="px-2 py-3 text-[13px] font-semibold text-[var(--muted)]">
                  {i + 1}
                </td>
                <td className="max-w-[120px] truncate px-2 py-3 text-sm font-medium">
                  {row.display_name ?? "Unknown"}
                </td>
                <td className="px-2 py-3 text-right text-[13px] font-semibold">
                  {row.points_balance.toLocaleString()}
                </td>
                <td className="px-2 py-3 text-right text-[13px] text-[var(--muted)]">
                  {row.bets_placed}
                </td>
                <td className="px-2 py-3 text-right text-[13px] text-[var(--muted)]">
                  {row.correct}
                </td>
                <td className="px-2 py-3 text-right text-[13px] text-[var(--muted)]">
                  {row.wrong}
                </td>
                <td
                  className="px-2 py-3 text-right text-[13px] font-semibold"
                  style={{ color: winPctColor }}
                >
                  {row.win_rate_pct}%
                </td>
                <td className="px-2 py-3 text-right text-[13px] text-[var(--muted)]">
                  {row.streak > 0 ? `🔥 ${row.streak}` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
