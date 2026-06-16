import Link from "next/link";
import { signInWithMagicLink } from "./actions";
import { SubmitButton } from "./submit-button";
import { GoogleButton } from "./google-button";
import { ThemeTogglePill } from "./theme-toggle-pill";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; error?: string }>;
}) {
  const { message, error } = await searchParams;

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-5 py-8">
      <div className="mb-9 text-center">
        <div className="mb-[14px] text-[48px] leading-none">⚽</div>
        <div className="text-[26px] font-bold tracking-[-0.6px]">Friendly Bets</div>
        <div className="mt-1.5 text-[12px] font-semibold tracking-[0.1em] text-[var(--green)] uppercase">
          World Cup 2026
        </div>
      </div>

      <div className="w-full max-w-[420px] rounded-[20px] border border-[var(--line)] bg-[var(--surface)] px-6 py-7">
        <h2 className="mb-1.5 text-[19px] font-bold tracking-[-0.3px]">Sign in</h2>
        <p className="mb-6 text-sm leading-[1.55] text-[var(--muted)]">
          Enter your email — we&apos;ll send a magic sign-in link. No password needed.
        </p>

        <form action={signInWithMagicLink} className="flex flex-col gap-2.5">
          <input
            type="email"
            name="email"
            required
            placeholder="your@email.com"
            className="block w-full rounded-xl border-[1.5px] border-[var(--line)] bg-[var(--input-bg)] px-4 py-[15px] text-base text-[var(--foreground)] outline-none"
          />

          <SubmitButton />
        </form>

        {/* "or" divider between the two sign-in options */}
        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-[var(--line)]" />
          <span className="text-[12px] font-semibold tracking-[0.08em] text-[var(--muted)] uppercase">
            or
          </span>
          <div className="h-px flex-1 bg-[var(--line)]" />
        </div>

        <GoogleButton />

        {message && (
          <p className="mt-3 text-sm text-[var(--green-text)]">{message}</p>
        )}
        {error && <p className="mt-3 text-sm text-[var(--red)]">{error}</p>}

        <div className="mt-5 rounded-xl border-[1.5px] border-[var(--warn-border)] bg-[var(--warn-bg)] p-4">
          <div className="mb-3 text-[11px] font-bold tracking-[0.07em] text-[var(--gold)] uppercase">
            Heads up
          </div>
          <div className="flex flex-col gap-[11px]">
            <div className="flex items-start gap-3">
              <span className="shrink-0 text-[18px] leading-[1.3]">📩</span>
              <span className="text-[13px] leading-[1.5] text-[var(--muted)]">
                <strong className="font-semibold text-[var(--foreground)]">
                  Check spam / junk
                </strong>{" "}
                — the link often lands there
              </span>
            </div>
            <div className="flex items-start gap-3">
              <span className="shrink-0 text-[18px] leading-[1.3]">⏱</span>
              <span className="text-[13px] leading-[1.5] text-[var(--muted)]">
                The link expires in{" "}
                <strong className="font-semibold text-[var(--foreground)]">
                  1 minute
                </strong>{" "}
                — click it quickly
              </span>
            </div>
            <div className="flex items-start gap-3">
              <span className="shrink-0 text-[18px] leading-[1.3]">☝️</span>
              <span className="text-[13px] leading-[1.5] text-[var(--muted)]">
                <strong className="font-semibold text-[var(--foreground)]">
                  Press once only
                </strong>{" "}
                — sending it twice won&apos;t help
              </span>
            </div>
          </div>
        </div>

        {/* Let people browse the app without an account — /matches and
            /leaderboard are public (read-only without login). They can sign in
            later when they want to predict. */}
        <Link
          href="/matches"
          className="mt-4 block text-center text-sm font-semibold text-[var(--muted)] underline-offset-4 hover:text-[var(--foreground)] hover:underline"
        >
          View matches as guest →
        </Link>
      </div>

      <ThemeTogglePill />
    </div>
  );
}
