"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/matches", icon: "⚽", label: "Matches" },
  { href: "/leaderboard", icon: "🏆", label: "Leaderboard" },
] as const;

/** Fixed bottom tab bar shared between /matches and /leaderboard. */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 bg-[var(--background)] border-t border-[var(--line)]">
      <div className="mx-auto flex h-[60px] max-w-[600px]">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex-1 flex flex-col items-center justify-center gap-[3px] no-underline"
            >
              <span className="text-xl">{item.icon}</span>
              <span
                className={`text-[10px] font-bold tracking-wide ${
                  active ? "text-[var(--green)]" : "text-[var(--muted)]"
                }`}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
