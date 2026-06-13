"use client";

import { useEffect, useState } from "react";
import { claimDailyBonus } from "@/app/actions";

/**
 * On mount, calls claimDailyBonus() once. If it returns a non-zero bonus
 * (first visit of the day), shows a small self-dismissing banner. Renders
 * nothing otherwise (already claimed today, or logged out).
 *
 * Mounted once from the root layout (src/app/layout.tsx), so this fires once
 * per full page load — repeat client-side navigations within the same
 * layout won't remount it, and the RPC is idempotent regardless.
 */
export function DailyBonusToast() {
  const [bonus, setBonus] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let active = true;
    claimDailyBonus().then((awarded) => {
      if (active && awarded > 0) {
        setBonus(awarded);
        setVisible(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;

  // Invert the bonus formula (100 + (streak-1)*50, capped at 400) to show
  // "Day N" for streaks 1-6. At the 400 cap we can't distinguish day 7 from
  // day 8+ (both return 400), so use a generic label there — still accurate.
  const day = bonus < 400 ? (bonus - 100) / 50 + 1 : null;
  const label =
    day !== null
      ? `🔥 Day ${day} streak — +${bonus} points!`
      : `🔥 Streak bonus — +${bonus} points!`;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded bg-foreground px-4 py-2 text-sm text-background shadow-lg">
      {label}
      <button
        onClick={() => setVisible(false)}
        className="ml-3 underline opacity-75"
        aria-label="Dismiss"
      >
        Dismiss
      </button>
    </div>
  );
}
