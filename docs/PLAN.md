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
| Match data | openfootball worldcup.json | Free, public-domain JSON. No API key, no rate limits. Perfect for a once/twice-daily refresh. |
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
openfootball JSON ──(daily sync job)──> Supabase: matches table
                                              │
  Browser (Next.js) ──auth──> Supabase Auth   │
        │                                      │
        │  place bet (deduct now) ──> bets table + profiles.points_balance
        │                                      │
        │  view matches/leaderboard <── matches / profiles / accuracy view
        │                                      │
   admin triggers settlement ──> settle_match() RPC (atomic):
        pot = sum(stakes); if pot < 300 -> pot = 300 (house seeds the gap)
        winners split pot by stake; losers already paid
        if no winning bettor -> refund all stakes (push)
        flip match.status -> settled
```

## Build order (bottom-up)

1. Supabase project + schema (tables, RPC, views, RLS). See `SCHEMA.md`.
2. openfootball sync — a script/route that pulls JSON and upserts into `matches`.
3. Next.js skeleton + Supabase client + magic-link auth.
4. Match list page (read matches).
5. Place-bet flow (insert bet + deduct balance, guarded by match status).
6. Settlement RPC + an admin trigger for it.
7. Leaderboard (points) + accuracy stats view.
8. Polish: show current pool / implied multiplier on each match.

## Open items
- Exact "thin pool" trigger is decided: top up to **300**. (Settled.)
- Who can trigger settlement, and how (manual admin button vs scheduled)? Lean manual
  for v1 — owner runs it after results post. Revisit if tedious.
- Draw handling in group stage: a match can end in a draw. Decide whether "winner/loser"
  betting treats a draw as its own pick or as a push. (See SCHEMA note.)
