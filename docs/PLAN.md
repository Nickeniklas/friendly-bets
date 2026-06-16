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

## Build order (bottom-up)

Status detail lives in `CLAUDE.md` ("Status" section) — kept current there so it
doesn't drift across two files. The full step-by-step build log (incl. bugs found
and fixed) is in `docs/HISTORY.md`.

1. DONE — Supabase project + schema (tables, RPC, views, RLS). See `SCHEMA.md`.
2. DONE — openfootball sync — a protected API route (`/api/sync`) that pulls JSON, upserts into
   `matches`, then auto-settles any match with a result, kickoff >3h ago, not yet settled.
   Deployed to Vercel and triggered by an external scheduler (cron-job.org, free) every
   5 minutes (originally every 2–3h, reduced 2026-06-14), NOT Vercel cron (Hobby is
   once-daily only). Route checks a shared secret so only the scheduler can run it.
3. DONE — Next.js skeleton + Supabase client helpers + magic-link auth (`/login`,
   `/auth/confirm`, session-refresh middleware, sign-out). Works with Supabase's
   default email template (no custom SMTP needed) via PKCE `code` exchange.
   Supabase Authentication -> URL Configuration is set up. Remaining: add
   `NEXT_PUBLIC_SITE_URL` to Vercel project env vars (see CLAUDE.md).
4. DONE — Match list page (read matches). `src/app/matches/page.tsx`, grouped
   by kickoff date, linked from the home page.
5. DONE — Place-pick flow (insert bet, guarded by match status). `src/app/matches/page.tsx`
   shows a three-way pick (home/draw/away) per bettable match;
   `src/app/matches/actions.ts` (`placeBet`) just inserts into `bets` — the
   `enforce_bet_window` trigger + UNIQUE constraint do all enforcement.
6. DONE — Settlement RPC (built as part of step 1; called by the sync job in step 2; idempotent).
   Rewritten 2026-06-16 for the fixed-points model.
7. DONE — Leaderboard (points) + accuracy stats view. `src/app/leaderboard/page.tsx`,
   linked from the home page and `/matches`.
8. DONE — Polish: show the crowd split (% of picks per outcome) on each match.
   `src/app/matches/page.tsx` fetches all bets' `match_id, pick` alongside the
   matches query (RLS allows anon read), counts picks per match/outcome, and
   shows "X% Home · Y% Draw · Z% Away" on each card — which also surfaces the
   underdog-bonus mechanic (any outcome under 33%).

## Post-v1 polish (done)
- Spam/trash folder reminder on `/login` (2026-06-13) — Brevo's sending address has
  no domain reputation yet, so first-time magic-link emails often land in spam. See
  `docs/HISTORY.md` and `CLAUDE.md` ("Email / SMTP").
- Team flags on `/matches` (2026-06-13) — small flag next to each team name, via
  flag-icons SVGs in `public/flags/`. See `docs/HISTORY.md` and README ("Team flags").
- Daily login bonus with streak multiplier (2026-06-13) — **disabled 2026-06-16**
  (it inflated the prediction score under the fixed-points model). Awarded 100-400
  points on first page load each UTC day based on a login streak. App wiring removed;
  `claim_daily_bonus()` RPC + `profiles` streak columns remain dormant. See
  `docs/HISTORY.md` and README ("Daily login bonus (disabled)").
- `/matches` mobile-first redesign + app-wide dark/light toggle (2026-06-13,
  commit `02cd971`) — implemented from a Claude Design mockup
  (`Matches.dc.html`): sticky header, "How to play" card, tap-to-pick flow,
  bottom tab bar, and a manual dark/light theme applied across the whole app.
  (The original quick-pick stake chips were removed on 2026-06-16 with the
  fixed-points model change.) See `docs/HISTORY.md`, `CLAUDE.md` ("Theme:
  dark/light toggle"), and README ("Place a prediction", "Theme").
- `/leaderboard` redesign (2026-06-14, commit `4ad4e9a`) — implemented from
  the same bundle's `Leaderboard.dc.html`: gold/silver/bronze podium for the
  top 3, ranked list for the rest, accuracy table. See `docs/HISTORY.md` and
  README ("Leaderboard"). The ranked list + accuracy table were later
  replaced — see below.
- `/login` redesign (2026-06-14, commit `117e670`) — implemented from the
  same bundle's `Login.dc.html`: centered logo, "Sign in" card with magic-link
  button, "Heads up" warnings card, labeled theme-toggle pill. See
  `docs/HISTORY.md` and README ("Theme").

All three pages from the Claude Design bundle are now implemented — no
further UI redesign work planned.

- `/matches` Finnish kickoff times + Upcoming/Live/Past tabs (2026-06-14,
  commits `d92506a`/`f75ddf8`) — kickoff times now show in Finnish time
  (`Europe/Helsinki`) instead of UTC, and the match list is split into
  Upcoming/Live/Past tabs with date-grouped sticky headers, per-tab counts,
  and empty states. See `docs/HISTORY.md` and README ("Match list"). This was
  added after the redesign bundle above, so it's not part of those three
  pages' visual redesign.
- `/leaderboard`: podium + one sortable all-players table (2026-06-14,
  commit `7407268`) — replaced the ranked list (4th+) and separate accuracy
  table with a single table covering every player (rank, player, points,
  bets, correct, wrong, win rate %, streak), sortable client-side by any of
  the six numeric columns (click a header to sort, click again to toggle
  direction; default points descending). The points podium (top 3) is
  unchanged. See `docs/HISTORY.md` and README ("Leaderboard").
- `/api/sync` cron interval reduced from every 2-3h to every 5 minutes
  (2026-06-14, cron-job.org config change, no code) — settlement now fires
  within ~5 minutes of a match crossing the 3h-post-kickoff threshold instead
  of up to ~3h late. See `docs/HISTORY.md`.
- Renamed `src/middleware.ts` → `src/proxy.ts` (2026-06-14, commit `4cb951a`)
  — Next.js 16 renamed this file convention; `config.matcher` unchanged, no
  behavior change. See `docs/HISTORY.md`.

## Open items
- Scoring is decided: correct +10, underdog (<33% of picks) bonus +5, wrong −5;
  balances start at 0 and may go negative. (Settled.)
- Settlement is automatic: the sync job (every 5 minutes) settles any match with a result,
  kickoff >3h ago, not yet settled. Idempotent — already-settled matches are skipped.
  (Settled.)
- Draw handling is decided: draw is a first-class pickable outcome (one of
  team1/draw/team2), scored exactly like any other correct/wrong pick. No push/refund.
  (Settled — promoted from a v2 idea on 2026-06-16.)

## v2 ideas (not now)
- (none currently)
