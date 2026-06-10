# CLAUDE.md

Operating brief for Claude Code. Read `docs/PLAN.md` and `docs/SCHEMA.md` for full detail.

@AGENTS.md

## Status (as of 2026-06-10)
- Step 1 (Supabase schema, RPC, view, RLS) — DONE. Migrations applied and verified
  against the live project: `supabase/migrations/20260609000000_initial_schema.sql`
  and `supabase/migrations/20260610120000_grants.sql`.
- Step 2 (`/api/sync` route) — DONE and tested locally against the live Supabase
  project: synced 104 matches from openfootball, 0 settled (tournament starts
  2026-06-11, nothing past the 3h-post-kickoff threshold yet).
- Step 3 (Next.js skeleton) — partially done. TS/App Router/Tailwind/ESLint
  scaffold + `@supabase/supabase-js` are in place. Magic-link auth NOT built yet.
- Not yet done: Vercel deployment + env vars, cron-job.org schedule for
  `/api/sync` (every 2-3h, header `Authorization: Bearer <SYNC_SECRET>`).

Next session: pick up step 3 (Supabase client helpers + magic-link auth), or
finish step-2 deployment/cron wiring first — owner's call.

## What we're building
A non-commercial World Cup 2026 prediction game for family & friends. No real money.
People bet points on match winners; a parimutuel pool decides payouts. Everyone starts
at 1000 points. Separate accuracy leaderboard tracks raw prediction skill.

## Stack (decided — do not re-litigate without being asked)
- Next.js on Vercel
- Supabase: Postgres + Auth (magic link) + realtime
- Match data: openfootball `worldcup.json` (free, no key), synced 1–2×/day
- No real odds — parimutuel pool only

Owner is new to Next.js. Prefer clear, conventional, well-commented code over clever
tricks. Explain non-obvious Next.js / Supabase choices inline.

## Hard rules / invariants
- A bet may be placed ONLY while match.status = 'scheduled' AND now() < kickoff_at.
  Enforce in the DB, not just the UI.
- Stake is deducted from points_balance the instant a bet is placed.
- Settlement (`settle_match`) is ONE atomic transaction, idempotent (skips already-settled
  matches), and is the only path besides bet-placement that changes a balance. It is called
  automatically by the sync job, not by an admin.
- Seed rule: at settlement, if pool < 300, treat pool as 300 (house funds the gap).
- Push rule: if nobody picked the winning side, refund all stakes on that match.
- Draw (any stage) = push/refund-all for v1 (picks are team1/team2 only; no 'draw' pick).
  v2 may add 'draw' as a real third pick — not now.
- Balances never change via direct client writes — only via bet insert + settlement RPC.
  Lock this down with RLS; settlement is a security-definer RPC.

## Build order
1. DONE — Supabase schema (tables, RPC, view, RLS) — see SCHEMA.md
2. DONE (locally) — openfootball sync as a protected API route `/api/sync`: upsert into
   matches on external_ref, then auto-settle any match with a result, kickoff >3h ago, not yet
   settled. Triggered by external cron (cron-job.org) every 2–3h — NOT Vercel cron
   (Hobby = once-daily only). Route requires a shared secret header. Still need:
   Vercel deploy + env vars + the cron-job.org schedule itself.
3. PARTIAL — Next.js skeleton done (TS, App Router, Tailwind, ESLint,
   `@supabase/supabase-js`). Supabase client helpers + magic-link auth not built yet.
4. Match list page
5. Place-bet flow (insert + deduct, guarded)
6. DONE — settle_match RPC (built as part of step 1; called by the sync job; idempotent)
7. Leaderboard + accuracy view
8. Polish: show current pool / implied multiplier

## Gotchas
- openfootball has no clean match id. Implemented external_ref strategy (see
  `src/lib/openfootball.ts`): knockout matches (have a stable `num` field) →
  `wc2026-m{num}`; group-stage matches (stable team names from day one, no `num`) →
  `{date}-{team1}-{team2}` slugified. Knockout team1/team2 start as placeholders
  ("2A", "W74") that get overwritten as the bracket resolves — keying on team names
  there would create duplicate rows on re-sync, hence the num-based key for knockouts.
- Don't re-deduct loser stakes at settlement; they were taken at placement.
- accuracy is a derived VIEW, not a stored table — keeps it from drifting.
- RLS policies alone aren't enough — Postgres also requires baseline table GRANTs
  for anon/authenticated/service_role (a separate permission layer checked *before*
  RLS; service_role's BYPASSRLS doesn't skip it). Tables created via `supabase db push`
  didn't get Supabase's usual auto-grants, causing "permission denied for table X".
  Fixed in `supabase/migrations/20260610120000_grants.sql` — if new tables are added
  later, grant there too.

## Secrets
Supabase URL, anon key, service-role key, and SYNC_SECRET live in `.env.local`
(copy from `.env.local.example`; same vars go into Vercel project env when deployed).
Service-role key is server-only — never ship it to the client. The `/api/sync` route
checks a shared secret (`SYNC_SECRET`) passed by the external scheduler — store it in
env, never commit it. Never commit `.env*.local`.

Note: Supabase's dashboard now shows new "Publishable"/"Secret" key formats by default,
with the old `anon`/`service_role` JWTs under "Legacy API Keys" — both work identically
with `@supabase/supabase-js`. This project currently uses the legacy JWT keys.
