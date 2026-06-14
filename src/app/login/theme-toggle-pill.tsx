"use client";

import { useTheme } from "@/components/theme-provider";

/** Labeled dark/light toggle for the login page (per Login.dc.html). Shows
 * the mode you'd switch *to*, same convention as ThemeToggle. */
export function ThemeTogglePill() {
  const { dark, toggleDark } = useTheme();

  return (
    <button
      onClick={toggleDark}
      className="mt-5 rounded-full border border-[var(--line)] px-[18px] py-2 text-[13px] text-[var(--muted)]"
    >
      {dark ? "☀ Light mode" : "🌙 Dark mode"}
    </button>
  );
}
