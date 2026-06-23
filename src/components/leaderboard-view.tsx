"use client";

import { useState, type ReactNode } from "react";
import { LeaderboardTable, type LeaderboardRow } from "@/components/leaderboard-table";

/**
 * One selectable period (all-time or a single tournament round). The podium is
 * rendered server-side and passed in as a ReactNode (so PodiumColumn stays on
 * the server — same trick MatchesTabs uses for its tab content), while the
 * table rows are plain data handed to the client-side LeaderboardTable.
 */
export type Period = {
  key: string; // "all" | "group" | "r16" | ...
  label: string; // "All time" | "Group stage" | ...
  podium: ReactNode; // top-3 podium, or null if the period has < 3 players
  rows: LeaderboardRow[];
};

/**
 * Segmented pill selector + podium/table switcher for the leaderboard. Every
 * period's standings are computed server-side and passed in via `periods`, so
 * switching periods is instant — no refetch (mirrors MatchesTabs).
 */
export function LeaderboardView({ periods }: { periods: Period[] }) {
  // Default to the first period, which is always "All time".
  const [active, setActive] = useState(periods[0].key);
  const activePeriod = periods.find((p) => p.key === active) ?? periods[0];

  return (
    <div>
      {/* Segmented pill selector — sits between the podium and the table.
          Scrolls horizontally if there are more rounds than fit on one line. */}
      <div className="mb-6 flex gap-1 overflow-x-auto rounded-full bg-[var(--surface-2)] p-1">
        {periods.map((p) => {
          const isActive = p.key === active;
          return (
            <button
              key={p.key}
              onClick={() => setActive(p.key)}
              className="cursor-pointer rounded-full px-4 py-1.5 text-[13px] font-semibold whitespace-nowrap transition-colors"
              style={{
                background: isActive ? "var(--green)" : "transparent",
                color: isActive ? "#fff" : "var(--muted)",
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Podium for the active period (omitted when it has < 3 players). */}
      {activePeriod.podium}

      {/* All players in the active period. */}
      <div className="mb-1 text-[11px] font-bold tracking-[0.08em] text-[var(--muted)] uppercase">
        All players
      </div>
      {activePeriod.rows.length > 0 ? (
        <>
          <p className="mb-3 text-xs text-[var(--muted)]">Tap a column header to sort.</p>
          <LeaderboardTable rows={activePeriod.rows} />
        </>
      ) : (
        <p className="mt-2 text-sm text-[var(--muted)]">
          No settled predictions in this round yet.
        </p>
      )}
    </div>
  );
}
