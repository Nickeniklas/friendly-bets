/**
 * Pure aggregation helpers for the /stats tab. No React, no Supabase here —
 * `src/app/stats/page.tsx` fetches + flattens the rows into the plain shapes
 * below and calls these, so this stays easy to read and reason about.
 *
 * Stat formulas match the rest of the app (the `accuracy` view and
 * `buildStageRows` in src/app/leaderboard/page.tsx):
 *   points = Σ points_awarded, win% = round(correct/total * 1000) / 10,
 *   a settled bet is `won` (+10, or +15 underdog) or `lost` (−5).
 */

export type Pick = "team1" | "draw" | "team2";

// Display names + canonical order for tournament rounds (codes from
// `mapStage()` in src/lib/openfootball.ts). Shared with the leaderboard.
export const STAGE_LABELS: Record<string, string> = {
  group: "Group stage",
  r32: "Round of 32",
  r16: "Round of 16",
  qf: "Quarter-finals",
  sf: "Semi-finals",
  third_place: "Third place",
  final: "Final",
};
export const STAGE_ORDER = ["group", "r32", "r16", "qf", "sf", "third_place", "final"];

/**
 * Pull the single embedded row out of a Supabase to-one relation, whether it
 * came back as an object or a one-element array (its inferred types allow
 * both). Shared with the leaderboard page.
 */
export function related<T>(rel: T | T[] | null | undefined): T | undefined {
  if (rel == null) return undefined;
  return Array.isArray(rel) ? rel[0] : rel;
}

/** Win% to one decimal, guarding divide-by-zero (0 bets → 0). */
export function winRate(correct: number, total: number): number {
  return total === 0 ? 0 : Math.round((correct / total) * 1000) / 10;
}

// --- Flat input shapes (page.tsx builds these from the Supabase joins) ------

/** One settled bet, flattened from bets + matches + profiles. */
export type StatsBet = {
  user_id: string;
  display_name: string | null;
  pick: Pick;
  points_awarded: number;
  outcome: "won" | "lost";
  // "Wins in 90 min" mode (knockout team picks). Affects how points_awarded maps
  // to an underdog hit — see isUnderdogHit().
  ft_winner: boolean;
  placed_at: string;
  matchId: string;
  stage: string;
  team1: string;
  team2: string;
  result: Pick | null;
};

/**
 * Whether a settled bet earned the +5 crowd underdog bonus. The bonus can't be
 * read off points_awarded alone anymore: a correct standard pick is +10 (+5
 * underdog = 15), but a correct "wins in 90′" pick is +15 (10 + 5 ft-bonus) and
 * +20 with the underdog bonus. So an underdog hit is a won bet whose total is
 * exactly the no-underdog baseline plus 5.
 */
export function isUnderdogHit(b: {
  outcome: "won" | "lost";
  points_awarded: number;
  ft_winner: boolean;
}): boolean {
  if (b.outcome !== "won") return false;
  const baseline = b.ft_winner ? 15 : 10;
  return b.points_awarded === baseline + 5;
}

/** Crowd pick split for one match, flattened from match_bet_counts + matches. */
export type CrowdCount = {
  matchId: string;
  team1: number;
  draw: number;
  team2: number;
  result: Pick | null;
  matchTeam1: string;
  matchTeam2: string;
  stage: string;
};

// --- Small shared utilities -------------------------------------------------

/** "Brazil vs Serbia" — the human label for a match. */
export function matchLabel(team1: string, team2: string): string {
  return `${team1} vs ${team2}`;
}

/** What a pick/outcome means in words for a given match. */
export function outcomeLabel(outcome: Pick, team1: string, team2: string): string {
  if (outcome === "draw") return "Draw";
  return outcome === "team1" ? `${team1} win` : `${team2} win`;
}

/** The crowd's plurality pick for a match (ties resolve team1 → draw → team2). */
export function pluralityPick(c: CrowdCount): Pick {
  const { team1, draw, team2 } = c;
  if (team1 >= draw && team1 >= team2) return "team1";
  if (draw >= team2) return "draw";
  return "team2";
}

function totalPicks(c: CrowdCount): number {
  return c.team1 + c.draw + c.team2;
}

function pickShare(c: CrowdCount, outcome: Pick): number {
  const total = totalPicks(c);
  return total === 0 ? 0 : c[outcome] / total;
}

// =====================  PERSONAL ("You")  ===================================

export type StageStat = { stage: string; label: string; correct: number; total: number; winRate: number };
export type PickStat = { pick: Pick; count: number; correct: number; winRate: number };
export type Call = { label: string; detail: string; points: number };

export type PersonalStats = {
  totalPoints: number;
  rank: number;
  totalPlayers: number;
  winRate: number;
  currentStreak: number;
  bestStreak: number;
  totalPredictions: number;
  byStage: StageStat[];
  picks: PickStat[];
  // Contrarian = picked against the crowd's plurality.
  contrarianCount: number;
  contrarianWinRate: number;
  withCrowdCount: number;
  withCrowdWinRate: number;
  underdogHits: number;
  bestCalls: Call[];
  worstCalls: Call[];
  // Percentile context vs the rest of the field.
  winRateBeatsPct: number;
  underdogRank: number;
};

/**
 * Everything in the "You" section, computed from one player's settled bets.
 * `crowdByMatch` gives the plurality pick per match (for contrarian splits);
 * `field` is every player's (winRate, underdogHits) for the percentile lines.
 */
export function computePersonalStats(
  myBets: StatsBet[],
  rank: number,
  totalPlayers: number,
  pointsBalance: number,
  crowdByMatch: Map<string, CrowdCount>,
  field: { winRate: number; underdogHits: number }[]
): PersonalStats {
  // Oldest → newest, so streak runs read naturally in time order.
  const chrono = [...myBets].sort((a, b) => a.placed_at.localeCompare(b.placed_at));

  let correct = 0;
  let currentStreak = 0;
  let bestStreak = 0;
  let underdogHits = 0;

  const byStage = new Map<string, { correct: number; total: number }>();
  const byPick = new Map<Pick, { count: number; correct: number }>();
  let contrarianCount = 0;
  let contrarianCorrect = 0;
  let withCrowdCount = 0;
  let withCrowdCorrect = 0;

  for (const b of chrono) {
    const won = b.outcome === "won";
    if (won) {
      correct += 1;
      currentStreak += 1;
      bestStreak = Math.max(bestStreak, currentStreak);
      if (isUnderdogHit(b)) underdogHits += 1;
    } else {
      currentStreak = 0;
    }

    const s = byStage.get(b.stage) ?? { correct: 0, total: 0 };
    s.total += 1;
    if (won) s.correct += 1;
    byStage.set(b.stage, s);

    const p = byPick.get(b.pick) ?? { count: 0, correct: 0 };
    p.count += 1;
    if (won) p.correct += 1;
    byPick.set(b.pick, p);

    const crowd = crowdByMatch.get(b.matchId);
    if (crowd) {
      if (b.pick === pluralityPick(crowd)) {
        withCrowdCount += 1;
        if (won) withCrowdCorrect += 1;
      } else {
        contrarianCount += 1;
        if (won) contrarianCorrect += 1;
      }
    }
  }

  const total = chrono.length;

  const stageStats: StageStat[] = [...STAGE_ORDER, ...[...byStage.keys()].filter((s) => !STAGE_ORDER.includes(s))]
    .filter((stage) => byStage.has(stage))
    .map((stage) => {
      const s = byStage.get(stage)!;
      return { stage, label: STAGE_LABELS[stage] ?? stage, correct: s.correct, total: s.total, winRate: winRate(s.correct, s.total) };
    });

  const picks: PickStat[] = (["team1", "draw", "team2"] as Pick[]).map((pick) => {
    const p = byPick.get(pick) ?? { count: 0, correct: 0 };
    return { pick, count: p.count, correct: p.correct, winRate: winRate(p.correct, p.count) };
  });

  // Best/worst calls: biggest single-bet point swings (won underdogs float to
  // the top of best; −5 losses fill worst). Ties broken by most recent.
  const ranked = [...myBets].sort(
    (a, b) => b.points_awarded - a.points_awarded || b.placed_at.localeCompare(a.placed_at)
  );
  const toCall = (b: StatsBet): Call => ({
    label: matchLabel(b.team1, b.team2),
    detail: `${b.outcome === "won" ? "Called" : "Picked"} ${outcomeLabel(b.pick, b.team1, b.team2).toLowerCase()}`,
    points: b.points_awarded,
  });
  const bestCalls = ranked.filter((b) => b.points_awarded > 0).slice(0, 3).map(toCall);
  const worstCalls = ranked.filter((b) => b.points_awarded < 0).slice(-3).reverse().map(toCall);

  // Percentile context vs everyone (including the player themselves).
  const myWinRate = winRate(correct, total);
  const beaten = field.filter((f) => myWinRate > f.winRate).length;
  const winRateBeatsPct = field.length <= 1 ? 0 : Math.round((beaten / (field.length - 1)) * 100);
  const underdogRank =
    field
      .slice()
      .sort((a, b) => b.underdogHits - a.underdogHits)
      .findIndex((f) => f.underdogHits <= underdogHits) + 1;

  return {
    totalPoints: pointsBalance,
    rank,
    totalPlayers,
    winRate: myWinRate,
    currentStreak,
    bestStreak,
    totalPredictions: total,
    byStage: stageStats,
    picks,
    contrarianCount,
    contrarianWinRate: winRate(contrarianCorrect, contrarianCount),
    withCrowdCount,
    withCrowdWinRate: winRate(withCrowdCorrect, withCrowdCount),
    underdogHits,
    bestCalls,
    worstCalls,
    winRateBeatsPct,
    underdogRank: underdogRank || field.length,
  };
}

// =====================  CROWD ("The Crowd")  ================================

export type MatchSplit = {
  matchId: string;
  label: string;
  stage: string;
  team1: number;
  draw: number;
  team2: number;
  total: number;
  result: Pick | null;
  resultShare: number; // share of picks that matched the actual result
  plurality: Pick;
  crowdCorrect: boolean;
};

export type CrowdFacts = {
  settledCount: number;
  mostDivisive: MatchSplit | null;
  strongestConsensus: MatchSplit | null;
  biggestUpset: MatchSplit | null;
  crowdAccuracyPct: number; // % of settled matches where plurality == result
  drawPickPct: number; // share of all picks that were "draw"
  actualDrawPct: number; // share of settled matches that actually drew
  fanFavourite: { team: string; backed: number } | null;
};

/**
 * Group-wide "fun facts". Only matches with a known result *and* at least one
 * pick count toward result-based facts; divisiveness/consensus just need picks.
 */
export function computeCrowdFacts(counts: CrowdCount[]): CrowdFacts {
  const played: MatchSplit[] = counts
    .filter((c) => c.result != null && totalPicks(c) > 0)
    .map((c) => {
      const total = totalPicks(c);
      const plurality = pluralityPick(c);
      return {
        matchId: c.matchId,
        label: matchLabel(c.matchTeam1, c.matchTeam2),
        stage: c.stage,
        team1: c.team1,
        draw: c.draw,
        team2: c.team2,
        total,
        result: c.result,
        resultShare: pickShare(c, c.result!),
        plurality,
        crowdCorrect: plurality === c.result,
      };
    });

  if (played.length === 0) {
    return {
      settledCount: 0,
      mostDivisive: null,
      strongestConsensus: null,
      biggestUpset: null,
      crowdAccuracyPct: 0,
      drawPickPct: 0,
      actualDrawPct: 0,
      fanFavourite: null,
    };
  }

  // Top pick-share per match = how lopsided the crowd was. Lowest = divisive.
  const maxShare = (m: MatchSplit) => Math.max(m.team1, m.draw, m.team2) / m.total;
  const mostDivisive = played.reduce((a, b) => (maxShare(b) < maxShare(a) ? b : a));
  const strongestConsensus = played.reduce((a, b) => (maxShare(b) > maxShare(a) ? b : a));
  // Upset = the actual result drew the smallest share of picks.
  const biggestUpset = played.reduce((a, b) => (b.resultShare < a.resultShare ? b : a));

  const crowdCorrect = played.filter((m) => m.crowdCorrect).length;
  const crowdAccuracyPct = Math.round((crowdCorrect / played.length) * 100);

  const drawPicks = played.reduce((sum, m) => sum + m.draw, 0);
  const allPicks = played.reduce((sum, m) => sum + m.total, 0);
  const drawPickPct = allPicks === 0 ? 0 : Math.round((drawPicks / allPicks) * 100);
  const actualDraws = played.filter((m) => m.result === "draw").length;
  const actualDrawPct = Math.round((actualDraws / played.length) * 100);

  // Fan favourite = team backed most across all matches (a "team1"/"team2" pick
  // is a vote for that side's team to win).
  const backing = new Map<string, number>();
  for (const c of counts) {
    backing.set(c.matchTeam1, (backing.get(c.matchTeam1) ?? 0) + c.team1);
    backing.set(c.matchTeam2, (backing.get(c.matchTeam2) ?? 0) + c.team2);
  }
  let fanFavourite: { team: string; backed: number } | null = null;
  for (const [team, backed] of backing) {
    if (backed > 0 && (!fanFavourite || backed > fanFavourite.backed)) fanFavourite = { team, backed };
  }

  return {
    settledCount: played.length,
    mostDivisive,
    strongestConsensus,
    biggestUpset,
    crowdAccuracyPct,
    drawPickPct,
    actualDrawPct,
    fanFavourite,
  };
}

// =====================  RECORDS ("Hall of Fame")  ==========================

export type RecordEntry = { name: string; value: string; sub?: string } | null;

export type Records = {
  longestStreak: RecordEntry;
  biggestHaul: RecordEntry;
  underdogHunter: RecordEntry;
  mostAccurate: RecordEntry;
  mostPredictions: RecordEntry;
  sharpestContrarian: RecordEntry;
};

// Minimum settled bets before a player qualifies for the rate-based records,
// so one lucky 1/1 pick can't top "most accurate" / "sharpest contrarian".
const MIN_BETS_FOR_RATE = 5;

/** League-wide superlatives, each naming the record-holder. */
export function computeRecords(bets: StatsBet[], crowdByMatch: Map<string, CrowdCount>): Records {
  type Acc = {
    name: string;
    total: number;
    correct: number;
    underdogHits: number;
    longestStreak: number;
    runningStreak: number;
    byStage: Map<string, number>; // Σ points per stage (for biggest single-stage haul)
    contrarianTotal: number;
    contrarianCorrect: number;
  };
  const byUser = new Map<string, Acc>();

  // Chronological so streak runs are correct.
  const chrono = [...bets].sort((a, b) => a.placed_at.localeCompare(b.placed_at));
  for (const b of chrono) {
    let acc = byUser.get(b.user_id);
    if (!acc) {
      acc = {
        name: b.display_name ?? "Unknown",
        total: 0,
        correct: 0,
        underdogHits: 0,
        longestStreak: 0,
        runningStreak: 0,
        byStage: new Map(),
        contrarianTotal: 0,
        contrarianCorrect: 0,
      };
      byUser.set(b.user_id, acc);
    }
    const won = b.outcome === "won";
    acc.total += 1;
    if (won) {
      acc.correct += 1;
      acc.runningStreak += 1;
      acc.longestStreak = Math.max(acc.longestStreak, acc.runningStreak);
      if (isUnderdogHit(b)) acc.underdogHits += 1;
    } else {
      acc.runningStreak = 0;
    }
    acc.byStage.set(b.stage, (acc.byStage.get(b.stage) ?? 0) + b.points_awarded);

    const crowd = crowdByMatch.get(b.matchId);
    if (crowd && b.pick !== pluralityPick(crowd)) {
      acc.contrarianTotal += 1;
      if (won) acc.contrarianCorrect += 1;
    }
  }

  const accs = [...byUser.values()];
  if (accs.length === 0) {
    return {
      longestStreak: null,
      biggestHaul: null,
      underdogHunter: null,
      mostAccurate: null,
      mostPredictions: null,
      sharpestContrarian: null,
    };
  }

  // Generic "pick the max by `score`, skipping zero/ineligible" helper.
  function best<T>(items: T[], score: (t: T) => number | null): T | null {
    let winner: T | null = null;
    let bestScore = -Infinity;
    for (const it of items) {
      const s = score(it);
      if (s == null) continue;
      if (s > bestScore) {
        bestScore = s;
        winner = it;
      }
    }
    return winner;
  }

  const streakHolder = best(accs, (a) => (a.longestStreak > 0 ? a.longestStreak : null));
  const haulHolder = best(accs, (a) => {
    const top = Math.max(0, ...a.byStage.values());
    return top > 0 ? top : null;
  });
  const underdogHolder = best(accs, (a) => (a.underdogHits > 0 ? a.underdogHits : null));
  const accurateHolder = best(accs, (a) =>
    a.total >= MIN_BETS_FOR_RATE ? winRate(a.correct, a.total) : null
  );
  const volumeHolder = best(accs, (a) => a.total);
  const contrarianHolder = best(accs, (a) =>
    a.contrarianTotal >= MIN_BETS_FOR_RATE ? winRate(a.contrarianCorrect, a.contrarianTotal) : null
  );

  const haulStage = (a: Acc) => {
    let topStage = "";
    let topPoints = -Infinity;
    for (const [stage, pts] of a.byStage) {
      if (pts > topPoints) {
        topPoints = pts;
        topStage = stage;
      }
    }
    return { stage: STAGE_LABELS[topStage] ?? topStage, points: topPoints };
  };

  return {
    longestStreak: streakHolder
      ? { name: streakHolder.name, value: `${streakHolder.longestStreak} in a row` }
      : null,
    biggestHaul: haulHolder
      ? (() => {
          const h = haulStage(haulHolder);
          return { name: haulHolder.name, value: `${h.points} pts`, sub: h.stage };
        })()
      : null,
    underdogHunter: underdogHolder
      ? { name: underdogHolder.name, value: `${underdogHolder.underdogHits} underdog calls` }
      : null,
    mostAccurate: accurateHolder
      ? { name: accurateHolder.name, value: `${winRate(accurateHolder.correct, accurateHolder.total)}%`, sub: `${accurateHolder.total} predictions` }
      : null,
    mostPredictions: volumeHolder
      ? { name: volumeHolder.name, value: `${volumeHolder.total} predictions` }
      : null,
    sharpestContrarian: contrarianHolder
      ? { name: contrarianHolder.name, value: `${winRate(contrarianHolder.contrarianCorrect, contrarianHolder.contrarianTotal)}%`, sub: `${contrarianHolder.contrarianTotal} vs the crowd` }
      : null,
  };
}
