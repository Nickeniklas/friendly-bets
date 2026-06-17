import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchWorldCupMatches, toMatchRow, type MatchRow } from "@/lib/openfootball";

// Always run live — this hits an external feed and writes to the DB, so it
// must never be served from Next.js's cache.
export const dynamic = "force-dynamic";

// How long after kickoff a match is eligible for settlement. This MUST stay in
// sync with settle_match's own guard (`kickoff_at > now() - interval '3 hours'`
// in supabase/migrations/20260616000000_accuracy_points_model.sql) — the RPC
// double-checks the same window and RAISEs if it isn't met. If you change one,
// change the other, or the job will keep selecting matches the RPC rejects.
const SETTLE_DELAY_HOURS = 3;

/**
 * Protected sync + auto-settle job, triggered every 5 minutes by an external
 * scheduler (cron-job.org), per CLAUDE.md / docs/PLAN.md.
 *
 * 1. Pull the openfootball fixture/results feed and upsert into `matches`.
 * 2. Find matches with a result, kicked off >3h ago, not yet settled.
 * 3. Call the `settle_match` RPC for each (idempotent — safe to repeat).
 */
export async function GET(request: NextRequest) {
  const syncSecret = process.env.SYNC_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!syncSecret || authHeader !== `Bearer ${syncSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // --- 1. Sync fixtures/results -------------------------------------------------
  const ofMatches = await fetchWorldCupMatches();
  const rows = ofMatches.map(toMatchRow);

  // Don't let a re-sync overwrite the `result` of an already-settled match.
  // Points were awarded against the result as it stood at settlement, and
  // settle_match is idempotent (it won't re-award), so if the feed later
  // corrects a score the stored result would silently disagree with the points
  // already on the leaderboard. Freeze each settled match's result to its
  // stored value before upserting. (status/settled_at are omitted from the
  // payload below anyway, so only `result` needs this protection.)
  const { data: settledRows, error: settledError } = await supabase
    .from("matches")
    .select("external_ref, result")
    .eq("status", "settled");

  if (settledError) {
    return NextResponse.json({ error: settledError.message }, { status: 500 });
  }

  const settledResultByRef = new Map(
    (settledRows ?? []).map((m) => [m.external_ref, m.result as MatchRow["result"]])
  );
  for (const row of rows) {
    if (settledResultByRef.has(row.external_ref)) {
      row.result = settledResultByRef.get(row.external_ref) ?? row.result;
    }
  }

  // Upsert on external_ref. Deliberately omit `status`/`settled_at` from the
  // payload so an already-settled match doesn't get reset to 'scheduled' by
  // a later re-sync — those columns are only ever written by settle_match.
  const { error: upsertError } = await supabase
    .from("matches")
    .upsert(rows, { onConflict: "external_ref" });

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  // --- 2. Find matches ready to settle --------------------------------------------
  const cutoff = new Date(
    Date.now() - SETTLE_DELAY_HOURS * 60 * 60 * 1000
  ).toISOString();

  const { data: dueMatches, error: selectError } = await supabase
    .from("matches")
    .select("id")
    .not("result", "is", null)
    .lt("kickoff_at", cutoff)
    .neq("status", "settled");

  if (selectError) {
    return NextResponse.json({ error: selectError.message }, { status: 500 });
  }

  // --- 3. Settle each (idempotent RPC, one atomic transaction per match) ----------
  // Matches settle independently, so one failure must NOT abort the rest:
  // log it, record it, and keep going. A transient miss (e.g. clock skew on
  // the 3h window between this job's clock and the DB's) self-heals on the
  // next cron tick; a persistent failure shows up in `failed` below and in
  // the server logs.
  const settledIds: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const { id } of dueMatches ?? []) {
    const { error: settleError } = await supabase.rpc("settle_match", {
      p_match_id: id,
    });

    if (settleError) {
      console.error(`settle_match failed for match ${id}: ${settleError.message}`);
      failed.push({ id, error: settleError.message });
      continue;
    }

    settledIds.push(id);
  }

  return NextResponse.json({
    synced: rows.length,
    settled: settledIds,
    ...(failed.length > 0 ? { failed } : {}),
  });
}
