"use client";

import { useState, type ReactNode } from "react";

type TabKey = "upcoming" | "live" | "past";

const TAB_LABELS: Record<TabKey, string> = {
  upcoming: "Upcoming",
  live: "Live",
  past: "Past",
};

const TAB_ORDER: TabKey[] = ["upcoming", "live", "past"];

/**
 * Tab bar + content switcher for the matches list. The match groups for all
 * three tabs are rendered server-side (passed in as `upcoming`/`live`/`past`)
 * — this component just toggles which one is visible, so switching tabs is
 * instant with no extra data fetch.
 */
export function MatchesTabs({
  upcoming,
  live,
  past,
  counts,
}: {
  upcoming: ReactNode;
  live: ReactNode;
  past: ReactNode;
  counts: Record<TabKey, number>;
}) {
  const [active, setActive] = useState<TabKey>("upcoming");

  const content: Record<TabKey, ReactNode> = { upcoming, live, past };

  return (
    <div>
      {/* Sticky tab bar (h-12 = 48px), pinned just below the sticky page
          header (h-14 = 56px). */}
      <div className="sticky top-14 z-40 flex h-12 border-b border-[var(--line)] bg-[var(--background)]">
        {TAB_ORDER.map((key) => {
          const isActive = key === active;
          return (
            <button
              key={key}
              onClick={() => setActive(key)}
              className="flex-1 cursor-pointer border-b-2 bg-transparent text-sm font-semibold transition-colors"
              style={{
                borderColor: isActive ? "var(--green)" : "transparent",
                color: isActive ? "var(--green-text)" : "var(--muted)",
              }}
            >
              {TAB_LABELS[key]} ({counts[key]})
            </button>
          );
        })}
      </div>

      <div className="pt-4">{content[active]}</div>
    </div>
  );
}
