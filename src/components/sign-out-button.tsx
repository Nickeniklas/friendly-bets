import { signOut } from "@/app/auth/actions";

/**
 * Small "Sign out" control for the sticky headers on /matches and /leaderboard.
 *
 * It's a plain <form> posting to the `signOut` server action (which clears the
 * Supabase session cookies and redirects to /login) — no client JS needed, so
 * this stays a Server Component. Only render it when there's a logged-in user.
 */
export function SignOutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="cursor-pointer rounded-full border border-[var(--line)] px-3 py-[5px] text-[13px] font-semibold text-[var(--muted)] transition-colors hover:border-[var(--muted)] hover:text-[var(--foreground)]"
      >
        Sign out
      </button>
    </form>
  );
}
