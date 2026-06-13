# PROJECT_CONTEXT

Self-contained summary — paste into Claude project knowledge so fresh chats start informed.

## Current status (see CLAUDE.md for full detail)
**v1 is complete and live** at `https://friendly-bets-rust.vercel.app`. All 8
build-order steps are DONE: Supabase schema/RLS/RPC (incl. `settle_match` and
the `accuracy` view), the `/api/sync` sync+settle job (deployed to Vercel,
cron-job.org triggers it every 2-3h), magic-link auth (`/login`,
`/auth/confirm`, sign-out, custom SMTP via Brevo), the match list page
(`/matches`, grouped by kickoff date, with a place-bet form, live
pool/multiplier display, and team flags per match), and the leaderboard +
accuracy page (`/leaderboard`). No known open bugs. The full step-by-step
build log is in `docs/HISTORY.md`.

Post-v1: a daily login bonus with streak multiplier is also live —
`claim_daily_bonus()` RPC awards 100-400 points on the first page load each
UTC day (streak-based, capped at day 7), shown via a toast and the home
page's streak display.

## Project
A fun, non-commercial prediction/betting site for family & friends, for the 2026 FIFA
World Cup. No real money, ever. v1 scope: view matches, bet winner/loser, live-ish
scoreboard. Built by an owner who is new to Next.js and has no football knowledge (which
is exactly why the betting design needs no oddsmaking).

## Stack (settled)
- Next.js on Vercel
- Supabase — Postgres + Auth (magic link) + realtime
- openfootball worldcup.json for fixtures + results (free, no API key)
- No real odds — a parimutuel betting pool instead
- Sync + settlement run together in a protected `/api/sync` route, triggered every 2–3h
  by a free external scheduler (cron-job.org). Vercel Hobby cron is once-daily only, so
  the schedule lives outside Vercel.

## How the game works
- Everyone starts at 1000 points.
- Bet on a match by picking a side and staking points; stake is deducted immediately.
- All bets on a match form one pool. At settlement, winners split the whole pool
  proportional to their stake. The "multiplier" emerges from how the crowd bet — no
  odds are set by anyone.
- Seed rule: if a match's pool is under 300, it's topped up to 300 (house-funded) so
  thin pools are still worth playing.
- Push rule: if nobody picked the winning side, all bets are refunded. A group-stage
  draw is also treated as a push for v1.
- Separate from points, an accuracy leaderboard tracks bets placed / correct / wrong /
  win rate % / streak — so the game stays meaningful even when pools are thin.
- Settlement is automatic: the sync job settles any match with a result, kickoff >3h ago,
  not yet settled. Idempotent, so running every 2–3h can't double-pay.

## Key decisions & why
- Parimutuel over fixed odds: owner has no football knowledge; pool needs none, and
  real odds aren't reliably free anyway.
- openfootball over a paid API: free, no key, and only daily refresh is needed.
- Deduct stake instantly: matches the mental model from real betting sites.
- Seed to 300 only when thin: keeps thin pools fun without inflating points everywhere.

## Build context
- Building in VS Code with Claude Code.
- Owner is new to Next.js — prefers conventional, well-commented code and brief
  explanations of non-obvious choices.

## v2 ideas
- Draw as a real third pick (its own pool side). v1 treats a draw as a push/refund-all.
