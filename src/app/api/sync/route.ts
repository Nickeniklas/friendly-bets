import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchWorldCupMatches, toMatchRow } from "@/lib/openfootball";

// Always run live — this hits an external feed and writes to the DB, so it
// must never be served from Next.js's cache.
export const dynamic = "force-dynamic";

const SETTLE_DELAY_HOURS = 3;

/**
 * Protected sync + auto-settle job, triggered every 2-3h by an external
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
  const settledIds: string[] = [];
  for (const { id } of dueMatches ?? []) {
    const { error: settleError } = await supabase.rpc("settle_match", {
      p_match_id: id,
    });

    if (settleError) {
      return NextResponse.json(
        {
          error: `settle_match failed for match ${id}: ${settleError.message}`,
          synced: rows.length,
          settled: settledIds,
        },
        { status: 500 }
      );
    }

    settledIds.push(id);
  }

  return NextResponse.json({
    synced: rows.length,
    settled: settledIds,
  });
}
