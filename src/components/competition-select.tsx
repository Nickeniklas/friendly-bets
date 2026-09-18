"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Competition } from "@/lib/competitions";
import { setSelectedCompetition } from "@/lib/competition-actions";

/**
 * Header dropdown for switching competition (World Cup / Liiga / ...).
 *
 * On change it calls a Server Action that stores the choice in the
 * `fb-competition` cookie, then router.refresh()es so the current page
 * re-renders server-side for the new competition. `useTransition` gives us the
 * pending flag (per the "disable while pending" convention in CLAUDE.md) —
 * it stays true until the refreshed page has arrived.
 */
export function CompetitionSelect({
  competitions,
  selectedId,
}: {
  competitions: Pick<Competition, "id" | "name">[];
  selectedId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <select
      aria-label="Competition"
      value={selectedId}
      disabled={pending}
      onChange={(e) => {
        const id = e.target.value;
        startTransition(async () => {
          await setSelectedCompetition(id);
          router.refresh();
        });
      }}
      className="max-w-[9.5rem] cursor-pointer truncate rounded-full border border-[var(--line)] bg-[var(--surface-2)] py-[5px] pr-2 pl-3 text-[13px] font-semibold text-[var(--foreground)] outline-none disabled:cursor-wait disabled:opacity-60"
    >
      {competitions.map((c) => (
        <option key={c.id} value={c.id}>
          {pending && c.id === selectedId ? "Switching…" : c.name}
        </option>
      ))}
    </select>
  );
}
