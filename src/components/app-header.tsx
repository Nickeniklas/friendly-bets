import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignOutButton } from "@/components/sign-out-button";

/**
 * The shared sticky top bar used by /matches and /leaderboard: the brand on
 * the left, then (optionally) page-specific controls, the theme toggle, and a
 * sign-out button when logged in on the right.
 *
 * `children` is the page-specific right-side slot rendered just before the
 * theme toggle — /matches passes its points pill here; /leaderboard passes
 * nothing. This is a server component (no interactivity of its own); the
 * controls it renders (ThemeToggle, SignOutButton) are the client pieces.
 */
export function AppHeader({
  loggedIn,
  children,
}: {
  loggedIn: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--background)]">
      <div className="mx-auto flex h-14 max-w-[600px] items-center justify-between px-4">
        <div className="flex items-center gap-2 text-base font-bold">
          <span>⚽</span>
          <span>Friendly Bets</span>
        </div>
        <div className="flex items-center gap-2">
          {children}
          <ThemeToggle />
          {loggedIn && <SignOutButton />}
        </div>
      </div>
    </div>
  );
}
