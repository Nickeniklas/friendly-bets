"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "fb-intro-dismissed";
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return localStorage.getItem(STORAGE_KEY) === "true";
}

// Server (and the pre-hydration client render) assume not dismissed; if
// localStorage says otherwise, useSyncExternalStore re-renders right after
// hydration with the real value.
function getServerSnapshot() {
  return false;
}

function dismiss() {
  localStorage.setItem(STORAGE_KEY, "true");
  listeners.forEach((l) => l());
}

const STEPS = [
  "Tap a team in an upcoming match to pick your winner",
  "Choose how many points to wager, then press Place bet",
  "If your team wins, you earn points — check the leaderboard!",
];

/** "How to play" card, dismissed permanently via localStorage. */
export function IntroCard() {
  const dismissed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (dismissed) return null;

  return (
    <div className="mb-6 rounded-2xl border border-[var(--green-dim)] bg-[var(--green-bg)] p-[18px_20px]">
      <div className="mb-3.5 flex items-start justify-between">
        <div className="text-sm font-bold">🏆 How to play</div>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="cursor-pointer border-none bg-transparent p-0 pl-2 text-[22px] leading-none text-[var(--muted)]"
        >
          ×
        </button>
      </div>
      <div className="flex flex-col gap-2.5">
        {STEPS.map((step, i) => (
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
