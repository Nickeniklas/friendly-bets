"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Flag } from "@/components/flag";
import { placeBet, type PlaceBetResult } from "./actions";

// The three pickable outcomes. team1 = home win, team2 = away win, draw = draw.
// (Stored as team1/team2 to match the matches table + openfootball result
// values; shown to players as Home / Draw / Away.)
type Pick = "team1" | "draw" | "team2";

export type ExistingBet = {
  pick: Pick;
  outcome: "won" | "lost" | "refunded" | null;
  pointsAwarded: number;
};

// Share (0–1) of all bets on this match that went to each outcome — used to
// show the crowd split and flag which outcome currently qualifies for the
// underdog bonus (fewer than 33% of bets).
export type Distribution = {
  team1: number;
  draw: number;
  team2: number;
  total: number;
};

const UNDERDOG_THRESHOLD = 0.33;

export function MatchCard({
  matchId,
  stage,
  time,
  statusLabel,
  statusColor,
  homeName,
  awayName,
  homeIsWinner,
  drawIsWinner,
  awayIsWinner,
  distribution,
  bettable,
  loggedIn,
  existingBet,
}: {
  matchId: string;
  stage: string;
  time: string;
  statusLabel: string;
  statusColor: "muted" | "gold";
  homeName: string;
  awayName: string;
  homeIsWinner: boolean;
  drawIsWinner: boolean;
  awayIsWinner: boolean;
  distribution: Distribution;
  bettable: boolean;
  loggedIn: boolean;
  existingBet?: ExistingBet;
}) {
  const [selected, setSelected] = useState<Pick | null>(null);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [betResult, setBetResult] = useState<PlaceBetResult | null>(null);

  const canPick = bettable && loggedIn && !existingBet;

  // Placing a bet returns a status instead of redirecting (see actions.ts), so
  // the result shows as a toast and the page stays put — refreshing just
  // re-fetches this match's distribution/existingBet without navigating, so the
  // user's scroll position is untouched.
  async function handlePlaceBet() {
    if (selected === null || pending) return;
    setPending(true);
    const formData = new FormData();
    formData.set("matchId", matchId);
    formData.set("pick", selected);
    const result = await placeBet(formData);
    setPending(false);
    setBetResult(result);
    if (result.status === "success") {
      setSelected(null);
      router.refresh();
    }
  }

  // Auto-dismiss the toast a few seconds after it appears.
  useEffect(() => {
    if (!betResult) return;
    const timer = setTimeout(() => setBetResult(null), 3000);
    return () => clearTimeout(timer);
  }, [betResult]);

  function toggleSelect(pick: Pick) {
    if (!canPick) return;
    setSelected((prev) => (prev === pick ? null : pick));
  }

  const isConfirmed = !!existingBet && existingBet.outcome === null;
  const hasResult = !!existingBet && existingBet.outcome !== null;
  const showPanel = canPick && selected !== null;

  const pickLabel = (pick: Pick) =>
    pick === "team1" ? homeName : pick === "team2" ? awayName : "Draw";

  // An outcome qualifies for the underdog bonus while it holds fewer than 33%
  // of the bets placed so far. Shown as a hint so players understand the bonus.
  const isUnderdog = (pick: Pick) =>
    distribution.total > 0 &&
    distribution[pick] / distribution.total < UNDERDOG_THRESHOLD;

  return (
    <div className="mb-2.5 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 transition-shadow duration-200 hover:shadow-md">
      {/* Match header */}
      <div className="mb-3.5 flex items-start justify-between">
        <div className="text-[11px] font-medium leading-tight text-[var(--muted)]">{stage}</div>
        <div className="ml-2 shrink-0 text-right">
          <div className="text-[11px] text-[var(--muted)]">{time}</div>
          <div
            className="mt-0.5 text-xs font-semibold"
            style={{ color: statusColor === "gold" ? "var(--gold)" : "var(--muted)" }}
          >
            {statusLabel}
          </div>
        </div>
      </div>

      {/* Three-way outcome buttons: Home win / Draw / Away win */}
      <div className="flex gap-2">
        <OutcomeButton
          kind="team"
          teamName={homeName}
          selected={canPick && selected === "team1"}
          flagged={homeIsWinner || existingBet?.pick === "team1"}
          isWinner={homeIsWinner}
          disabled={!canPick}
          onClick={() => toggleSelect("team1")}
        />
        <OutcomeButton
          kind="draw"
          selected={canPick && selected === "draw"}
          flagged={drawIsWinner || existingBet?.pick === "draw"}
          isWinner={drawIsWinner}
          disabled={!canPick}
          onClick={() => toggleSelect("draw")}
        />
        <OutcomeButton
          kind="team"
          teamName={awayName}
          selected={canPick && selected === "team2"}
          flagged={awayIsWinner || existingBet?.pick === "team2"}
          isWinner={awayIsWinner}
          disabled={!canPick}
          onClick={() => toggleSelect("team2")}
        />
      </div>

      {/* Crowd split — how everyone has picked so far. Doubles as the underdog
          hint: any outcome under 33% earns the correct-pick bonus. */}
      {distribution.total > 0 && (
        <div className="mt-2.5 text-[11px] leading-snug text-[var(--muted)]">
          {Math.round((distribution.team1 / distribution.total) * 100)}% {homeName} ·{" "}
          {Math.round((distribution.draw / distribution.total) * 100)}% Draw ·{" "}
          {Math.round((distribution.team2 / distribution.total) * 100)}% {awayName}
        </div>
      )}

      {/* "Bets open" hint — shown until an outcome is picked, so the card itself
          explains that betting is available even if someone skipped the "How to
          play" card. */}
      {bettable && !existingBet && selected === null && (
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--line)] pt-3">
          <div className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--green-text)]">
            <span className="inline-block h-2 w-2 rounded-full bg-[var(--green)]" />
            <span>Bets open{loggedIn ? " — tap an outcome to predict" : ""}</span>
          </div>
          {!loggedIn && (
            <Link href="/login" className="shrink-0 text-xs underline text-[var(--muted)]">
              Log in to bet
            </Link>
          )}
        </div>
      )}

      {/* Confirm panel — no stake to choose, just confirm the pick. */}
      {showPanel && selected && (
        <div
          className="mt-3.5 border-t border-[var(--line)] pt-3.5"
          style={{ animation: "bet-in 0.2s ease" }}
        >
          <div className="mb-1 text-[13px] font-semibold">
            Predict: {pickLabel(selected)}
          </div>
          <div className="mb-3.5 text-xs leading-relaxed text-[var(--muted)]">
            Correct: +10 pts{isUnderdog(selected) ? " +5 underdog = +15 pts" : ""} · Wrong: −5 pts
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSelected(null)}
              disabled={pending}
              className="flex-1 cursor-pointer rounded-[10px] border-[1.5px] border-[var(--line)] bg-transparent p-[13px] text-sm font-medium text-[var(--muted)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handlePlaceBet}
              disabled={pending}
              className="flex-[2] cursor-pointer rounded-[10px] border-none bg-[var(--green)] p-[13px] text-sm font-semibold text-white disabled:opacity-50"
            >
              {pending ? "Placing..." : "Place pick →"}
            </button>
          </div>
        </div>
      )}

      {/* Confirmed bet, no result yet */}
      {isConfirmed && existingBet && (
        <div className="mt-3 flex items-center justify-between border-t border-[var(--line)] pt-3">
          <div className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--green-text)]">
            <span>✓</span>
            <span>Predicted — {pickLabel(existingBet.pick)}</span>
          </div>
        </div>
      )}

      {/* Result */}
      {hasResult && existingBet && (
        <ResultRow existingBet={existingBet} pickName={pickLabel(existingBet.pick)} />
      )}

      {/* Bet-placement toast — fixed above the bottom nav, self-dismissing. */}
      {betResult && (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-[76px] z-50 flex justify-center px-4"
          aria-live="polite"
        >
          <div
            className="rounded-full px-4 py-2 text-sm font-semibold text-white shadow-lg"
            style={{ background: betResult.status === "success" ? "var(--green)" : "var(--red)" }}
          >
            {betResult.status === "success" ? "✓ " : ""}
            {betResult.message}
          </div>
        </div>
      )}
    </div>
  );
}

/** One of the three outcome buttons (a team, or the central Draw option). */
function OutcomeButton({
  kind,
  teamName,
  selected,
  flagged,
  isWinner,
  disabled,
  onClick,
}: {
  kind: "team" | "draw";
  teamName?: string;
  selected: boolean;
  flagged: boolean;
  isWinner: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const highlighted = selected || flagged;
  const canPick = !disabled;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: highlighted ? "var(--green-bg)" : "var(--surface-2)",
        borderColor: selected ? "var(--green)" : flagged ? "var(--green-dim)" : "var(--line)",
        color: highlighted ? "var(--green-text)" : "var(--foreground)",
      }}
      className={[
        "min-w-0 flex-1 rounded-xl border-[1.5px] p-[14px_10px_12px] text-left transition-all duration-150 disabled:cursor-default",
        canPick ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-md" : "",
      ].join(" ")}
    >
      {kind === "team" ? (
        <Flag team={teamName ?? ""} width={28} className="mb-2" />
      ) : (
        <div className="mb-2 text-[22px] leading-none">🤝</div>
      )}
      <div className="overflow-hidden truncate text-[13px] font-semibold leading-tight">
        {kind === "team" ? teamName : "Draw"}
      </div>
      {isWinner && (
        <div className="mt-[5px] text-[11px] font-semibold text-[var(--green)]">Winner ✓</div>
      )}
    </button>
  );
}

function ResultRow({ existingBet, pickName }: { existingBet: ExistingBet; pickName: string }) {
  let icon: string;
  let color: string;
  let label: string;

  if (existingBet.outcome === "won") {
    icon = "✓";
    color = "var(--green-text)";
    label = `Correct! +${existingBet.pointsAwarded} pts — you predicted ${pickName}`;
  } else if (existingBet.outcome === "lost") {
    icon = "✗";
    color = "var(--red)";
    label = `Wrong — ${existingBet.pointsAwarded} pts — you predicted ${pickName}`;
  } else {
    // Legacy refunded bets from the old staking model — should not occur for
    // new bets, but render gracefully if any historical rows remain.
    icon = "↩";
    color = "var(--gold)";
    label = `Refunded — your prediction was ${pickName}`;
  }

  return (
    <div className="mt-3 flex items-center gap-2 border-t border-[var(--line)] pt-3">
      <span className="shrink-0 text-sm font-bold" style={{ color }}>
        {icon}
      </span>
      <span className="text-[13px] font-medium leading-snug" style={{ color }}>
        {label}
      </span>
    </div>
  );
}
