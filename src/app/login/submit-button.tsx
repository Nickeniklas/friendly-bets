"use client";

import { useFormStatus } from "react-dom";

/**
 * Submit button for the magic-link form. `useFormStatus` only works inside
 * a Client Component that's a descendant of the <form>, which is why this
 * is split out from the (Server Component) login page.
 *
 * Sending the magic link is a real network round-trip to Supabase, so
 * without this the button just sits there looking unresponsive — easy to
 * click twice. Disabling it and swapping the label to "Sending..." gives
 * instant feedback and stops a double-click from firing two requests.
 */
export function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full cursor-pointer rounded-xl bg-[var(--green)] px-4 py-4 text-base font-semibold tracking-[-0.2px] text-white transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:shadow-sm disabled:cursor-default disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
    >
      {pending ? "Sending..." : "Send magic link →"}
    </button>
  );
}
