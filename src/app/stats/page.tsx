import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";
import { StatsView } from "@/components/stats-view";
import {
  related,
  computePersonalStats,
  computeCrowdFacts,
  computeRecords,
  type Pick,
  type StatsBet,
  type CrowdCount,
  type PersonalStats,
  type CrowdFacts,
  type Records,
  type RecordEntry,
  type Call,
  type MatchSplit,
} from "@/lib/stats";

// --- Raw Supabase row shapes (to-one joins may come back as object or array,
//     hence `related()` to normalize). ---------------------------------------

type BetRow = {
  user_id: string;
  pick: Pick;
  points_awarded: number;
  outcome: "won" | "lost";
  placed_at: string;
  matches:
    | { id: string; stage: string; team1: string; team2: string; result: Pick | null; kickoff_at: string }
    | { id: string; stage: string; team1: string; team2: string; result: Pick | null; kickoff_at: string }[]
    | null;
  profiles: { display_name: string | null } | { display_name: string | null }[] | null;
};

type CountRow = {
  match_id: string;
  team1: number;
  draw: number;
  team2: number;
  matches:
    | { result: Pick | null; team1: string; team2: string; stage: string }
    | { result: Pick | null; team1: string; team2: string; stage: string }[]
    | null;
};

type ProfileRow = { id: string; display_name: string | null; points_balance: number };

// ============================  shared UI bits  ==============================

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="mb-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <h2 className="mb-1 text-[15px] font-bold">{title}</h2>
      {hint && <p className="mb-3 text-xs text-[var(--muted)]">{hint}</p>}
      <div className={hint ? "" : "mt-3"}>{children}</div>
    </section>
  );
}

/** A small metric tile (big value + label) for the overview grid. */
function Tile({ value, label, accent }: { value: string; label: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 text-center">
      <div className="text-[22px] font-bold leading-tight" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px] font-medium tracking-wide text-[var(--muted)] uppercase">
        {label}
      </div>
    </div>
  );
}

/** Label on the left, a proportional bar, and a value on the right. */
function BarRow({ label, pct, value }: { label: string; pct: number; value: string }) {
  return (
    <div className="mb-2.5 last:mb-0">
      <div className="mb-1 flex items-baseline justify-between text-[13px]">
        <span className="font-medium">{label}</span>
        <span className="text-[var(--muted)]">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, Math.max(2, pct))}%`, background: "var(--green)" }}
        />
      </div>
    </div>
  );
}

/** A simple "stat name → value" line. */
function StatLine({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--line)] py-2.5 text-sm last:border-0">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="font-semibold" style={accent ? { color: accent } : undefined}>
        {value}
      </span>
    </div>
  );
}

function pointsColor(points: number): string {
  return points > 0 ? "var(--green-text)" : points < 0 ? "var(--red)" : "var(--muted)";
}

function signed(points: number): string {
  return points > 0 ? `+${points}` : `${points}`;
}

// ==============================  "You" section  =============================

function CallList({ calls }: { calls: Call[] }) {
  if (calls.length === 0) return <p className="text-sm text-[var(--muted)]">Nothing here yet.</p>;
  return (
    <div>
      {calls.map((c, i) => (
        <div
          key={i}
          className="flex items-center justify-between border-b border-[var(--line)] py-2.5 last:border-0"
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{c.label}</div>
            <div className="text-xs text-[var(--muted)]">{c.detail}</div>
          </div>
          <span className="ml-3 shrink-0 text-sm font-bold" style={{ color: pointsColor(c.points) }}>
            {signed(c.points)} pts
          </span>
        </div>
      ))}
    </div>
  );
}

const PICK_NAMES: Record<Pick, string> = { team1: "Home win", draw: "Draw", team2: "Away win" };

function YouSection({ stats }: { stats: PersonalStats }) {
  if (stats.totalPredictions === 0) {
    return (
      <p className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 text-center text-sm text-[var(--muted)]">
        You don’t have any settled predictions yet. Make some picks on the Matches tab —
        your personal stats appear here once those matches finish.
      </p>
    );
  }

  return (
    <div>
      {/* Overview tiles */}
      <div className="mb-4 grid grid-cols-3 gap-2">
        <Tile value={signed(stats.totalPoints)} label="Points" accent={pointsColor(stats.totalPoints)} />
        <Tile value={`#${stats.rank}`} label={`of ${stats.totalPlayers}`} />
        <Tile value={`${stats.winRate}%`} label="Win rate" />
        <Tile value={stats.currentStreak > 0 ? `🔥 ${stats.currentStreak}` : "—"} label="Streak" />
        <Tile value={`${stats.bestStreak}`} label="Best streak" />
        <Tile value={`${stats.totalPredictions}`} label="Predictions" />
      </div>

      <Card title="Accuracy by stage" hint="How often you’ve been right in each round you predicted.">
        {stats.byStage.map((s) => (
          <BarRow
            key={s.stage}
            label={s.label}
            pct={s.winRate}
            value={`${s.winRate}% · ${s.correct}/${s.total}`}
          />
        ))}
      </Card>

      <Card title="Your pick tendencies" hint="Which outcomes you reach for, and how they pan out.">
        {stats.picks.map((p) => (
          <BarRow
            key={p.pick}
            label={PICK_NAMES[p.pick]}
            pct={stats.totalPredictions === 0 ? 0 : (p.count / stats.totalPredictions) * 100}
            value={
              p.count === 0
                ? "never"
                : `${p.count}× · ${p.winRate}% won`
            }
          />
        ))}
      </Card>

      <Card title="With or against the crowd" hint="Your record when you side with the majority vs. go your own way.">
        <StatLine
          label={`With the crowd (${stats.withCrowdCount})`}
          value={`${stats.withCrowdWinRate}% won`}
        />
        <StatLine
          label={`Against the crowd (${stats.contrarianCount})`}
          value={`${stats.contrarianWinRate}% won`}
        />
        <StatLine label="Underdog calls landed (+15)" value={`${stats.underdogHits}`} accent="var(--gold)" />
      </Card>

      <Card title="Where you stand" hint="How you compare to the rest of the field.">
        <StatLine label="Win rate beats" value={`${stats.winRateBeatsPct}% of players`} />
        <StatLine
          label="Underdog calls"
          value={`#${stats.underdogRank} of ${stats.totalPlayers}`}
        />
      </Card>

      <Card title="Best calls">
        <CallList calls={stats.bestCalls} />
      </Card>

      <Card title="Toughest calls">
        <CallList calls={stats.worstCalls} />
      </Card>
    </div>
  );
}

function LoginCta() {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 text-center">
      <div className="mb-2 text-3xl">📈</div>
      <h2 className="mb-1 text-base font-bold">See how you stack up</h2>
      <p className="mb-4 text-sm text-[var(--muted)]">
        Log in to unlock your personal stats — accuracy by round, your pick tendencies,
        contrarian record, best calls and where you rank.
      </p>
      <Link
        href="/login"
        className="inline-block rounded-full bg-[var(--green)] px-5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
      >
        Log in
      </Link>
    </div>
  );
}

// =============================  "Crowd" section  ============================

/** A match's 3-way pick split as a stacked bar with a result marker. */
function SplitCard({ m, caption }: { m: MatchSplit; caption: ReactNode }) {
  const seg = (n: number) => (m.total === 0 ? 0 : (n / m.total) * 100);
  const parts: { key: Pick; label: string; pct: number; color: string }[] = [
    { key: "team1", label: "Home", pct: seg(m.team1), color: "var(--green)" },
    { key: "draw", label: "Draw", pct: seg(m.draw), color: "var(--muted)" },
    { key: "team2", label: "Away", pct: seg(m.team2), color: "var(--gold)" },
  ];
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="truncate text-sm font-semibold">{m.label}</span>
        {m.result && (
          <span className="ml-2 shrink-0 text-xs text-[var(--muted)]">
            Result: {m.result === "draw" ? "Draw" : m.result === "team1" ? "Home" : "Away"}
          </span>
        )}
      </div>
      <div className="mb-1.5 flex h-3 overflow-hidden rounded-full">
        {parts.map((p) => (
          <div key={p.key} style={{ width: `${p.pct}%`, background: p.color }} />
        ))}
      </div>
      <div className="text-xs text-[var(--muted)]">{caption}</div>
    </div>
  );
}

function CrowdSection({ facts }: { facts: CrowdFacts }) {
  if (facts.settledCount === 0) {
    return (
      <p className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 text-center text-sm text-[var(--muted)]">
        No settled matches with predictions yet — crowd facts will appear here as results
        come in.
      </p>
    );
  }

  const pct = (n: number) => `${Math.round(n)}%`;

  return (
    <div>
      <Card title="Wisdom of the crowd" hint="How often the majority pick turned out right.">
        <div className="flex items-end gap-3">
          <div className="text-[34px] font-bold leading-none text-[var(--green-text)]">
            {facts.crowdAccuracyPct}%
          </div>
          <div className="pb-1 text-sm text-[var(--muted)]">
            of {facts.settledCount} settled match{facts.settledCount === 1 ? "" : "es"}
          </div>
        </div>
      </Card>

      {facts.biggestUpset && (
        <Card title="Biggest upset" hint="The result the fewest of us saw coming.">
          <SplitCard
            m={facts.biggestUpset}
            caption={`Only ${pct(facts.biggestUpset.resultShare * 100)} backed the actual result.`}
          />
        </Card>
      )}

      {facts.mostDivisive && (
        <Card title="Most divisive match" hint="Where the group split most evenly.">
          <SplitCard
            m={facts.mostDivisive}
            caption={`${facts.mostDivisive.total} predictions, almost three ways.`}
          />
        </Card>
      )}

      {facts.strongestConsensus && (
        <Card title="Strongest consensus" hint="Where we agreed the most.">
          <SplitCard
            m={facts.strongestConsensus}
            caption={
              facts.strongestConsensus.crowdCorrect
                ? "…and the crowd was right. ✅"
                : "…but the crowd got it wrong. ❌"
            }
          />
        </Card>
      )}

      <Card title="Are we draw-shy?" hint="Draws are easy to overlook — are we underbacking them?">
        <StatLine label="Of our picks were draws" value={pct(facts.drawPickPct)} />
        <StatLine label="Of matches actually drew" value={pct(facts.actualDrawPct)} />
      </Card>

      {facts.fanFavourite && (
        <Card title="Fan favourite">
          <StatLine
            label="Most-backed team to win"
            value={`${facts.fanFavourite.team} (${facts.fanFavourite.backed})`}
            accent="var(--green-text)"
          />
        </Card>
      )}
    </div>
  );
}

// ============================  "Records" section  ==========================

function RecordCard({ title, emoji, entry }: { title: string; emoji: string; entry: RecordEntry }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="text-2xl">{emoji}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-bold tracking-wide text-[var(--muted)] uppercase">{title}</div>
        {entry ? (
          <>
            <div className="truncate text-sm font-semibold">{entry.name}</div>
            <div className="text-xs text-[var(--muted)]">
              {entry.value}
              {entry.sub ? ` · ${entry.sub}` : ""}
            </div>
          </>
        ) : (
          <div className="text-sm text-[var(--muted)]">No qualifier yet</div>
        )}
      </div>
    </div>
  );
}

function RecordsSection({ records }: { records: Records }) {
  return (
    <div className="grid gap-3">
      <RecordCard title="Longest win streak" emoji="🔥" entry={records.longestStreak} />
      <RecordCard title="Biggest single-round haul" emoji="💰" entry={records.biggestHaul} />
      <RecordCard title="Best underdog hunter" emoji="🐺" entry={records.underdogHunter} />
      <RecordCard title="Most accurate" emoji="🎯" entry={records.mostAccurate} />
      <RecordCard title="Most predictions placed" emoji="📊" entry={records.mostPredictions} />
      <RecordCard title="Sharpest contrarian" emoji="🧠" entry={records.sharpestContrarian} />
      <p className="px-1 text-xs text-[var(--muted)]">
        Rate-based records (most accurate, sharpest contrarian) need at least 5 settled
        predictions to qualify.
      </p>
    </div>
  );
}

// ================================  page  ====================================

export default async function StatsPage() {
  // RLS allows everyone (incl. guests) to read bets, matches and the crowd
  // view, so the Crowd + Records sections work logged-out; only the personal
  // "You" section is gated below.
  const supabase = await createClient();

  const [
    {
      data: { user },
    },
    { data: betsData, error: betsError },
    { data: countsData, error: countsError },
    { data: profilesData, error: profilesError },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("bets")
      .select(
        "user_id, pick, points_awarded, outcome, placed_at, matches!inner(id, stage, team1, team2, result, kickoff_at), profiles!inner(display_name)"
      )
      .in("outcome", ["won", "lost"]),
    supabase
      .from("match_bet_counts")
      .select("match_id, team1, draw, team2, matches!inner(result, team1, team2, stage)"),
    supabase
      .from("profiles")
      .select("id, display_name, points_balance")
      .order("points_balance", { ascending: false }),
  ]);

  if (betsError || countsError || profilesError) {
    return (
      <div className="p-8 text-red-600">
        Failed to load stats: {(betsError ?? countsError ?? profilesError)?.message}
      </div>
    );
  }

  // Flatten the Supabase joins into the plain shapes src/lib/stats.ts expects.
  const bets: StatsBet[] = ((betsData ?? []) as unknown as BetRow[]).flatMap((b) => {
    const m = related(b.matches);
    const p = related(b.profiles);
    if (!m) return [];
    return [
      {
        user_id: b.user_id,
        display_name: p?.display_name ?? null,
        pick: b.pick,
        points_awarded: b.points_awarded,
        outcome: b.outcome,
        placed_at: b.placed_at,
        matchId: m.id,
        stage: m.stage,
        team1: m.team1,
        team2: m.team2,
        result: m.result,
      },
    ];
  });

  const counts: CrowdCount[] = ((countsData ?? []) as unknown as CountRow[]).flatMap((c) => {
    const m = related(c.matches);
    if (!m) return [];
    return [
      {
        matchId: c.match_id,
        team1: c.team1,
        draw: c.draw,
        team2: c.team2,
        result: m.result,
        matchTeam1: m.team1,
        matchTeam2: m.team2,
        stage: m.stage,
      },
    ];
  });

  const crowdByMatch = new Map(counts.map((c) => [c.matchId, c]));
  const profiles = (profilesData ?? []) as ProfileRow[];

  // Crowd + Records are league-wide and the same for everyone.
  const crowdFacts = computeCrowdFacts(counts);
  const records = computeRecords(bets, crowdByMatch);

  // Per-player (winRate, underdogHits) for the personal percentile lines.
  const fieldAgg = new Map<string, { total: number; correct: number; underdogHits: number }>();
  for (const b of bets) {
    const a = fieldAgg.get(b.user_id) ?? { total: 0, correct: 0, underdogHits: 0 };
    a.total += 1;
    if (b.outcome === "won") {
      a.correct += 1;
      if (b.points_awarded === 15) a.underdogHits += 1;
    }
    fieldAgg.set(b.user_id, a);
  }
  const field = [...fieldAgg.values()].map((a) => ({
    winRate: a.total === 0 ? 0 : Math.round((a.correct / a.total) * 1000) / 10,
    underdogHits: a.underdogHits,
  }));

  // "You" section — gated behind login.
  let youContent: ReactNode;
  if (!user) {
    youContent = <LoginCta />;
  } else {
    const myBets = bets.filter((b) => b.user_id === user.id);
    const rank = Math.max(1, profiles.findIndex((p) => p.id === user.id) + 1);
    const myProfile = profiles.find((p) => p.id === user.id);
    const personal = computePersonalStats(
      myBets,
      rank,
      profiles.length,
      myProfile?.points_balance ?? 0,
      crowdByMatch,
      field
    );
    youContent = <YouSection stats={personal} />;
  }

  return (
    <div className="min-h-screen pb-[72px]">
      <AppHeader loggedIn={!!user} />

      <div className="mx-auto max-w-[600px] px-4 pt-5">
        <h1 className="mb-1 text-[26px] font-bold tracking-[-0.5px]">Stats</h1>
        <p className="mb-2 text-sm text-[var(--muted)]">
          The numbers behind the predictions — yours and everyone’s.
        </p>
      </div>

      <div className="mx-auto max-w-[600px] px-4 pb-4">
        <StatsView
          you={youContent}
          crowd={<CrowdSection facts={crowdFacts} />}
          records={<RecordsSection records={records} />}
        />
      </div>

      <BottomNav />
    </div>
  );
}
