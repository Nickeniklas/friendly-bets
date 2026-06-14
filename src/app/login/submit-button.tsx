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
      className="w-full rounded-xl bg-[var(--green)] px-4 py-4 text-base font-semibold tracking-[-0.2px] text-white disabled:opacity-50"
    >
      {pending ? "Sending..." : "Send magic link →"}
    </button>
  );
}
