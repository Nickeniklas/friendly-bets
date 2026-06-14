"use client";

import { useFormStatus } from "react-dom";

/** Submit button for the bet panel's "Place bet" form — see CLAUDE.md Gotchas
 * ("Convention: any <form action=...>...") for why this needs a pending state. */
export function PlaceBetButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="flex-[2] cursor-pointer rounded-[10px] border-none bg-[var(--green)] p-[13px] text-sm font-semibold text-white disabled:opacity-50"
    >
      {pending ? "Placing..." : "Place bet →"}
    </button>
  );
}
