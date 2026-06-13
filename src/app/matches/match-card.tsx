"use client";

import { useState } from "react";
import Link from "next/link";
import { Flag } from "@/components/flag";
import { placeBet } from "./actions";
import { PlaceBetButton } from "./place-bet-button";

const AMOUNT_OPTIONS = [50, 100, 200, 500];

type Pick = "team1" | "team2";

export type ExistingBet = {
  pick: Pick;
  stake: number;
  outcome: "won" | "lost" | "refunded" | null;
  payout: number | null;
};

export function MatchCard({
  matchId,
  stage,
  time,
  statusLabel,
  statusColor,
  homeName,
  awayName,
  homeIsWinner,
  awayIsWinner,
  poolInfo,
  multipliers,
  bettable,
  loggedIn,
  balance,
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
  awayIsWinner: boolean;
  poolInfo: string;
  multipliers: { team1: number | null; team2: number | null };
  bettable: boolean;
  loggedIn: boolean;
  balance: number | null;
  existingBet?: ExistingBet;
}) {
  const [selected, setSelected] = useState<Pick | null>(null);
  const [amount, setAmount] = useState(100);

  const canPick = bettable && loggedIn && !existingBet;

  function toggleSelect(pick: Pick) {
    if (!canPick) return;
    setSelected((prev) => (prev === pick ? null : pick));
  }

  const homeActive = canPick && selected === "team1";
  const awayActive = canPick && selected === "team2";
  const homeFlagged = homeIsWinner || existingBet?.pick === "team1";
  const awayFlagged = awayIsWinner || existingBet?.pick === "team2";
  const homeHighlighted = homeActive || homeFlagged;
  const awayHighlighted = awayActive || awayFlagged;

  const teamStyle = (active: boolean, flagged: boolean, highlighted: boolean) => ({
    background: highlighted ? "var(--green-bg)" : "var(--surface-2)",
    borderColor: active ? "var(--green)" : flagged ? "var(--green-dim)" : "var(--line)",
    color: highlighted ? "var(--green-text)" : "var(--foreground)",
  });

  const showPanel = canPick && selected !== null;
  const selectedTeamName = selected === "team1" ? homeName : selected === "team2" ? awayName : "";
  const selectedMultiplier = selected === "team1" ? multipliers.team1 : selected === "team2" ? multipliers.team2 : null;
  const potentialWinLabel = selectedMultiplier !== null ? `${Math.round(amount * selectedMultiplier)} pts` : "TBD";

  const isConfirmed = !!existingBet && existingBet.outcome === null;
  const hasResult = !!existingBet && existingBet.outcome !== null;
  const betTeamName = existingBet?.pick === "team1" ? homeName : awayName;

  return (
    <div className="mb-2.5 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
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

      {/* Team buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => toggleSelect("team1")}
          disabled={!canPick}
          style={teamStyle(homeActive, homeFlagged, homeHighlighted)}
          className="min-w-0 flex-1 rounded-xl border-[1.5px] p-[14px_10px_12px] text-left transition-all duration-150 disabled:cursor-default"
        >
          <Flag team={homeName} width={28} className="mb-2" />
          <div className="overflow-hidden truncate text-[13px] font-semibold leading-tight">{homeName}</div>
          {homeIsWinner && (
            <div className="mt-[5px] text-[11px] font-semibold text-[var(--green)]">Winner ✓</div>
          )}
        </button>

        <div className="flex shrink-0 items-center px-0.5 text-[10px] font-bold tracking-wider text-[var(--muted)]">
          VS
        </div>

        <button
          onClick={() => toggleSelect("team2")}
          disabled={!canPick}
          style={teamStyle(awayActive, awayFlagged, awayHighlighted)}
          className="min-w-0 flex-1 rounded-xl border-[1.5px] p-[14px_10px_12px] text-left transition-all duration-150 disabled:cursor-default"
        >
          <Flag team={awayName} width={28} className="mb-2" />
          <div className="overflow-hidden truncate text-[13px] font-semibold leading-tight">{awayName}</div>
          {awayIsWinner && (
            <div className="mt-[5px] text-[11px] font-semibold text-[var(--green)]">Winner ✓</div>
          )}
        </button>
      </div>

      {/* Pool info */}
      <div className="mt-2.5 text-[11px] leading-snug text-[var(--muted)]">{poolInfo}</div>

      {bettable && !loggedIn && !existingBet && (
        <Link href="/login" className="mt-2 inline-block text-xs underline text-[var(--muted)]">
          Log in to bet
        </Link>
      )}

      {/* Bet panel */}
      {showPanel && (
        <div
          className="mt-3.5 border-t border-[var(--line)] pt-3.5"
          style={{ animation: "bet-in 0.2s ease" }}
        >
          <div className="mb-3 text-[13px] font-semibold">Bet on {selectedTeamName}</div>
          <div className="mb-3 flex gap-1.5">
            {AMOUNT_OPTIONS.map((opt) => {
              const isSelected = amount === opt;
              const disabled = balance !== null && opt > balance;
              return (
                <button
                  key={opt}
                  onClick={() => setAmount(opt)}
                  disabled={disabled}
                  style={{
                    background: isSelected ? "var(--green-bg)" : "var(--surface-2)",
                    borderColor: isSelected ? "var(--green)" : "var(--line)",
                    color: isSelected ? "var(--green-text)" : "var(--muted)",
                  }}
                  className="flex-1 rounded-lg border-[1.5px] p-[10px_4px] text-xs font-semibold whitespace-nowrap transition-all duration-100 disabled:opacity-50"
                >
                  {opt} pts
                </button>
              );
            })}
          </div>
          <div className="mb-3.5 text-xs leading-relaxed text-[var(--muted)]">
            {poolInfo} · Potential win: {potentialWinLabel}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="flex-1 cursor-pointer rounded-[10px] border-[1.5px] border-[var(--line)] bg-transparent p-[13px] text-sm font-medium text-[var(--muted)]"
            >
              Cancel
            </button>
            <form action={placeBet} className="flex-[2]">
              <input type="hidden" name="matchId" value={matchId} />
              <input type="hidden" name="pick" value={selected ?? ""} />
              <input type="hidden" name="stake" value={amount} />
              <PlaceBetButton />
            </form>
          </div>
        </div>
      )}

      {/* Confirmed bet, no result yet */}
      {isConfirmed && existingBet && (
        <div className="mt-3 flex items-center justify-between border-t border-[var(--line)] pt-3">
          <div className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--green-text)]">
            <span>✓</span>
            <span>
              Bet placed — {existingBet.stake} pts on {betTeamName}
            </span>
          </div>
        </div>
      )}

      {/* Result */}
      {hasResult && existingBet && (
        <ResultRow existingBet={existingBet} betTeamName={betTeamName} />
      )}
    </div>
  );
}

function ResultRow({ existingBet, betTeamName }: { existingBet: ExistingBet; betTeamName: string }) {
  let icon: string;
  let color: string;
  let label: string;

  if (existingBet.outcome === "won") {
    icon = "✓";
    color = "var(--green-text)";
    label = `Won +${existingBet.payout} pts — your ${existingBet.stake} pts on ${betTeamName}`;
  } else if (existingBet.outcome === "lost") {
    icon = "✗";
    color = "var(--red)";
    label = `Lost — your ${existingBet.stake} pts on ${betTeamName}`;
  } else {
    icon = "↩";
    color = "var(--gold)";
    label = `Refunded — ${existingBet.stake} pts on ${betTeamName} returned`;
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
