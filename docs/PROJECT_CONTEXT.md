# PROJECT_CONTEXT

Self-contained summary — paste into Claude project knowledge so fresh chats start informed.

## Current status (see CLAUDE.md for full detail)
**v1 is complete and live** at `https://friendly-bets-rust.vercel.app`. All 8
build-order steps are DONE: Supabase schema/RLS/RPC (incl. `settle_match` and
the `accuracy` view), the `/api/sync` sync+settle job (deployed to Vercel,
cron-job.org triggers it every 5 minutes), magic-link auth (`/login`,
`/auth/confirm`, sign-out, custom SMTP via Brevo), the match list page
(`/matches`, grouped by kickoff date, with a place-bet form, live
pool/multiplier display, and team flags per match), and the leaderboard +
accuracy page (`/leaderboard`). No known open bugs. The full step-by-step
build log is in `docs/HISTORY.md`.

Post-v1: a daily login bonus with streak multiplier is also live —
`claim_daily_bonus()` RPC awards 100-400 points on the first page load each
UTC day (streak-based, capped at day 7), shown via a toast and the home
page's streak display.

Also post-v1: `/matches` got a mobile-first redesign (2026-06-13, commit
`02cd971`) built from a Claude Design mockup (`Matches.dc.html`) — sticky
header, dismissible "How to play" card, tap-a-team-to-bet flow with
50/100/200/500pt quick-pick chips, read-only confirmed-bet/result rows, and a
bottom Matches/Leaderboard tab bar. This also introduced an app-wide manual
dark/light toggle (default dark, `.dark` class + `fb-dark` in localStorage)
that affects every page's `dark:` styling. The mockup's "Edit bet" control
was deliberately not implemented — bets remain read-only once placed.

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

Also 2026-06-14, three more `/matches` polish items: (1) sticky date headers
restyled as a "washi tape" banner — bold green strip with clipped corners,
date + match count (commit `9d9b4bd`); (2) match cards gained a "Bets open"
hint bar (shown before a team is picked, even to logged-in users who haven't
read the instructions), whole-card/team-button hover effects, and a
bounce+green-ring "nudge" on the team buttons when tapping elsewhere on the
card first (commit `290bcc0`); (3) placing a bet no longer redirects/scrolls
to top — `placeBet` (`src/app/matches/actions.ts`) returns a result instead
of `redirect()`ing, shown as a self-dismissing toast, with `router.refresh()`
updating balance/pool/bet state in place (commit `f731c44`, and
`place-bet-button.tsx` was deleted as part of this). See `docs/HISTORY.md`
for all three.

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
- Sync + settlement run together in a protected `/api/sync` route, triggered every 5
  minutes by a free external scheduler (cron-job.org, reduced from every 2-3h on
  2026-06-14). Vercel Hobby cron is once-daily only, so the schedule lives outside
  Vercel.

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
  not yet settled. Idempotent, so running every 5 minutes can't double-pay.

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
