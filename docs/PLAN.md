# World Cup 2026 Prediction Game — PLAN

## What this is

A fun, non-commercial prediction site for family and friends, centered on the
2026 FIFA World Cup. No real money, ever. People predict each match's outcome
(home win / draw / away win), earn or lose points based on whether they were right
(with an underdog bonus), and a leaderboard shows who's doing well — both on points and
on raw prediction accuracy.

Project tagline (v1 scope):
> Site for making predictions on 2026 football games.
> v.1 — View matches · Predict home/draw/away · Live scoreboard.

Scale: small (family + friends, ~10–50 people). This shapes everything below — we
optimize for simplicity and zero running cost, not for scale or security hardening.

## Scope

### v1 (build now)
- View the match list (fixtures + results), synced periodically from openfootball
  (every 5 minutes — see Stack table below).
- Predict a match: pick one of three outcomes — home win / draw / away win. No stake.
- Points settlement: correct pick +10 (+5 underdog bonus if the picked outcome got
  fewer than 33% of the match's bets); wrong pick −5.
- Everyone starts at 0 points; balances may go negative.
- Leaderboard: total points earned/lost.
- Accuracy stats (separate from points): bets placed, correct, wrong, win rate %, streak.

### Deferred (not v1)
- Live in-match scores / stats (we only refresh fixtures + final results from
  openfootball's periodically-updated JSON, not a live feed).
- Real bookmaker odds (the fixed-points model sidesteps the need entirely).
- Knockout-bracket-specific logic beyond simple per-match outcome prediction.

## Stack & decisions

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js | Most mainstream full-stack React framework — biggest community = easiest to get unstuck. Owner is new to it; mainstream matters. |
| Hosting | Vercel | Zero-config Next.js deploys from a GitHub push. Free tier covers this scale comfortably. |
| Database | Supabase (Postgres) | Postgres + auth + realtime in one free service. Realtime is handy for a live-updating scoreboard. |
| Auth | Supabase Auth (magic link) | Family-and-friends scope: passwordless email is plenty, no password handling. |
| Match data | openfootball worldcup.json | Free, public-domain JSON. No API key, no rate limits. Synced every 5 minutes; the same job auto-settles finished matches. |
| Scheduling | External cron (cron-job.org) → `/api/sync` | Vercel Hobby cron is **once-per-day only**; sub-daily is Pro ($20/mo). So the sync+settle lives in a normal API route, triggered by a free external scheduler every 5 minutes (reduced from every 2–3h on 2026-06-14 — cron-job.org's free tier supports down to 1-minute intervals). Route is protected by a shared secret. |
| Odds | None — fixed-points scoring | Owner has no football knowledge; the points model needs none. Going against the crowd and being right earns a bonus, automatically, with no oddsmaking. |

Decisions are settled. Do not re-litigate without being asked.

## Why a fixed-points model (the core design choice)

No stakes, no pool, no odds. Each match has three outcomes (home / draw / away); a bet
just predicts one. At settlement a correct pick scores +10, a wrong pick −5, and a
correct pick of an outcome that fewer than 33% of bettors chose gets a +5 underdog
bonus. This requires zero oddsmaking from the admin, rewards genuine prediction skill
(especially brave-but-right calls), and the crowd-based bonus emerges automatically from
how people bet. (Earlier versions used a parimutuel pool — see `docs/HISTORY.md`; that
was replaced on 2026-06-16.)

## Architecture sketch

```
openfootball JSON ──(sync job, every 5 min)──> Supabase: matches table
                                              │   same job then auto-settles:
  Browser (Next.js) ──auth──> Supabase Auth   │   for each match with a result,
        │                                      │   kickoff >3h ago, not yet settled
        │  place pick (no stake) ──> bets table
        │                                      │        │
        │  view matches/leaderboard <── matches / profiles / accuracy view
        │                                      │        ▼
        │                              settle_match() RPC (atomic):
        │                                total/result_count = bet distribution
        │                                underdog = result outcome got <33% of bets
        │                                each bet: +10 (+5 underdog) correct, -5 wrong
        │                                add points_awarded to profiles.points_balance
        │                                flip match.status -> settled (idempotent: skip if already)
```

## Status

**v2 is complete and live.** All of the original build order (Supabase schema/RLS/RPC,
the `/api/sync` sync+settle job, magic-link + Google auth, `/matches`, the place-pick
flow, `settle_match`, `/leaderboard` + accuracy view, and the crowd-split polish) is
done, along with subsequent post-v1 polish (UI redesign, Finnish times, Upcoming/Live/
Past tabs, the parimutuel→fixed-points model change, and more).

This file is now reference-only — the design rationale above doesn't change. For
current state see `CLAUDE.md` ("Status"); for the full step-by-step build log
(including every feature, bug found/fixed, and why decisions were made), see
`docs/HISTORY.md`.

## v3 ideas (backlog)

Nothing here is committed — v2 is feature-complete and these are only candidates if the
game is extended. Don't start on any of these without being asked.

- **Live in-match scores / stats.** Currently only fixtures + final results are refreshed
  from openfootball's periodically-updated JSON; a true live feed would need a different
  data source.
- **Knockout-bracket-specific logic** beyond simple per-match outcome prediction (e.g.
  predicting who advances, bracket-wide scoring).
- **Analysis tab** — a separate tab for statistical analysis and charts (e.g. points
  over time, prediction accuracy trends, crowd-vs-outcome breakdowns, per-player and
  league-wide stats).
- **Real bookmaker odds** — listed in "Deferred (not v1)" above but intentionally
  permanent: the fixed-points model removes the need, so this stays out of scope.
