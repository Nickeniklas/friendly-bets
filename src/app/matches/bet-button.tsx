"use client";

import { useFormStatus } from "react-dom";

/**
 * Submit button for the bet form. Same idea as the login submit button:
 * placing a bet is a real round-trip (insert + DB triggers), so without a
 * pending state the button looks unresponsive and invites a double-click —
 * which would hit the "one bet per match" unique constraint and show a
 * confusing error. Disabling it and showing "Placing..." gives instant
 * feedback and prevents that.
 */
export function BetButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-foreground px-2 py-1 text-background disabled:opacity-50"
    >
      {pending ? "Placing..." : "Bet"}
    </button>
  );
}
