"use client";

import { useTheme } from "@/components/theme-provider";

/** Shows the icon for the mode you'd switch *to*: ☀ while dark, 🌙 while light. */
export function ThemeToggle() {
  const { dark, toggleDark } = useTheme();

  return (
    <button
      onClick={toggleDark}
      aria-label="Toggle color theme"
      className="p-1.5 text-[17px] text-[var(--muted)] cursor-pointer"
    >
      {dark ? "☀" : "🌙"}
    </button>
  );
}
