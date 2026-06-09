# CLAUDE.md

Operating brief for Claude Code. Read `docs/PLAN.md` and `docs/SCHEMA.md` for full detail.

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
1. Supabase schema (tables, RPC, view, RLS) — see SCHEMA.md
2. openfootball sync as a protected API route `/api/sync`: upsert into matches on
   external_ref, then auto-settle any match with a result, kickoff >3h ago, not yet
   settled. Triggered by external cron (cron-job.org) every 2–3h — NOT Vercel cron
   (Hobby = once-daily only). Route requires a shared secret header.
3. Next.js skeleton + Supabase client + magic-link auth
4. Match list page
5. Place-bet flow (insert + deduct, guarded)
6. settle_match RPC (called by the sync job; idempotent)
7. Leaderboard + accuracy view
8. Polish: show current pool / implied multiplier

## Gotchas
- openfootball has no clean match id — build a deterministic external_ref
  (e.g. date-team1-team2) and upsert on it so re-syncs don't duplicate.
- Don't re-deduct loser stakes at settlement; they were taken at placement.
- accuracy is a derived VIEW, not a stored table — keeps it from drifting.

## Secrets
Supabase URL + anon key in env (`.env.local`, and Vercel project env). Service-role key
is server-only — never ship it to the client. The `/api/sync` route checks a shared
secret (e.g. `SYNC_SECRET`) passed by the external scheduler — store it in env, never
commit it. Never commit `.env*`.
