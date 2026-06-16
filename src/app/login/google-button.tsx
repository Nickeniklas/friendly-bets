"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * "Sign in with Google" button.
 *
 * OAuth has to start from the *browser* (it triggers a full-page redirect to
 * Google's consent screen), so this is a Client Component using the browser
 * Supabase client — unlike the magic-link form, which is a server action.
 *
 * `signInWithOAuth` lands the user back at `redirectTo` with a `?code=...`
 * param, exactly like the magic link does. Our existing /auth/confirm route
 * already calls `exchangeCodeForSession` for that code, so it handles the
 * OAuth return with no extra work.
 *
 * `redirectTo` is built from `window.location.origin` so it's automatically
 * correct per-environment (localhost in dev, the Vercel URL in prod) without
 * hardcoding — note this is the browser's origin, not NEXT_PUBLIC_SITE_URL
 * (which the server-only magic-link action uses). Both must be listed under
 * Supabase Auth → URL Configuration → Redirect URLs.
 *
 * Like the magic-link submit button, we disable + relabel while the redirect
 * is in flight so a slow round-trip doesn't look unresponsive or invite a
 * double-click.
 */
export function GoogleButton() {
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    const supabase = createClient();

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/confirm`,
      },
    });

    // On success the browser is already navigating to Google, so we only
    // reach here (and need to re-enable the button) if starting OAuth failed.
    if (error) {
      setPending(false);
      window.location.href = `/login?error=${encodeURIComponent(error.message)}`;
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="flex w-full cursor-pointer items-center justify-center gap-3 rounded-xl border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-4 py-[15px] text-base font-semibold tracking-[-0.2px] text-[var(--foreground)] transition-all duration-150 hover:-translate-y-0.5 hover:border-[var(--muted)] hover:bg-[var(--surface-2)] hover:shadow-md active:translate-y-0 active:shadow-sm disabled:cursor-default disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:border-[var(--line)] disabled:hover:bg-[var(--surface)] disabled:hover:shadow-none"
    >
      {/* Google "G" logo, inline SVG so it needs no extra asset/network fetch */}
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
        />
        <path
          fill="#34A853"
          d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
        />
        <path
          fill="#FBBC05"
          d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        />
        <path
          fill="#EA4335"
          d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        />
      </svg>
      {pending ? "Redirecting..." : "Sign in with Google"}
    </button>
  );
}
