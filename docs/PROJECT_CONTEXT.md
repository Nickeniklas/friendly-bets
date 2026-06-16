# PROJECT_CONTEXT

Self-contained summary — paste into Claude project knowledge so fresh chats start informed.

## Current status (see CLAUDE.md for full detail)
> **2026-06-16 — scoring model changed: parimutuel pool → fixed-points.** No more
> stakes/pools/multipliers. Players predict each match (home win / draw / away win) and
> score fixed points: correct +10, +5 underdog bonus if the picked outcome got <33% of
> the match's bets, wrong −5. Balances start at 0 and may go negative. Draw is a
> first-class pickable outcome. The daily login bonus was disabled in the same change.
> DB changes: `supabase/migrations/20260616000000_accuracy_points_model.sql`.

**v1 is complete and live** at `https://friendly-bets-rust.vercel.app`. All 8
build-order steps are DONE: Supabase schema/RLS/RPC (incl. `settle_match` and
the `accuracy` view), the `/api/sync` sync+settle job (deployed to Vercel,
cron-job.org triggers it every 5 minutes), magic-link auth (`/login`,
`/auth/confirm`, sign-out, custom SMTP via Brevo), the match list page
(`/matches`, grouped by kickoff date, with a three-way home/draw/away pick, a
crowd-split display, and team flags per match), and the leaderboard +
accuracy page (`/leaderboard`). No known open bugs. The full step-by-step
build log is in `docs/HISTORY.md`.

Post-v1: a daily login bonus with streak multiplier was added (2026-06-13) but
**disabled on 2026-06-16** — under the fixed-points scoring model it just
inflated the prediction score. The app wiring (toast, server action, home-page
streak) was removed; the `claim_daily_bonus()` RPC and `profiles`
streak columns remain dormant in the DB. See `docs/HISTORY.md`.

Also post-v1: `/matches` got a mobile-first redesign (2026-06-13, commit
`02cd971`) built from a Claude Design mockup (`Matches.dc.html`) — sticky
header, dismissible "How to play" card, tap-an-outcome predicting, read-only
confirmed-pick/result rows, and a bottom Matches/Leaderboard tab bar. This also
introduced an app-wide manual dark/light toggle (default dark, `.dark` class +
`fb-dark` in localStorage) that affects every page's `dark:` styling. The
mockup's "Edit bet" control was deliberately not implemented — picks remain
read-only once placed. (The original design's stake quick-pick chips were
removed on 2026-06-16 with the fixed-points model change above.)

The same Claude Design bundle's other two pages followed (2026-06-14):
`/leaderboard` (commit `4ad4e9a`) got a gold/silver/bronze podium for the
top 3 players, a ranked list below, and the existing accuracy table, all in
the shared header/bottom-nav/theme shell. `/login` (commit `117e670`) got a
centered logo + "Sign in" card with the magic-link form, the existing spam/
timing/double-submit warnings restyled as a "Heads up" card, and its own
labeled dark/light toggle pill (it has no header to put `ThemeToggle` in).
All three Claude Design pages are now implemented — no further UI redesign
work is planned.

Also 2026-06-14 (commits `d92506a`/`f75ddf8`): `/matches` kickoff times now
show in Finnish time (`Europe/Helsinki`) instead of UTC (`kickoff_at` is
still stored in UTC — display only), and the match list is now split into
Upcoming/Live/Past tabs (default Upcoming), each date-grouped under sticky
headers with a per-tab match count and empty-state message. New
`src/app/matches/matches-tabs.tsx`. See `docs/HISTORY.md` for details.

Also 2026-06-14: `/leaderboard`'s ranked list (4th+) and accuracy table
(commit `4ad4e9a` above) were replaced (commit `7407268`) with a single
sortable table covering every player — rank, player, points, bets, correct,
wrong, win rate %, streak — joined server-side from `profiles` and the
`accuracy` view, sorted client-side (click a header to sort, click again to
toggle direction; default points descending). The points podium is unchanged.
Separately, `src/middleware.ts` was renamed to `src/proxy.ts` (commit
`4cb951a`, Next.js 16's renamed file convention — no behavior change), and
the `/api/sync` cron-job.org schedule was reduced from every 2-3h to every 5
minutes (external config only, no code change). See `docs/HISTORY.md` for
details on all three.

## Project
A fun, non-commercial prediction site for family & friends, for the 2026 FIFA
World Cup. No real money, ever. v1 scope: view matches, predict home/draw/away, live-ish
scoreboard. Built by an owner who is new to Next.js and has no football knowledge (which
is exactly why the scoring design needs no oddsmaking).

## Stack (settled)
- Next.js on Vercel
- Supabase — Postgres + Auth (magic link) + realtime
- openfootball worldcup.json for fixtures + results (free, no API key)
- No odds — a fixed-points scoring model (correct/underdog/wrong)
- Sync + settlement run together in a protected `/api/sync` route, triggered every 5
  minutes by a free external scheduler (cron-job.org, reduced from every 2-3h on
  2026-06-14). Vercel Hobby cron is once-daily only, so the schedule lives outside
  Vercel.

## How the game works
- Everyone starts at 0 points; balances may go negative.
- Predict a match by picking one of three outcomes — home win / draw / away win. No
  stake, nothing deducted on placement.
- At settlement each bet scores fixed points: correct pick +10; +5 underdog bonus if the
  picked outcome got fewer than 33% of the match's bets (correct underdog = 15); wrong
  pick −5. Draw is a first-class outcome that can be picked and can win. No push/refund.
- Separate from points, an accuracy leaderboard tracks bets placed / correct / wrong /
  win rate % / streak.
- Settlement is automatic: the sync job settles any match with a result, kickoff >3h ago,
  not yet settled. Idempotent, so running every 5 minutes can't double-award.
- (Earlier versions used a parimutuel pool with stakes; replaced by this points model on
  2026-06-16 — see `docs/HISTORY.md`.)

## Key decisions & why
- Fixed-points scoring over fixed odds: owner has no football knowledge; the model needs
  none, and it rewards prediction skill directly.
- Crowd-based underdog bonus over a pool: a "go against the grain" reward without any
  stakes or pool math; makes draws/underdogs worth picking when you're confident.
- openfootball over a paid API: free, no key, and only periodic refresh is needed.

## Build context
- Building in VS Code with Claude Code.
- Owner is new to Next.js — prefers conventional, well-commented code and brief
  explanations of non-obvious choices.

## v2 ideas
- (none currently — "draw as a third pick" shipped in v1 on 2026-06-16, replacing the
  parimutuel pool with a fixed-points scoring model.)
