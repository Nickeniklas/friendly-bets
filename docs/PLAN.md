# World Cup 2026 Prediction Game — PLAN

## What this is

A fun, non-commercial prediction/betting site for family and friends, centered on the
2026 FIFA World Cup. No real money, ever. People predict match winners, points move
around a shared pool, and a leaderboard shows who's doing well — both on points and on
raw prediction accuracy.

Project tagline (v1 scope):
> Site for making predictions on 2026 football games.
> v.1 — View matches · Bet winner/loser · Live scoreboard.

Scale: small (family + friends, ~10–50 people). This shapes everything below — we
optimize for simplicity and zero running cost, not for scale or security hardening.

## Scope

### v1 (build now)
- View the match list (fixtures + results), synced from openfootball once or twice a day.
- Place a bet on a match: pick a side, stake points. Points deducted immediately.
- Parimutuel settlement: winners split the pool proportional to stake.
- Seed rule: thin pools topped up to 300.
- Push rule: if nobody picked the winning side, all bets on that match are refunded.
- Everyone starts with 1000 points.
- Leaderboard: points balance.
- Accuracy stats (separate from points): bets placed, correct, wrong, win rate %, streak.

### Deferred (not v1)
- Live in-match scores / stats (we only refresh fixtures + final results daily).
- Real bookmaker odds (parimutuel sidesteps the need entirely).
- Knockout-bracket-specific logic beyond simple per-match win/lose.
- Real-time multiplier display can come later; v1 can show current pool state if cheap.

## Stack & decisions

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js | Most mainstream full-stack React framework — biggest community = easiest to get unstuck. Owner is new to it; mainstream matters. |
| Hosting | Vercel | Zero-config Next.js deploys from a GitHub push. Free tier covers this scale comfortably. |
| Database | Supabase (Postgres) | Postgres + auth + realtime in one free service. Realtime is handy for a live-updating scoreboard. |
| Auth | Supabase Auth (magic link) | Family-and-friends scope: passwordless email is plenty, no password handling. |
| Match data | openfootball worldcup.json | Free, public-domain JSON. No API key, no rate limits. Synced every 2–3h; the same job auto-settles finished matches. |
| Scheduling | External cron (cron-job.org) → `/api/sync` | Vercel Hobby cron is **once-per-day only**; sub-daily is Pro ($20/mo). So the sync+settle lives in a normal API route, triggered by a free external scheduler every 2–3h. Route is protected by a shared secret. |
| Odds | None — parimutuel pool | Owner has no football knowledge; parimutuel needs none. Multipliers emerge from how people bet. Real odds aren't reliably free anyway. |

Decisions are settled. Do not re-litigate without being asked.

## Why parimutuel (the core design choice)

No fixed odds set by anyone. All bets on a match go into one pot. Winners split the
whole pot proportional to their stake. The effective "multiplier" emerges from crowd
behavior — heavy betting on a favorite makes the underdog payout large, automatically.
This requires zero oddsmaking skill from the admin, and it can't be "wrong" because it
predicts nothing; it just divides a pot.

## Architecture sketch

```
openfootball JSON ──(sync job, every 2–3h)──> Supabase: matches table
                                              │   same job then auto-settles:
  Browser (Next.js) ──auth──> Supabase Auth   │   for each match with a result,
        │                                      │   kickoff >3h ago, not yet settled
        │  place bet (deduct now) ──> bets table + profiles.points_balance
        │                                      │        │
        │  view matches/leaderboard <── matches / profiles / accuracy view
        │                                      │        ▼
        │                              settle_match() RPC (atomic):
        │                                pot = sum(stakes); if pot < 300 -> pot = 300
        │                                winners split pot by stake; losers already paid
        │                                if no winning bettor -> refund all stakes (push)
        │                                flip match.status -> settled (idempotent: skip if already)
```

## Build order (bottom-up)

Status detail lives in `CLAUDE.md` ("Status" section) — kept current there so it
doesn't drift across two files.

1. DONE — Supabase project + schema (tables, RPC, views, RLS). See `SCHEMA.md`.
2. DONE — openfootball sync — a protected API route (`/api/sync`) that pulls JSON, upserts into
   `matches`, then auto-settles any match with a result, kickoff >3h ago, not yet settled.
   Deployed to Vercel and triggered by an external scheduler (cron-job.org, free) every
   2–3h, NOT Vercel cron (Hobby is once-daily only). Route checks a shared secret so only
   the scheduler can run it.
3. DONE — Next.js skeleton + Supabase client helpers + magic-link auth (`/login`,
   `/auth/confirm`, session-refresh middleware, sign-out). Works with Supabase's
   default email template (no custom SMTP needed) via PKCE `code` exchange.
   Supabase Authentication -> URL Configuration is set up. Remaining: add
   `NEXT_PUBLIC_SITE_URL` to Vercel project env vars (see CLAUDE.md).
4. DONE — Match list page (read matches). `src/app/matches/page.tsx`, grouped
   by kickoff date, linked from the home page.
5. DONE — Place-bet flow (insert bet + deduct balance, guarded by match status).
   `src/app/matches/page.tsx` shows a pick/stake form per bettable match;
   `src/app/matches/actions.ts` (`placeBet`) just inserts into `bets` — the
   step-1 DB triggers/constraints do all enforcement.
6. DONE — Settlement RPC (built as part of step 1; called by the sync job in step 2; idempotent).
7. DONE — Leaderboard (points) + accuracy stats view. `src/app/leaderboard/page.tsx`,
   linked from the home page and `/matches`.
8. DONE — Polish: show current pool / implied multiplier on each match.
   `src/app/matches/page.tsx` fetches all bets' `match_id, pick, stake`
   alongside the matches query (RLS allows anon read), sums stakes per
   match/pick, and shows "Pool: N pts · TeamA Xx · TeamB Yx" on each match
   card, mirroring `settle_match`'s pot/seed-to-300 and payout-multiplier math.

## Open items
- Exact "thin pool" trigger is decided: top up to **300**. (Settled.)
- Settlement is automatic: the sync job (every 2–3h) settles any match with a result,
  kickoff >3h ago, not yet settled. Idempotent — already-settled matches are skipped.
  (Settled.)
- Draw handling is decided: a group-stage draw is a **push** for v1 — all bets on that
  match are refunded. Picks are team1/team2 only. (Settled.)

## v2 ideas (not now)
- Draw as a third pick — let people bet on a draw, with its own pool side. Adds UI and
  changes settlement (three sides instead of two). Deferred to v2.
