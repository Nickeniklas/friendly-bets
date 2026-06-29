"use client";

import { useState, type ReactNode } from "react";

type SectionKey = "you" | "crowd" | "records";

const SECTION_LABELS: Record<SectionKey, string> = {
  you: "You",
  crowd: "The Crowd",
  records: "Records",
};

const SECTION_ORDER: SectionKey[] = ["you", "crowd", "records"];

/**
 * Section switcher for the /stats tab. Each section's content is rendered
 * server-side and passed in as a ReactNode (same trick as MatchesTabs /
 * LeaderboardView), so switching is instant with no refetch. The pill bar is
 * sticky just below the app header, mirroring the matches tab bar.
 */
export function StatsView({
  you,
  crowd,
  records,
}: {
  you: ReactNode;
  crowd: ReactNode;
  records: ReactNode;
}) {
  const [active, setActive] = useState<SectionKey>("you");
  const content: Record<SectionKey, ReactNode> = { you, crowd, records };

  return (
    <div>
      {/* Sticky section bar (h-12 = 48px), pinned below the sticky header
          (h-14 = 56px), matching /matches. */}
      <div className="sticky top-14 z-40 flex h-12 border-b border-[var(--line)] bg-[var(--background)]">
        {SECTION_ORDER.map((key) => {
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
              {SECTION_LABELS[key]}
            </button>
          );
        })}
      </div>

      <div className="pt-5">{content[active]}</div>
    </div>
  );
}
