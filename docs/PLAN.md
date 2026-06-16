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
- View the match list (fixtures + results), synced periodically from openfootball
  (every 5 minutes — see Stack table below).
- Place a bet on a match: pick a side, stake points. Points deducted immediately.
- Parimutuel settlement: winners split the pool proportional to stake.
- Seed rule: thin pools topped up to 300.
- Push rule: if nobody picked the winning side, all bets on that match are refunded.
- Everyone starts with 1000 points.
- Leaderboard: points balance.
- Accuracy stats (separate from points): bets placed, correct, wrong, win rate %, streak.

### Deferred (not v1)
- Live in-match scores / stats (we only refresh fixtures + final results from
  openfootball's periodically-updated JSON, not a live feed).
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
| Match data | openfootball worldcup.json | Free, public-domain JSON. No API key, no rate limits. Synced every 5 minutes; the same job auto-settles finished matches. |
| Scheduling | External cron (cron-job.org) → `/api/sync` | Vercel Hobby cron is **once-per-day only**; sub-daily is Pro ($20/mo). So the sync+settle lives in a normal API route, triggered by a free external scheduler every 5 minutes (reduced from every 2–3h on 2026-06-14 — cron-job.org's free tier supports down to 1-minute intervals). Route is protected by a shared secret. |
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
openfootball JSON ──(sync job, every 5 min)──> Supabase: matches table
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

## Post-v1 polish (done)
- Spam/trash folder reminder on `/login` (2026-06-13) — Brevo's sending address has
  no domain reputation yet, so first-time magic-link emails often land in spam. See
  `docs/HISTORY.md` and `CLAUDE.md` ("Email / SMTP").
- Team flags on `/matches` (2026-06-13) — small flag next to each team name, via
  flag-icons SVGs in `public/flags/`. See `docs/HISTORY.md` and README ("Team flags").
- Daily login bonus with streak multiplier (2026-06-13) — first page load each UTC
  day awards 100-400 points based on a login streak (capped at 7 days), via
  `claim_daily_bonus()` RPC + a toast on every page. See `docs/HISTORY.md` and
  README ("Daily login bonus").
- `/matches` mobile-first redesign + app-wide dark/light toggle (2026-06-13,
  commit `02cd971`) — implemented from a Claude Design mockup
  (`Matches.dc.html`): sticky header, "How to play" card, tap-to-bet flow with
  quick-pick stake chips, bottom tab bar, and a manual dark/light theme
  applied across the whole app. See `docs/HISTORY.md`, `CLAUDE.md` ("Theme:
  dark/light toggle"), and README ("Place a bet", "Theme").
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
- `/matches` "washi tape" date headers (2026-06-14, commit `9d9b4bd`) —
  sticky per-day headers restyled as a bold green clipped-corner banner with
  the date + match count. See `docs/HISTORY.md` and README ("Match list").
- Match card polish: "Bets open" bar, hover effects, nudge animation
  (2026-06-14, commit `290bcc0`) — a green "Bets open" hint on any bettable
  match before a team is picked, whole-card/team-button hover
  shadow+lift, and a bounce+ring "nudge" on the team buttons when tapping
  elsewhere on the card first. See `docs/HISTORY.md` and README ("Place a
  bet").
- Bet placement: toast + no scroll-jump (2026-06-14, commit `f731c44`) —
  placing a bet no longer redirects/scrolls to top; `placeBet` returns a
  result shown as a self-dismissing toast, and `router.refresh()` updates
  the page in place. See `docs/HISTORY.md` and README ("Place a bet").

## Open items
- Exact "thin pool" trigger is decided: top up to **300**. (Settled.)
- Settlement is automatic: the sync job (every 5 minutes) settles any match with a result,
  kickoff >3h ago, not yet settled. Idempotent — already-settled matches are skipped.
  (Settled.)
- Draw handling is decided: a group-stage draw is a **push** for v1 — all bets on that
  match are refunded. Picks are team1/team2 only. (Settled.)

## v2 ideas (not now)
- Draw as a third pick — let people bet on a draw, with its own pool side. Adds UI and
  changes settlement (three sides instead of two). Deferred to v2.
