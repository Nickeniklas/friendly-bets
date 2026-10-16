"use client";

import { useSyncExternalStore } from "react";

// Football keeps the original key (so the World Cup card stays dismissed for
// anyone who already closed it); other sports get their own key, so returning
// players still see the sport-specific rules once. Hockey is on "-v2" since the
// OT/SO grading change + "Win in 60′" mode (2026-10-16), so everyone who
// dismissed the old rules sees the new ones once.
function storageKey(sport: string): string {
  if (sport === "football") return "fb-intro-dismissed";
  if (sport === "hockey") return "fb-intro-dismissed-hockey-v2";
  return `fb-intro-dismissed-${sport}`;
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Server (and the pre-hydration client render) assume not dismissed; if
// localStorage says otherwise, useSyncExternalStore re-renders right after
// hydration with the real value.
function getServerSnapshot() {
  return false;
}

function dismiss(key: string) {
  localStorage.setItem(key, "true");
  listeners.forEach((l) => l());
}

const STEPS = [
  "Predict each match: tap Home win, Draw, or Away win",
  "Correct picks earn +10 points (+15 if you backed an underdog under 33% of picks)",
  "Wrong picks lose 5 points — climb the leaderboard with your prediction skill!",
];

// Extra rule shown for hockey competitions: a team pick wins if the team wins at
// all (60′, OT or shootout), a Draw pick wins if it was tied after 60′ — so an
// OT/SO game pays both. "Win in 60′" is the strict +5 team pick.
const HOCKEY_STEP =
  "Hockey: a team pick wins if they win in 60′, OT or the shootout; Draw wins if it's tied after 60′ — so an OT game pays both. Pick “Win in 60′” for +5 if you think they'll win in regulation";

/** "How to play" card, dismissed permanently via localStorage. */
export function IntroCard({ sport }: { sport: string }) {
  const key = storageKey(sport);
  const dismissed = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(key) === "true",
    getServerSnapshot,
  );

  if (dismissed) return null;

  const steps = sport === "hockey" ? [...STEPS, HOCKEY_STEP] : STEPS;

  return (
    <div className="mb-6 rounded-2xl border border-[var(--green-dim)] bg-[var(--green-bg)] p-[18px_20px]">
      <div className="mb-3.5 flex items-start justify-between">
        <div className="text-sm font-bold">🏆 How to play</div>
        <button
          onClick={() => dismiss(key)}
          aria-label="Dismiss"
          className="cursor-pointer border-none bg-transparent p-0 pl-2 text-[22px] leading-none text-[var(--muted)]"
        >
          ×
        </button>
      </div>
      <div className="flex flex-col gap-2.5">
        {steps.map((step, i) => (
          <div key={step} className="flex items-start gap-3">
            <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--green)] text-[11px] font-bold text-white">
              {i + 1}
            </div>
            <span className="text-[13px] leading-relaxed text-[var(--muted)]">
              {step}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
