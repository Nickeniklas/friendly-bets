# CLAUDE.md

Operating brief for Claude Code. Read `docs/PLAN.md` and `docs/SCHEMA.md` for full detail.
For a step-by-step account of how v1 was built (including bugs found and fixed along the
way), see `docs/HISTORY.md` — that detail has been moved out of this file to keep this
brief current and short.

## Status (as of 2026-06-14)
**v1 is complete and live** at `https://friendly-bets-rust.vercel.app`. All of
`docs/PLAN.md`'s build order (steps 1-8) is DONE:

- Supabase schema, RPC (`settle_match`), `accuracy` view, RLS, and GRANTs are applied.
- `/api/sync` is deployed, protected by `SYNC_SECRET`, and triggered every 5 minutes by
  cron-job.org (syncs openfootball fixtures/results and auto-settles finished matches).
- Magic-link auth (`/login`, `/auth/confirm`, sign-out) works via custom SMTP (Brevo).
- `/matches` splits all fixtures into Upcoming/Live/Past tabs, date-grouped under sticky
  headers, with a place-bet form per bettable match and a live pool/multiplier display
  per side. Kickoff times are shown in Finnish time.
- `/leaderboard` shows a points podium (top 3) plus one sortable all-players table
  (points, bets, correct, wrong, win %, streak).
- Vercel Web Analytics is enabled.

Post-v1 polish:
- `/login` now shows a persistent reminder (plus a post-submit message) to check
  spam/junk for the magic-link email, since the Brevo sending address has no domain
  reputation yet (commit `a85216a`).
- `/matches` now shows a small flag next to each team name (`src/components/flag.tsx`,
  `src/lib/flags.ts`, SVGs in `public/flags/` — see README "Team flags").
- Daily login bonus with streak multiplier is live: the first page load each UTC
  day awards 100-400 points (100 + 50/day, capped at day 7 = 400; resets to 1 if a
  day is skipped), via `claim_daily_bonus()` (migration
  `20260613000000_daily_bonus.sql`), `claimDailyBonus()` server action
  (`src/app/actions.ts`), and `DailyBonusToast` (`src/components/daily-bonus-toast.tsx`).
  Home page also shows the current streak. Verified live by the owner — see
  `docs/HISTORY.md`.
- `/matches` got a mobile-first visual redesign (commit `02cd971`, merged to
  `main` 2026-06-13), implemented from a Claude Design mockup
  (`Matches.dc.html`): sticky header with balance pill + dark/light toggle, a
  dismissible "How to play" card (`intro-card.tsx`), tap-a-team-to-bet flow
  (`match-card.tsx` — bet panel with 50/100/200/500pt quick-pick chips and a
  live potential-win estimate), read-only confirmed-bet/result rows, and a
  fixed bottom Matches/Leaderboard tab bar (`bottom-nav.tsx`). The dark/light
  toggle (default dark) is app-wide — see "Theme" below.
- `/leaderboard` got the matching redesign (commit `4ad4e9a`, 2026-06-14),
  implemented from the same Claude Design bundle's `Leaderboard.dc.html`:
  same sticky header (brand + `ThemeToggle`, no balance pill) and bottom nav
  as `/matches`, and a podium for the top 3 players (gold/silver/bronze
  circular avatars with initials over medal-colored bases —
  `PODIUM_CONFIG` in `src/app/leaderboard/page.tsx`). Falls back to no podium
  if there are fewer than 3 players. New podium color tokens added to
  `globals.css`: `--gold-bg`, `--gold-text`, `--gold-base-bg`, `--silver-*`,
  `--bronze-*` (light + dark).
- `/leaderboard`'s ranked list (4th+) and separate accuracy table were later
  replaced by **one sortable all-players table** (commit `7407268`,
  2026-06-14) — `src/components/leaderboard-table.tsx` (`LeaderboardTable`,
  `"use client"`). The podium above is unchanged (still points-only, top 3,
  not sortable). The table covers every player with columns rank, player,
  points, bets placed, correct, wrong, win rate %, streak; all six numeric
  columns are sortable by clicking the header (toggles ascending/descending,
  ▲/▼ shows the active column; default is points descending), and rank
  recomputes to match. `src/app/leaderboard/page.tsx` joins `profiles` +
  the `accuracy` view into one row per player (players with no settled bets
  default to zeros, since they're absent from `accuracy`) and passes that to
  `LeaderboardTable`, which sorts entirely client-side — no refetch on
  re-sort. See `docs/HISTORY.md`.
- `/login` got the matching redesign (commit `117e670`, 2026-06-14),
  implemented from the same bundle's `Login.dc.html`: centered ⚽ Friendly
  Bets / World Cup 2026 logo, a "Sign in" card (email input + green "Send
  magic link →" button, reusing the existing `signInWithMagicLink` action and
  `SubmitButton` pending-state pattern), the existing spam/timing/
  double-submit warnings restyled as a "Heads up" card, and a labeled
  dark/light toggle pill below the card (`src/app/login/theme-toggle-pill.tsx`,
  `ThemeTogglePill` — same `useTheme` hook as `ThemeToggle`, styled per the
  design since `/login` has no header). New tokens added to `globals.css`:
  `--input-bg`, `--warn-bg`, `--warn-border` (light + dark).

- `/matches` kickoff times now display in Finnish time (`Europe/Helsinki`,
  handles the EET/EEST DST switch automatically) instead of UTC — only the
  display changed, `kickoff_at` is still stored in UTC. Commit `d92506a`.
- `/matches` is now split into Upcoming/Live/Past tabs (default Upcoming),
  each date-grouped under sticky headers with a match count and an
  empty-state message. Upcoming/Live are soonest-first; Past is
  most-recent-first. New `src/app/matches/matches-tabs.tsx` (`MatchesTabs`)
  plus `groupByDay()`/`renderMatchCard()`/`renderDayGroups()` helpers in
  `src/app/matches/page.tsx`. Commit `f75ddf8`. See `docs/HISTORY.md` for
  details.
- `/matches`' sticky date headers are now a "washi tape" style banner —
  bold green strip with the date + match count and clipped/angled corners
  (`clipPath: polygon(...)` in `renderDayGroups()`,
  `src/app/matches/page.tsx`). Commit `9d9b4bd`.
- Match cards on `/matches` (`match-card.tsx`) got three polish items: a
  "Bets open" hint bar (shown on any bettable match with no bet yet and no
  team picked, even before a team is tapped — copy/CTA varies by login
  state), whole-card + team-button hover effects (`shadow-md`, team buttons
  also lift via `-translate-y-0.5`), and a "nudge" animation (450ms bounce +
  green ring on both team buttons, via `@keyframes nudge` in `globals.css`)
  when tapping anywhere else on a bettable card before picking a team. Commit
  `290bcc0`.
- Placing a bet on `/matches` no longer causes a full page navigation/scroll-
  to-top. `placeBet` (`src/app/matches/actions.ts`) returns a
  `PlaceBetResult` instead of `redirect()`ing; `match-card.tsx` calls it
  directly from a click handler, shows the result as a self-dismissing toast
  fixed above the bottom nav, and on success calls `router.refresh()` to
  re-fetch balance/pool/bet state in place. `place-bet-button.tsx` was
  deleted (its `useFormStatus` pattern no longer applies — see Gotchas).
  Commit `f731c44`.

All three pages from the Claude Design bundle (`Matches.dc.html`,
`Leaderboard.dc.html`, `Login.dc.html`) are now implemented and visually
consistent (shared header/bottom-nav/theme system where applicable). No known
open bugs and no further UI redesign work is planned — anything else is a v2
idea (see `docs/PLAN.md` "v2 ideas"), not part of the original plan, don't
start on these without being asked.

- `src/middleware.ts` was renamed to `src/proxy.ts` (commit `4cb951a`,
  2026-06-14) — Next.js 16 renamed this file convention from "middleware" to
  "proxy" (`config.matcher` export unchanged). Purely a naming/convention
  change, no behavior change. If you see references to "middleware" in older
  docs/comments, they mean this file.
- `/api/sync`'s cron-job.org schedule was reduced from every 2-3h to every 5
  minutes (2026-06-14, external config change, no code) — see "Cron setup"
  below. The openfootball source itself isn't updated live, so this doesn't
  bring live in-match scores any sooner; the real benefit is that
  `settle_match` now fires within ~5 minutes of a match crossing the
  3-hour-post-kickoff threshold, instead of up to ~3h late.

## Cron setup (DONE — reference only)
1. Go to https://cron-job.org, sign up / log in.
2. Create a new cronjob:
   - URL: `https://friendly-bets-rust.vercel.app/api/sync`
   - Schedule: every 5 minutes (reduced from every 2-3h on 2026-06-14 — see
     "Status" above; cron-job.org's free tier supports down to 1-minute
     intervals)
   - Request method: GET
   - Add a custom header: `Authorization: Bearer <SYNC_SECRET>` (value from
     `.env.local` / Vercel project env vars — do not commit it anywhere)
3. Save, then use cron-job.org's "Run now" / test execution to confirm it
   returns `{"synced": <n>, "settled": [...]}` with HTTP 200.

## Email / SMTP (DONE — reference only)
Supabase's default/shared email service caps magic-link sends at 2/hour
project-wide (`supabase/config.toml` `[auth.rate_limit] email_sent = 2` —
that's the default for *every* Supabase project, hosted included). During
early testing this got exhausted, and a login attempt failed immediately with
"Email rate limit exceeded" / `error_code: over_email_send_rate_limit` and
sent nothing.

Fixed with custom SMTP via Brevo (https://www.brevo.com, free tier — 300
emails/day, no domain required):
- Brevo: a sender email is verified under Settings -> Senders, Domains &
  Dedicated IPs -> Senders.
- Brevo: Settings -> SMTP & API -> SMTP tab gives a dedicated SMTP login
  (format `xxxxx@smtp-brevo.com` — **not** the Brevo account email) and an
  SMTP key (generated once, shown only at creation time).
- Supabase Dashboard -> Authentication -> Emails -> SMTP Settings: Custom
  SMTP enabled, host `smtp-relay.brevo.com`, port `587`, username = the
  `xxxxx@smtp-brevo.com` login, password = the SMTP key, sender = the
  verified Brevo sender address.
- Supabase Dashboard -> Authentication -> Rate Limits -> "Rate limit for
  sending emails" raised from 2 to ~30/hour (now bounded by Brevo's quota,
  not Supabase's shared mailer).

These credentials live ONLY in the Supabase dashboard — not in `.env.local`,
not in Vercel env vars, not committed anywhere. This app never talks to
Brevo directly; only Supabase's auth server does.

Since this sender has no domain reputation yet, first-time recipients often
find the magic-link email in spam/trash. `/login` now tells users this
directly (see Gotchas) — no need to repeat it when sharing the link.

## Theme: dark/light toggle (DONE — reference only)
The whole app's dark mode is now a manual, app-wide toggle (default dark)
instead of following OS preference:

- `src/app/globals.css` defines color tokens (`--background`, `--foreground`,
  `--surface`, `--surface-2`, `--line`, `--muted`, `--green*`, `--gold`,
  `--red`, all OKLCH) in `:root` (light) and `.dark` (dark), plus
  `@custom-variant dark (&:where(.dark, .dark *));` — this repoints every
  `dark:` Tailwind utility (across `/`, `/login`, `/leaderboard`, `/matches`)
  at a `.dark` class on `<html>` instead of `prefers-color-scheme`.
- `src/components/theme-provider.tsx` exports `ThemeProvider`/`useTheme`
  (tracks the toggle via `useSyncExternalStore` on
  `document.documentElement.classList`, persists to
  `localStorage['fb-dark']`; default is dark — anything other than the
  literal string `'false'`) and `themeScript`, a string of inline JS.
- `src/app/layout.tsx` injects `themeScript` into `<head>` so the `.dark`
  class is applied *before* React hydrates (no flash of the wrong theme),
  and wraps the app in `ThemeProvider`. Because that script mutates
  `<html>`'s class before hydration, `<html>` has `suppressHydrationWarning`
  — see Gotchas.
- `src/components/theme-toggle.tsx` (`ThemeToggle`, ☀/🌙 button) is rendered
  in both `/matches`' and `/leaderboard`'s sticky headers. `/login` has no
  header, so it instead gets its own labeled pill toggle
  (`src/app/login/theme-toggle-pill.tsx`, `ThemeTogglePill`) below the
  sign-in card — same `useTheme` hook, styled per `Login.dc.html`. The home
  page (`/`) has no toggle control yet but still follows whatever `.dark`
  state is set.
- Font is now `next/font/google`'s `Space Grotesk` (`--font-space-grotesk` in
  `src/app/layout.tsx` / `globals.css`), replacing the default Geist fonts.

## What we're building
A non-commercial World Cup 2026 prediction game for family & friends. No real money.
People bet points on match winners; a parimutuel pool decides payouts. Everyone starts
at 1000 points. Separate accuracy leaderboard tracks raw prediction skill.

## Stack (decided — do not re-litigate without being asked)
- Next.js on Vercel
- Supabase: Postgres + Auth (magic link) + realtime
- Match data: openfootball `worldcup.json` (free, no key), synced every 5
  minutes via cron-job.org → `/api/sync`
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
- Push rule: if nobody picked the winning side, refund all stakes on that match. Note
  this applies per-side, not just "everyone": if the *only* bet on a match is on the
  losing side (winning side has zero stake), that lone bet is refunded too — it looks
  like "a loss got refunded" but is correct per this rule. Confirmed working as
  designed (2026-06-13), e.g. South Korea vs Czech Republic where the only bet was 50pts
  on Czech Republic (lost) and it was refunded because nobody bet on South Korea.
- Draw (any stage) = push/refund-all for v1 (picks are team1/team2 only; no 'draw' pick).
  v2 may add 'draw' as a real third pick — not now.
- Balances never change via direct client writes — only via bet insert, settlement RPC,
  and the daily-bonus RPC. Lock this down with RLS; settlement and the daily-bonus RPC
  are both security-definer.
- Daily login bonus (`claim_daily_bonus`) is awarded at most once per UTC calendar day
  per user, via a single atomic `UPDATE ... WHERE` guard (not SELECT-then-UPDATE) —
  this is what makes concurrent page loads/tabs safe. Streak resets to 1 if a day is
  skipped; caps at 7 (400-point bonus). Called once per app load from a client
  component (`DailyBonusToast`) via a Server Action (`claimDailyBonus`), not a cron
  job — explicitly lazy/on-load.

## Build order
All steps DONE — see `docs/PLAN.md` for the full table and `docs/HISTORY.md` for the
step-by-step build log:
1. Supabase schema (tables, RPC, view, RLS) — see SCHEMA.md
2. openfootball sync + auto-settle (`/api/sync`, cron-job.org)
3. Next.js skeleton + Supabase client helpers + magic-link auth
4. Match list page (`/matches`)
5. Place-bet flow (`placeBet` server action)
6. `settle_match` RPC (idempotent, called by the sync job)
7. Leaderboard + accuracy view (`/leaderboard`)
8. Polish: pool / implied multiplier display on `/matches`

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
- Magic-link auth: Supabase's *default* email service won't let you edit email
  templates (Authentication -> Email Templates shows "Set up custom SMTP to edit
  templates"). No need — `@supabase/ssr` defaults to the PKCE flow, so the default
  "Magic Link" email's link goes through Supabase's hosted `/auth/v1/verify` and
  redirects back to `emailRedirectTo` with `?code=...`. `/auth/confirm/route.ts`
  exchanges that via `exchangeCodeForSession` (it also accepts `token_hash`/`type`
  as a fallback if custom SMTP + a customized template are set up later). Only
  manual step needed is Authentication -> URL Configuration: Site URL = the
  Vercel URL, and Redirect URLs include both the Vercel URL and
  `http://localhost:3000/**`. DONE.
- PKCE magic links + double-submit: each call to `signInWithOtp` writes a new
  PKCE `code_verifier` to a cookie, overwriting the previous one. If a user
  submits the login form twice (e.g. because nothing visibly happened), the
  *first* email's link now points to a `code` whose verifier was just
  overwritten — `exchangeCodeForSession` for that link fails. Only the
  *second* (latest) email's link still works. Mitigated by
  `src/app/login/submit-button.tsx` (a small client component using
  `useFormStatus`) which disables the button and shows "Sending..." on
  submit, so the round-trip to Supabase is visible and double-clicks are
  prevented. If a user does end up with two emails, tell them to use the
  most recently received one.
- `deduct_stake_on_bet()` (the AFTER INSERT trigger on `bets` that subtracts
  the stake from `profiles.points_balance`) must be `SECURITY DEFINER` —
  triggers run as the inserting role (`authenticated` for a logged-in user),
  which only has GRANT SELECT on `profiles`, so a non-definer UPDATE fails
  with "permission denied for table profiles". Fixed in
  `supabase/migrations/20260611000000_fix_deduct_stake_security_definer.sql`
  (mirrors the `SECURITY DEFINER` pattern already used by `handle_new_user`
  and `settle_match`). Same caution applies to any future trigger that writes
  to a table the calling role doesn't have a GRANT/RLS policy for.
- Convention: any `<form action={serverAction}>` whose action does a real
  network round-trip (DB write, Supabase Auth call, etc.) should have its
  submit button as a small `"use client"` component using
  `useFormStatus().pending` to show a "Verb-ing..." label and disable the
  button. See `src/app/login/submit-button.tsx` for the pattern. Without
  this, slow round-trips look unresponsive and invite double-submits, which
  surface as confusing errors (stale magic-link, duplicate-bet constraint,
  etc.). Exception: `placeBet` (`src/app/matches/actions.ts`) is called
  directly from a click handler instead of a `<form action>` — see the
  "Placing a bet..." entry under Status — because it needs to show a toast
  and `router.refresh()` without navigating, which a `<form>`+`redirect()`
  can't do. `match-card.tsx` tracks its own `pending` state for the button
  instead of `useFormStatus`.
- CSS specificity: team-pick buttons in `match-card.tsx` set
  `background`/`borderColor`/`color` via inline `style={teamStyle(...)}`
  (computed per-render for selected/winner/flagged states). Inline styles
  beat Tailwind `:hover`/animation classes for the *same* properties, so any
  new hover/highlight effect on these buttons must use properties
  `teamStyle()` doesn't set — e.g. `transform`/`translate` (hover lift) or
  `box-shadow`/`ring` (hover shadow, the "nudge" ring) — or it'll be silently
  overridden. Also: Tailwind v4's `-translate-y-*` utilities set a separate
  `translate` CSS property, not `transform` — check
  `getComputedStyle(el).translate`, not `.transform`, when verifying via
  Playwright.
- `eslint-plugin-react-hooks` v7's `set-state-in-effect` rule flags any
  synchronous `setState` call directly in a `useEffect` body — including the
  common "copy a server action's result into state + trigger a side effect"
  pattern (e.g. `useActionState` + an effect that does
  `setToast(result); router.refresh()`). If you hit this, move the logic into
  the event handler that triggers the action instead (event handlers are
  always fine for `setState`) — see how `match-card.tsx`'s `handlePlaceBet`
  does this. `setState` inside a `setTimeout`/promise callback *within* an
  effect (e.g. an auto-dismiss timer, like `DailyBonusToast`) is NOT flagged
  — only direct, synchronous calls in the effect body are.
- Magic-link emails sent via Brevo (see "Email / SMTP" above) may land in
  spam/trash for first-time recipients, since the sending address has no
  reputation yet. `src/app/login/page.tsx` now shows a persistent reminder
  about this, and `src/app/login/actions.ts`'s post-submit success message
  repeats it — so this no longer needs to be said manually when sharing the
  link. This should improve over time as the address sends more mail.
- `claim_daily_bonus()` is idempotent by design (date-guarded atomic UPDATE),
  so `DailyBonusToast` (`src/components/daily-bonus-toast.tsx`) can safely
  call it on every mount without separate "first request of the day"
  tracking — already-claimed-today calls just return 0 and render nothing.
- If a client-side script mutates an attribute React also controls on an
  element before/during hydration (e.g. `themeScript` toggling the `.dark`
  class on `<html>` — see "Theme" above), React throws a hydration-mismatch
  error comparing the server-rendered attribute to the client's. Fixed by
  adding `suppressHydrationWarning` to that element (`<html>` in
  `src/app/layout.tsx`) — the standard next-themes-style fix. Apply the same
  fix to any future element whose attributes get patched by a pre-hydration
  inline script.

## Secrets
Supabase URL, anon key, service-role key, SYNC_SECRET, and NEXT_PUBLIC_SITE_URL live
in `.env.local` (copy from `.env.local.example`; same vars go into Vercel project env
when deployed — set NEXT_PUBLIC_SITE_URL to the Vercel URL there). Service-role key is
server-only — never ship it to the client. The `/api/sync` route checks a shared secret
(`SYNC_SECRET`) passed by the external scheduler — store it in env, never commit it.
Never commit `.env*.local`.

Note: Supabase's dashboard now shows new "Publishable"/"Secret" key formats by default,
with the old `anon`/`service_role` JWTs under "Legacy API Keys" — both work identically
with `@supabase/supabase-js`. This project currently uses the legacy JWT keys.
