# HISTORY — build log

Detailed, chronological record of how v1 (`docs/PLAN.md` steps 1-8, plus
post-v1 polish) was built. `CLAUDE.md` keeps only the current-state summary;
this file is the full story, kept for reference — not required reading to
continue work, but useful if you need to know *why* something is the way it
is.

## Step 1 — Supabase schema, RPC, view, RLS
DONE. Migrations applied and verified against the live project:
`supabase/migrations/20260609000000_initial_schema.sql` and
`supabase/migrations/20260610120000_grants.sql`.

## Step 2 — `/api/sync` route
DONE. Deployed to Vercel (project linked to `Nickeniklas/friendly-bets` on
GitHub for auto-deploys on push to `main`), env vars set (Supabase URL/anon/
service-role keys + `SYNC_SECRET`), and verified live at
`https://friendly-bets-rust.vercel.app/api/sync`
(`{"synced":104,"settled":[]}`). cron-job.org is set up and calling this URL
on a schedule (200 OK confirmed).

## Step 3 — Next.js skeleton
DONE. Supabase client helpers (`src/lib/supabase/client.ts`,
`src/lib/supabase/server.ts`), session-refresh middleware
(`src/middleware.ts`), and magic-link auth (`/login`, `/auth/confirm`,
sign-out action) are built. Home page shows logged-in state + points balance.
Lint/build/dev smoke-tested locally. Pushed to `main` (commit `615ad96`),
Vercel auto-deployed.

`/auth/confirm` handles both the default Supabase email template (PKCE
`?code=...` -> `exchangeCodeForSession`, no custom SMTP needed) and a
customized `token_hash`/`type` template if custom SMTP is set up later.
Supabase dashboard Authentication -> URL Configuration (Site URL + Redirect
URLs) is DONE.

`NEXT_PUBLIC_SITE_URL` is set in Vercel's project Environment Variables
(Production + Preview), and a redeploy ran after it was added — verified via
`vercel env ls` and `vercel inspect` (the live `friendly-bets-rust.vercel.app`
alias points to a deployment built after the env var was set).

## Step 4 — match list page
DONE. `src/app/matches/page.tsx` is a Server Component that reads `matches`
(RLS allows anon read, so no auth needed), groups fixtures by kickoff date
(UTC), and shows team names, stage/group label, kickoff time, and status
(`Upcoming` / `Awaiting result` / settled result). Linked from the home page
(logged-in and logged-out states). Lint/build/dev smoke-tested locally (104
matches render correctly).

## Step 5 — place-bet flow
DONE, verified live by the owner. On `src/app/matches/page.tsx`, each
bettable match (status = `scheduled` AND now() < kickoff_at) shows a small
inline form (pick team1/team2 + stake, default/placeholder stake 100) for
logged-in users, a "Log in to bet" link for logged-out visitors, and "Your
bet: ..." (with outcome/payout once settled) if the user already bet on that
match. The form posts to the `placeBet` server action
(`src/app/matches/actions.ts`), which just inserts into `bets` — all
enforcement (bet window, balance check, one-bet-per-match) is done by the
existing DB triggers/constraints. Postgres errors are translated into
friendly messages via `?error=` (mirrors `/login`'s `?message=`/`?error=`
pattern). Logged-in users see their points balance at the top of the page.

Two bugs found during live testing, both fixed and deployed:
- "permission denied for table profiles" on first bet — `deduct_stake_on_bet()`
  needed `SECURITY DEFINER` (see CLAUDE.md Gotchas). Migration
  `20260611000000_fix_deduct_stake_security_definer.sql` applied live via
  `npx supabase db push`.
- Both `/login` and the bet form had no pending-state feedback, so a slow
  round-trip invited a double-click → confusing errors (stale magic-link
  code-verifier; duplicate-bet constraint). Fixed with small client
  components using `useFormStatus`: `src/app/login/submit-button.tsx`
  ("Sending...") and `src/app/matches/bet-button.tsx` ("Placing..."). This
  `useFormStatus` pattern became the convention for any form backed by a
  server action. (`bet-button.tsx` was later replaced by
  `place-bet-button.tsx` during the 2026-06-13 matches redesign — see below —
  but the pattern itself is unchanged.)

Owner confirmed the full flow works end-to-end on the live site (bet placed,
balance deducted, "Your bet: ..." shown).

## Step 7 — leaderboard + accuracy view
DONE. New page `src/app/leaderboard/page.tsx` is a Server Component (RLS
allows anon read, so no auth needed) with two sections: a Points leaderboard
(`profiles` ordered by `points_balance` desc) and an Accuracy table (the
existing `accuracy` view — W-L, win %, streak — ordered by win rate then bets
placed), with a friendly empty state until any match settles. Linked from the
home page (both logged-in/out states) and from `/matches`. Lint/build pass;
smoke-tested on the dev server (renders the one existing profile at 800 pts;
accuracy shows the empty state since nothing has settled yet).

Also during this period: Vercel Web Analytics enabled (`@vercel/analytics`
installed, `<Analytics />` added to `src/app/layout.tsx`).

## Custom SMTP (Brevo) setup
Configured to fix the magic-link "rate limit exceeded" issue (Supabase's
shared mailer caps at 2 emails/hour). Verified live: a direct `/auth/v1/otp`
test returned HTTP 200 (was HTTP 500 rate-limited before) and the email was
received (landed in spam — expected for a brand-new sending domain). Full
setup steps preserved in `CLAUDE.md` ("Email / SMTP").

## Step 8 — polish: pool/multiplier display
DONE. `src/app/matches/page.tsx` now fetches every bet's `match_id, pick,
stake` (RLS allows anon read) alongside the matches query, sums stakes per
match/pick into a `poolsByMatch` map, and renders "Pool: N pts · TeamA Xx ·
TeamB Yx" on each match card via a new `PoolInfo` component. The pot and
per-side multiplier (`pot / side_stake`, seeded to 300 if the total pool is
thin) mirror `settle_match`'s payout math exactly, so the numbers shown match
what would actually be paid out if the match settled right now. A side with
no stake shows "—" (would be a push/refund if it won). Lint/build pass;
smoke-tested on the dev server.

This was the last item in the original build order — `docs/PLAN.md` steps
1-8 all DONE, v1 shipped.

## Post-v1 — spam/trash folder reminder (2026-06-13)
Since Brevo's sending address has no domain reputation yet, magic-link emails
often land in spam/trash for first-time recipients (see CLAUDE.md "Email /
SMTP" and the related Gotcha). To cut down on "no email arrived" pings when
sharing the link with friends, added a UI reminder on `/login`
(`src/app/login/page.tsx`): a persistent tip below the form, plus the
post-submit success message (`src/app/login/actions.ts`) now also says to
check spam/junk. Lint passes. Commit `a85216a`.

## Push-rule clarification: lone bet on the losing side gets refunded (2026-06-13)
Owner asked why a *lost* bet (50pts on Czech Republic, South Korea won) showed as
"refunded" rather than just lost. Answer: it was the only bet on the match, and
nobody bet on South Korea (the winning side), so `v_winning_stake = 0` in
`settle_match` and the existing push-rule branch (refund everyone) fired — same
code path as "nobody picked the winner." Working as designed per the push rule in
this file's "Hard rules / invariants"; no code change. Added a clarifying note to
that rule since it can look like a bug from the UI alone.

## Post-v1 — team flags on `/matches` (2026-06-13)
Added small flag images next to team names on `/matches`, sourced from the
[flag-icons](https://flagicons.lipis.dev/) npm package (MIT-licensed SVGs):

- `src/lib/flags.ts` — `TEAM_FLAG_CODES`, a hand-built map from each of the 48 real
  WC2026 country names (confirmed by fetching openfootball's `worldcup.json` and
  diffing all distinct `team1`/`team2` values against the 64 unresolved bracket
  placeholders like `"1A"`/`"W74"`) to flag-icons' lowercase ISO codes (England/
  Scotland use `gb-eng`/`gb-sct`, which flag-icons provides alongside the standard
  ISO set).
- `scripts/copy-flags.mjs` — copies the 48 needed SVGs from
  `node_modules/flag-icons/flags/4x3/` into `public/flags/` (checked into the repo
  as static assets, so the app doesn't depend on `node_modules` at runtime). Re-run
  this and add the new code to both `TEAM_FLAG_CODES` and `FLAG_CODES` in the script
  if a knockout placeholder later resolves to a country not already covered.
- `src/components/flag.tsx` — `Flag` component, looks up the code and renders an
  `<Image unoptimized>` (Next's image optimizer rejects SVGs by default; these are
  static/trusted so `unoptimized` is the right opt-out, not a workaround). Renders
  nothing for unmapped team names (the placeholders).
- Wired into `src/app/matches/page.tsx` next to each team name.

Verified: `npm run build` passes, dev server renders all 48 flags with
`200 image/svg+xml`, placeholders render no broken image. Not yet pushed —
owner wants to push by hand after reviewing.

## Post-v1 — daily login bonus with streak multiplier (2026-06-13)
New v2-style feature (not in the original `docs/PLAN.md`): reward users for
visiting on consecutive days. First page load of a UTC calendar day awards a
bonus that scales with the login streak (100 / 150 / 200 / ... / 400 at day 7,
then flat 400/day; a missed day resets the streak to 1).

Design discussion before building, settled on:
- **No cron involvement.** Considered using the existing `/api/sync` job (with
  a shorter cron-job.org interval) to grant bonuses based on
  `auth.users.last_sign_in_at`, but rejected — it would add latency (up to the
  sync interval) before a bonus appears, and `last_sign_in_at` doesn't update
  on session-token refreshes, only fresh sign-ins. Instead, a single
  **idempotent RPC** (`claim_daily_bonus()`) does the whole check-and-award in
  one atomic statement, safe to call on every app load.
- **Server Action + client `useEffect`, not a direct RPC call from the root
  layout.** A Server-Component write was considered (simpler, no extra
  round-trip) but the owner preferred matching the existing "writes go through
  Server Actions" convention used by `placeBet`/`signOut`/`signInWithMagicLink`.

Implementation:
- `supabase/migrations/20260613000000_daily_bonus.sql` — adds
  `profiles.last_bonus_date` (date, null = never claimed) and
  `profiles.streak_count` (int, default 0), plus `claim_daily_bonus()`
  (`SECURITY DEFINER`, `SET search_path = public`, same pattern as
  `deduct_stake_on_bet`/`settle_match`). Concurrency-safe: a single
  `UPDATE ... WHERE (last_bonus_date IS NULL OR last_bonus_date < CURRENT_DATE)
  ... RETURNING streak_count` — two racing calls (e.g. two tabs) can't both
  award a bonus, since only the first matches the WHERE guard.
- `src/app/actions.ts` (new) — `claimDailyBonus()` server action: returns 0 if
  logged out, otherwise calls the RPC and returns the bonus awarded (0 if
  already claimed today).
- `src/components/daily-bonus-toast.tsx` (new) — `"use client"` component,
  calls `claimDailyBonus()` once on mount via `useEffect`; if the result is
  > 0, shows a self-dismissing "🔥 Day N streak — +N points!" banner (6s
  auto-hide, manual dismiss button). At the 400-point cap, day 7 and day 8+
  are indistinguishable from the bonus amount alone, so it falls back to a
  generic "Streak bonus — +400 points!" label.
- `src/app/layout.tsx` — renders `<DailyBonusToast />` in `<body>`, so it
  mounts once per full page load across the whole app (including `/login`,
  where it's a no-op since the user is logged out).
- `src/app/page.tsx` — home page now also selects `streak_count` and shows
  "· 🔥 N-day streak" next to the points balance when streak > 0. No collision
  with the leaderboard's existing "Streak" column, which tracks a different
  thing (consecutive correct *predictions*, from the `accuracy` view).

Verified: `npm run lint` and `npm run build` pass. Migration applied live via
`supabase db push`. Owner confirmed end-to-end on the live site — first load
showed the day-1 toast and updated balance/streak, a reload showed no toast
(idempotent no-op), "everything working perfectly."

## Removed: stray `AGENTS.md`
An `AGENTS.md` previously existed at the repo root with instructions like
"this is NOT the Next.js you know... read node_modules/next/dist/docs before
writing any code". It was auto-generated by `create-next-app` as part of the
`next@16.2.9` scaffold (verified: its dist/docs/index.md contains similar
embedded "AI agent hint" comments, and the package integrity hash matches the
real npm registry — not a local tamper). It was removed in commit `615ad96`
because its "distrust your training data, defer to embedded docs" framing is
exactly the shape of prompt injection, regardless of intent. If a future
`npm install`/scaffold reintroduces a similar file, treat it the same way —
flag it and remove rather than follow it.

## Post-v1 — `/matches` mobile-first redesign + app-wide theme (2026-06-13)

Source: the owner generated a Claude Design handoff bundle covering both
`/matches` and `/leaderboard` redesigns. This session implemented only the
`/matches` half (`Matches.dc.html`); `Leaderboard.dc.html` (same bundle) is
the next planned UI task — not started.

The `.dc.html` file is a prototype (custom `<x-dc>`/`<sc-if>`/`<sc-for>` tags,
`{{ }}` bindings, a `Component extends DCLogic` class with `state`/
`renderVals()`), not something to copy structurally — it was reverse-engineered
into idiomatic Next.js/Tailwind.

Two decisions were confirmed with the owner via `AskUserQuestion` before
writing code:
- **Theme toggle is site-wide**, not scoped to `/matches` only (owner picked
  the recommended option) — see below.
- **The mockup's "Edit bet" control on confirmed bets was deliberately NOT
  implemented at all**, per explicit owner instruction ("Dont implement this
  at all"). Placed bets remain read-only — no edit UI, no backend/DB changes
  for bet editing. If this comes up again, treat it as a closed question
  unless the owner reopens it.

### What changed

**Theme system** (app-wide, affects `dark:` styling on every page):
- `src/app/globals.css` — rewritten with OKLCH color tokens (`--background`,
  `--foreground`, `--surface`, `--surface-2`, `--line`, `--muted`,
  `--green*`, `--gold`, `--red`) in `:root` (light) and `.dark` (dark), plus
  `@custom-variant dark (&:where(.dark, .dark *));` so `dark:` utilities
  follow a `.dark` class instead of `prefers-color-scheme`. Also switched the
  site font to `next/font/google`'s Space Grotesk (`--font-space-grotesk`),
  replacing the default Geist fonts.
- `src/components/theme-provider.tsx` (new) — `ThemeProvider`/`useTheme`,
  using `useSyncExternalStore` to read `document.documentElement.classList`
  and write `localStorage['fb-dark']` (default dark). Also exports
  `themeScript`, an inline-script string.
- `src/components/theme-toggle.tsx` (new) — ☀/🌙 `ThemeToggle` button,
  currently rendered only in `/matches`' header.
- `src/app/layout.tsx` — rewritten to inject `themeScript` into `<head>`
  (applies `.dark` before hydration, avoiding a flash of the wrong theme),
  wrap the app in `ThemeProvider`, and switch to Space Grotesk.

**`/matches` redesign**:
- `src/components/bottom-nav.tsx` (new) — fixed bottom Matches/Leaderboard
  tab bar, shared by both pages (only wired into `/matches` so far).
- `src/app/matches/intro-card.tsx` (new) — dismissible "How to play" card,
  dismissal persisted via `localStorage['fb-intro-dismissed']`
  (`useSyncExternalStore`).
- `src/app/matches/place-bet-button.tsx` (new, replaces deleted
  `bet-button.tsx`) — submit button for the new bet panel using
  `useFormStatus` (same pending-state pattern as before).
- `src/app/matches/match-card.tsx` (new, ~240 lines) — the core interactive
  per-match client component: tap a team to select it, a bet panel slides
  open with 50/100/200/500pt quick-pick stake chips (disabled above current
  balance) and a live potential-win estimate from the pool multiplier,
  "Place bet →" / "Cancel" buttons, a read-only "Bet placed — N pts on Team"
  row once a bet exists, and a result row (won/lost/refunded with payout)
  once `settle_match` has run. No edit affordance, per the decision above.
- `src/components/flag.tsx` — added optional `width`/`className` props so
  `match-card.tsx` can render larger (28px) flags.
- `src/app/matches/page.tsx` — rewritten (~270 lines) as the new shell:
  sticky header (logo, balance pill, `ThemeToggle`), `IntroCard`, and the
  match list rendered via `MatchCard` per fixture, grouped by date as before;
  all existing data-fetching, pool/multiplier math (`computePool`,
  `formatMultiplier`), and date/stage formatting were preserved. The old
  inline select+input bet form and standalone `BetSection`/`PoolInfo`
  components were removed (logic now lives in `match-card.tsx`).
- `src/app/matches/bet-button.tsx` — deleted (replaced by
  `place-bet-button.tsx`).

### Bugs found and fixed during this session
- **ESLint `react-hooks/set-state-in-effect`** in `intro-card.tsx` and
  `theme-provider.tsx`: both originally called `setState` inside a
  `useEffect` to read `localStorage`/DOM after mount. Fixed by switching both
  to `useSyncExternalStore` with a module-level listener set — the
  React-recommended pattern for syncing with external state without
  triggering this lint rule, and hydration-safe by construction.
- **Hydration mismatch on `<html>`**: `themeScript` adds `.dark` to
  `document.documentElement` before React hydrates, but the SSR-rendered
  `<html>` doesn't have it, so React logged a hydration error (diff showed
  `+ class="... dark"` vs `- class="..."`). Fixed by adding
  `suppressHydrationWarning` to `<html>` in `src/app/layout.tsx` — the
  standard next-themes-style fix for elements mutated by a pre-hydration
  script (see CLAUDE.md Gotchas).

### Verification
`npm run lint` and `npm run build` both pass. Verified visually via headless
Playwright screenshots (no local Playwright/`chromium-cli` was installed, so
a temporary copy was used from `/tmp/pwcheck`): logged-out `/matches` at a
mobile viewport (390x844) in both dark and light mode, and at a desktop width
(1024px), with `console errors: []` after the `suppressHydrationWarning` fix.
**The logged-in bet-placement flow (tap team → bet panel → place bet →
confirmed/result rows) was not exercised against a real Supabase session in
this session** — worth a manual check next time someone is logged in.

### Deploy
All changes were auto-committed to branch `V2-design` as `02cd971 "Full site
redesign"`. Per the owner's request ("merge this to main so it gets depod"),
this was fast-forward-merged into `main` and pushed to `origin/main`,
triggering Vercel's auto-deploy.

### Next up (superseded — see below)
Implement `Leaderboard.dc.html` (same design bundle, `open_file=Leaderboard.dc.html`)
for `/leaderboard` — not started.

## Post-v1 — `/leaderboard` redesign (2026-06-14)

Source: same Claude Design bundle as the `/matches` redesign above
(`Leaderboard.dc.html`). The original handoff link had gone stale (10h+ since
last load); the owner re-sent a fresh "send to Claude" link from the same
project, which worked after the usual binary-save + `tar -xzf` extraction
(see "Gotchas" — WebFetch returns the handoff bundle as a gzip tarball, not
parsed HTML).

Implemented in `src/app/leaderboard/page.tsx` (rewritten, ~280 lines),
following `Leaderboard.dc.html`'s layout and the existing `/matches`
conventions (sticky header, `max-w-[600px]` container, `BottomNav`,
CSS-variable theming):

- Same sticky header as `/matches` (⚽ Friendly Bets + `ThemeToggle`), but
  **no balance pill** — not part of this design.
- "Leaderboard" title + "World Cup 2026 · N players" subtitle.
- **Podium** (only rendered if there are ≥3 players, to avoid a broken
  3-column layout): top 3 by `points_balance`, rendered 2nd-1st-3rd
  left-to-right via `PodiumColumn` + `PODIUM_CONFIG` (per-place sizes/colors
  for circle avatar, name, points, and medal-colored base). `initials()`
  derives a 2-letter avatar label from `display_name`; `shortName()`
  truncates long names so they don't overflow the narrow columns.
- **Ranked list** for everyone ranked 4th or lower, in a rounded card.
- **Accuracy table** (existing `accuracy` view): header row (Player/W-L/Win%/
  Streak) plus one row per player, with win % colored green/red/muted by
  W-L record and streak shown as `🔥 N` or `—`.
- New CSS tokens added to `globals.css` (`:root` and `.dark`): `--gold-bg`,
  `--gold-text`, `--gold-base-bg`, `--silver-bg`, `--silver-text`,
  `--silver-border`, `--bronze-bg`, `--bronze-text`, `--bronze-border` — exact
  oklch values taken from `Leaderboard.dc.html`'s `renderVals()`. The existing
  `--gold` token is reused as the gold podium border (same value in both
  modes, matching the design).

Verified: `npm run lint` and `npx tsc --noEmit` both pass. Visually checked
via headless Playwright screenshots against the live dev server (real
Supabase data, not mocked) — light mode, dark mode, full-page dark, and a
375px mobile viewport — confirming correct podium colors/sizes per place,
correct initials/truncation, correct ranked-list and accuracy-table
rendering, and `console errors: []`. Temporary screenshots and the local-only
`playwright` install were cleaned up; `git status` showed only
`src/app/globals.css` and `src/app/leaderboard/page.tsx` modified. Owner
committed this as `4ad4e9a "leaderboards page redesign"`.

## Post-v1 — `/login` redesign (2026-06-14)

Source: same Claude Design project, fresh handoff link for `Login.dc.html`
(same bundle also contains `Matches.dc.html`/`Leaderboard.dc.html`, unchanged).
Same binary-save + `tar -xzf` extraction as above.

`Login.dc.html` is a simple, self-contained centered page (no header, no
bottom nav — appropriate, since the user isn't signed in yet). Implemented:

- `src/app/login/page.tsx` (rewritten): centered ⚽ emoji / "Friendly Bets" /
  "WORLD CUP 2026" logo block, then a card containing:
  - "Sign in" heading + description.
  - The existing `signInWithMagicLink` form (`src/app/login/actions.ts`,
    unchanged) with an email input restyled per the design
    (`var(--input-bg)`, `var(--line)` border, rounded-xl).
  - `SubmitButton` (`src/app/login/submit-button.tsx`) restyled as a
    full-width green pill, "Send magic link →" / "Sending..." — same
    `useFormStatus` pending-state pattern as before, just new styling.
  - The existing `?message=`/`?error=` feedback, now colored with
    `var(--green-text)` / `var(--red)`.
  - The spam/timing/double-submit reminders, restyled as a "HEADS UP" card
    (📩 check spam/junk, ⏱ 1-minute expiry, ☝️ press once) using new
    `--warn-bg`/`--warn-border` tokens.
- `src/app/login/theme-toggle-pill.tsx` (new) — `ThemeTogglePill`, a labeled
  dark/light toggle ("☀ Light mode" / "🌙 Dark mode") below the card. Uses the
  same `useTheme`/`fb-dark` mechanism as `ThemeToggle`, just styled as a
  pill with a text label per the design (`/login` has no header to put the
  icon-only `ThemeToggle` in).
- New CSS tokens added to `globals.css` (`:root` and `.dark`): `--input-bg`,
  `--warn-bg`, `--warn-border` — oklch values from `Login.dc.html`'s
  `renderVals()`. `--green`, `--gold`, and `--line`/`--foreground`/`--muted`
  were already defined and matched the design's values exactly, so no other
  new tokens were needed.

Verified: `npm run lint` and `npx tsc --noEmit` both pass. Visually checked
via headless Playwright screenshots — dark mode, light mode, and a 375px
mobile viewport, all at the login route — confirming the layout, colors, and
copy match `Login.dc.html`, with `console errors: []`. Temporary screenshots
and script were cleaned up. Owner committed this as `117e670 "Login page
redesign"`.

### Next up
All three pages from the Claude Design bundle (`Matches.dc.html`,
`Leaderboard.dc.html`, `Login.dc.html`) are implemented. No further UI
redesign work is planned — anything else is a v2 idea (see `docs/PLAN.md`
"v2 ideas").

## Post-v1 — `/matches`: Finnish kickoff times + Upcoming/Live/Past tabs (2026-06-14)

Two follow-up requests on `/matches` in the same session, both small and
both done:

### Kickoff times shown in Finnish time, not UTC
`kickoff_at` is still stored in UTC — only the display changed. In
`src/app/matches/page.tsx`, `DATE_FORMAT`/`TIME_FORMAT` now use
`timeZone: "Europe/Helsinki"` instead of `"UTC"`, and `formatTime` suffixes
"Finnish time" instead of "UTC". `Europe/Helsinki` is a fixed IANA zone that
handles the EET/EEST (UTC+2/+3) daylight-saving switch automatically, so no
manual offset math is needed — and because it's still a *fixed* zone (not
the visitor's local one), the server-rendered HTML stays identical for every
visitor, preserving the original no-hydration-mismatch reasoning.

### Upcoming / Live / Past tabs with date grouping
`/matches` previously showed every match in one long list grouped by kickoff
date. It's now split into three tabs (default: **Upcoming**), each showing a
match count and its own date-grouped list under sticky headers:

- **Upcoming** — not yet settled, kickoff still in the future (these are the
  bettable ones). Ascending, soonest first.
- **Live** — not yet settled, kickoff already passed (sync hasn't recorded a
  result yet — status still `scheduled`/`closed`). Ascending, soonest-started
  first.
- **Past** — settled. Descending, most recent result first.

Implementation (`src/app/matches/page.tsx` + new
`src/app/matches/matches-tabs.tsx`):
- `groupByDay()` (new helper) groups a match array by `formatDate()`,
  preserving input order — so it produces chronological groups for an
  ascending input and reverse-chronological groups for a descending input.
  Past's matches are `.reverse()`d (the base query is ascending) before being
  passed in.
- `renderMatchCard()` and `renderDayGroups()` (new local functions) factor
  out the per-match `MatchCard` rendering and per-tab date-grouped rendering
  that used to be one inline loop, so all three tabs share the same code.
- `MatchesTabs` (new `"use client"` component) renders the Upcoming/Live/Past
  tab bar with counts and switches which pre-rendered tab content is visible
  via `useState`. All three tabs' JSX is computed server-side and sent in one
  RSC payload, so switching tabs is instant — no extra fetch.
- Sticky stacking: the existing page header (`h-14`/56px, `top-0`) and the
  new tab bar (`h-12`/48px, `top-14`) are both sticky; each date header sticks
  at `top-[104px]` (56+48) to clear both.
- Each tab shows a short empty-state message ("No upcoming matches", "No
  live matches right now", "No past matches yet") when it has zero matches.

Verified: `npx tsc --noEmit` and `npx eslint src/app/matches` both pass with
no errors. Checked against the live dev server via `curl` (layout/data logic,
not new visuals, so Playwright screenshots weren't needed): the three tab
counts summed to the total match count (Upcoming 98 / Live 1 / Past 7 on
2026-06-14), Upcoming's date headers ran ascending starting from the current
day, and temporarily defaulting to the Past tab showed its date headers
descending (14 -> 13 -> 12 -> 11 Jun) before the default was reverted back to
Upcoming.

Owner committed the Finnish-time change as part of `d92506a "docs: all pages
redesigned"` and the tabs as `f75ddf8 "Tabs: games split into Upcoming, live,
and past."`.

### Next up
No further work planned on `/matches`. Anything else is a v2 idea (see
`docs/PLAN.md` "v2 ideas").

## Post-v1 — `/leaderboard`: podium + one sortable all-players table (2026-06-14)

Replaced the fixed "ranked list (4th+) + accuracy table" layout from the
earlier `/leaderboard` redesign (commit `4ad4e9a`) with a single sortable
table covering every player, per owner request.

### Layout
- The points podium (top 3 by points balance, gold/silver/bronze
  avatars/bases) is unchanged — it stays a permanent, points-only showcase
  and is not affected by sorting.
- Below it, everything else (ranked list for 4th+, and the separate accuracy
  table) was removed and replaced by one table: rank, player, points, bets
  placed, correct, wrong, win rate %, streak.

### Data
`src/app/leaderboard/page.tsx` now joins two existing queries server-side
into one row per player — no schema or `accuracy` view changes:
- `pointsRows` from `profiles` (id, display_name, points_balance), still used
  for the podium.
- `accuracyRows` from the `accuracy` view, narrowed to
  `user_id, bets_placed, correct, wrong, win_rate_pct, streak` with no
  `.order()` (sorting moved entirely client-side).
- `accuracyByUserId` is a `Map` from `accuracyRows`; each `pointsRows` entry
  is merged with its accuracy row (defaulting bets/correct/wrong/win
  rate/streak to 0 for players with no settled bets, since `accuracy` is an
  inner join and excludes them) into a `LeaderboardRow[]` passed to the new
  table component as plain data.

### `LeaderboardTable` (new `src/components/leaderboard-table.tsx`)
A `"use client"` component that owns sort state (`sortKey`, `sortDirection`,
`useState`) and derives `sortedRows` via `useMemo` — no refetch, sorting is
instant. Clicking a column header sorts by that column (default descending);
clicking the active column again toggles asc/desc. The active column shows a
▲/▼ arrow. The rank (`#`) column is the row's position in `sortedRows`, so it
recomputes with every sort. Default sort on load is points descending.

Initial spec made only points/correct/win-rate/streak sortable. The owner
pointed out that leaving "Bets" and "Wrong" unsortable was inconsistent with
no real justification ("seems like bad UI... is there something that makes it
difficult in code/SQL?") — there wasn't, so all six numeric columns
(`points_balance`, `bets_placed`, `correct`, `wrong`, `win_rate_pct`,
`streak`) were made sortable.

### `react-hooks/static-components` fix
The column header was first written as a `SortableHeader` function defined
*inside* `LeaderboardTable`'s render body, closing over `sortKey`/
`sortDirection`/`handleSort`. ESLint's `react-hooks/static-components` rule
flagged this ("Cannot create components during render... Declare components
outside of render") because a new component identity is created on every
render. Fixed by moving `SortableHeader` to module scope and passing
`sortKeyName`, `activeKey`, `direction`, and `onSort` as explicit props at
each of the 6 call sites.

Verified: `npx eslint` and `npx tsc --noEmit` both pass with no errors/
warnings. Checked via headless Playwright at `/leaderboard`: the table renders
all players with points descending by default (▼ on "Points"), clicking each
of the 6 headers re-sorts instantly with the arrow flipping direction on a
second click, and the `#` column updates to match. Owner committed this as
`7407268 "Added sorting to leaderboards"`.

### Next up
No further leaderboard work planned. Anything else is a v2 idea (see
`docs/PLAN.md` "v2 ideas").

## Post-v1 — `src/middleware.ts` → `src/proxy.ts` rename (2026-06-14)

`npm run dev` started warning: `The "middleware" file convention is
deprecated. Please use "proxy" instead.` Next.js 16 renamed this file
convention; the only changes needed are the file name and the exported
function name — `config.matcher` is unchanged.

Renamed `src/middleware.ts` → `src/proxy.ts` and its exported `middleware()`
function → `proxy()` (same body: creates a Supabase server client, calls
`supabase.auth.getUser()` to transparently refresh an expired session token,
and writes the refreshed cookies onto the response). Updated two comments
that referenced `middleware.ts` by name:
- `src/lib/supabase/server.ts` — "`proxy.ts` is responsible for refreshing
  the session cookie..."
- `src/lib/supabase/client.ts` — "(set by the server client / proxy)"

Verified: deleted the old `src/middleware.ts`, restarted `npm run dev` (after
killing a stale dev server still running the old file, which was holding port
3000), and confirmed `npm run dev` starts with no deprecation warning and
`proxy.ts` appears in the per-request timing breakdown. `/matches` and
`/login` both still return 200 (session-refresh behavior unchanged). Owner
committed this as `4cb951a "changed depracted naming to proxy"`.

## Post-v1 — `/api/sync` cron interval reduced to 5 minutes (2026-06-14)

External config change only, no code. The owner asked whether the
`/api/sync` cron-job.org schedule (every 2-3h) could be reduced to ~5
minutes. Since `/api/sync` is a normal protected API route with no caching
(`force-dynamic`) and `settle_match` is idempotent, there's no code-side
reason it can't run more often — cron-job.org's free tier supports down to
1-minute intervals.

Caveat discussed: openfootball's `worldcup.json` (the data source in
`src/lib/openfootball.ts`) is a periodically-updated static file, not a live
feed, so a 5-minute sync doesn't produce "live" scores — its main benefit is
that `settle_match` now fires within ~5 minutes of a match crossing the
3h-post-kickoff threshold, instead of up to ~3h late under the old schedule.

The owner changed the cron-job.org schedule directly (no app changes
required). All "every 2-3h" references across `CLAUDE.md`, `README.md`,
`docs/PLAN.md`, `docs/SCHEMA.md`, and `docs/PROJECT_CONTEXT.md` were updated
to "every 5 minutes" to match.

## Post-v1 — model change: parimutuel pool → fixed-points scoring (2026-06-16)

The biggest design change since v1 launched. The owner decided to drop the
parimutuel staking model entirely (no more stakes, pools, pool-splitting,
seed-to-300, or push/refund) and replace it with a pure prediction/accuracy
points model, *and* to promote "draw" from a deferred v2 idea to a real,
first-class pickable outcome in the same change.

New scoring rules:
- A bet just picks one of three outcomes — `team1` (home win) / `draw` /
  `team2` (away win). No stake, nothing deducted on placement.
- Correct pick: +10. Underdog bonus: +5 if the picked outcome got fewer than
  33% of all bets on that match (correct underdog = 15 total). Wrong pick: −5.
- Balances start at 0 and may go negative (intended).
- Draw is a real outcome: it can be picked, it can win, and it counts toward
  the bet-distribution math for the underdog bonus. All push/refund-on-draw
  logic was removed.

Naming decision: the codebase already stored result/pick as `team1`/`team2`
(matching the `matches.team1`/`team2` columns and the openfootball parser).
Rather than rename everything to literal `home`/`away`, we kept
`team1`/`draw`/`team2` as the DB values and label them Home/Draw/Away in the
UI — lowest-risk, internally consistent. (Asked the owner; they chose "keep
team1/draw/team2".)

DB changes — new migration
`supabase/migrations/20260616000000_accuracy_points_model.sql` (no old
migrations edited):
- `profiles.points_balance` default 1000 → 0; all existing rows reset to 0;
  `handle_new_user` updated to seed 0.
- `bets`: `stake` made nullable + its `> 0` check dropped (kept as an unused
  legacy column); added `points_awarded int NOT NULL DEFAULT 0`; `pick` CHECK
  widened from `('team1','team2')` to `('team1','draw','team2')`.
- Dropped the `deduct_stake` trigger + `deduct_stake_on_bet()` function (so
  migration `20260611000000_*` and the old stake check are now dead history).
  Kept `enforce_bet_window` — a bet can still only be placed while scheduled
  and before kickoff.
- Rewrote `settle_match`: counts bets per outcome, flags the result outcome as
  an underdog if it drew `< 33%` of all bets, writes each bet's
  `points_awarded` (+10 / +15 / −5) and `outcome` (won/lost), then adds
  `points_awarded` to `points_balance`. Still SECURITY DEFINER, idempotent,
  `FOR UPDATE`-locked. Seed/pot/push branches all gone.
- `accuracy` view left unchanged — it never referenced stake/pool, and
  "correct" (`outcome='won'`) now naturally includes correctly-picked draws.

App changes:
- `src/app/matches/actions.ts` — `placeBet` drops stake, validates
  `team1`/`draw`/`team2`, inserts the pick only.
- `src/app/matches/match-card.tsx` — three-way Home/Draw/Away buttons (🤝 for
  draw), no stake chips / multipliers; confirm panel shows the +10/+15/−5
  scoring; result rows use `points_awarded`; shows the crowd split %.
- `src/app/matches/page.tsx` — replaced the pool/multiplier math with
  per-outcome pick counts (`Distribution`); passes `drawIsWinner`; fetches
  `points_awarded` instead of stake/payout.
- `src/app/matches/intro-card.tsx` — "How to play" copy rewritten for the
  points model.

Docs swept to the new model: `CLAUDE.md`, `docs/SCHEMA.md`, `docs/PLAN.md`,
`docs/PROJECT_CONTEXT.md`, and `README.md` (parimutuel/pool/seed/stake/push
removed; three-way points model documented; "draw as a third pick" promoted
out of v2; all "starts at 1000" → "starts at 0, may go negative").

Verified locally with `npx tsc --noEmit` and `eslint` (both clean). Manual
step for the owner: apply the new migration (`supabase db push` or paste into
the SQL editor) — it resets all balances to 0. Known cosmetic note: matches
already settled under the old model stay `settled`, so the idempotent guard
won't re-score them — their bets keep `points_awarded = 0` and render as
"+0 pts"; clearing old `bets` before relaunch avoids that if desired.

## Post-v1 — daily login bonus disabled (2026-06-16)

Right after the fixed-points model change (above), the owner decided the daily
login bonus no longer fits: it added 100-400 points to `points_balance` on
each day's first load, which now directly inflates the prediction score (the
whole point of the new model is that points reflect prediction skill only).
With no alternative use for it, it was disabled completely.

Removed (app wiring):
- `<DailyBonusToast />` mount in `src/app/layout.tsx`.
- `src/components/daily-bonus-toast.tsx` (deleted).
- `src/app/actions.ts` (deleted — it only held `claimDailyBonus()`).
- The home page (`src/app/page.tsx`) streak display + `streak_count` from its
  `profiles` select.

Left dormant (DB, never called): the `claim_daily_bonus()` RPC and the
`profiles.last_bonus_date` / `streak_count` columns from
`20260613000000_daily_bonus.sql`. No migration was written to drop them — this
keeps the change reversible (restore the toast + action to re-enable) and
avoids a destructive schema change. Verified clean with `tsc --noEmit` +
`eslint`. Docs updated across `CLAUDE.md`, `README.md`, `docs/SCHEMA.md`,
`docs/PLAN.md`, `docs/PROJECT_CONTEXT.md`.

## Post-v1 — Google OAuth sign-in (2026-06-16, `version2.0` branch)

Added "Sign in with Google" to `/login` as a second auth option alongside the
existing magic-link form. Purely additive — the magic-link flow (action, email,
`/auth/confirm` handling) was not changed.

Why it was simple: Supabase OAuth returns to the app the same way a magic link
does — a redirect back to `redirectTo` carrying `?code=...`, which the existing
`/auth/confirm` route already swaps for a session via `exchangeCodeForSession`.
So **no new callback route was needed**; the OAuth return reuses the magic-link
route as-is.

Code:
- `src/app/login/google-button.tsx` (new, `"use client"`) — a `GoogleButton`
  that calls `supabase.auth.signInWithOAuth({ provider: 'google', options: {
  redirectTo: \`${window.location.origin}/auth/confirm\` } })` from the browser.
  OAuth must start client-side (it's a full-page redirect to Google), so unlike
  the magic-link server action this uses the browser Supabase client. Building
  `redirectTo` from `window.location.origin` makes it env-aware automatically
  (localhost in dev, Vercel URL in prod) with no hardcoding — note this is the
  *browser* origin, distinct from the server-only `NEXT_PUBLIC_SITE_URL` the
  magic-link action uses. Follows the app convention of disabling + relabelling
  ("Redirecting...") while the round-trip is in flight. Includes an inline
  Google "G" SVG so no extra asset is fetched.
- `src/app/login/page.tsx` — added an "or" divider and rendered `<GoogleButton />`
  below the magic-link form, styled with the existing design tokens.
- Hover/active polish: gave both `GoogleButton` and the magic-link
  `SubmitButton` (`src/app/login/submit-button.tsx`) the same lift + shadow on
  hover and settle-on-press as the match cards (`hover:-translate-y-0.5
  hover:shadow-md`, `active:translate-y-0`), since they previously had no hover
  feedback. Hover effects are explicitly neutralized in the disabled/pending
  state.

Verified the new-user `profiles` trigger covers Google signups: it's
`on_auth_user_created`, `AFTER INSERT ON auth.users`
(`20260609000000_initial_schema.sql`), so it fires for any new user regardless
of sign-in method. Google doesn't populate `raw_user_meta_data->>'display_name'`,
so the display name falls back to the email local-part (`split_part(NEW.email,
'@', 1)`) — Google always returns a verified email, so that's safe. Confirmed
`npx tsc --noEmit` clean. Nothing in the magic-link flow changed.

Dashboard setup the owner did (one-time, not in code; full steps in `CLAUDE.md`
"Google OAuth"): Google Cloud OAuth client (Web application) with Supabase's
callback URL (`https://tutpgfsmrfpetctkdyta.supabase.co/auth/v1/callback`) as
the authorized redirect URI; OAuth consent screen branded "Friendly Bets" and
left in Testing mode (testers added as test users); Google provider enabled in
Supabase with the Client ID/Secret; redirect URLs already covered
`/auth/confirm`; account linking enabled so a magic-link user and a Google user
with the same verified email become one account.

Hiccups hit along the way (all expected, documented in `CLAUDE.md`):
- First button press returned `validation_failed / provider is not enabled` —
  not a localhost issue; just meant the Google provider hadn't been enabled in
  the Supabase dashboard yet (the OAuth call hits the hosted project regardless
  of environment).
- The Supabase Providers page was hard to find in the current dashboard — it's
  under Authentication, slug `/auth/providers`, labelled "Sign In / Providers".
- Google Cloud "Authorized domains" rejects a scheme (`https://`) and may reject
  `vercel.app` (a public-suffix domain Vercel owns) — those optional fields can
  be left blank in Testing mode.
- The consent screen shows the raw `…supabase.co` domain + "name + email"
  access. Expected for any Supabase-hosted OAuth (Google sees Supabase as the
  requesting party) and minimal scope; branding softens it, a custom domain
  (paid) would replace it — not worth it here.

Docs updated across `CLAUDE.md`, `README.md`, `docs/PLAN.md`,
`docs/PROJECT_CONTEXT.md`.

Two small follow-ups in the same session:
- **Sign-out in the redesigned headers.** The redesigned `/matches` and
  `/leaderboard` had no way to sign out (only the plain `/` home page did). Added
  a reusable `src/components/sign-out-button.tsx` — a Server Component wrapping
  `<form action={signOut}>` (the existing `auth/actions.ts` action) — rendered in
  both sticky headers, only when a user is logged in. `/leaderboard` didn't fetch
  the user before, so a `supabase.auth.getUser()` was added to its `Promise.all`
  purely to decide whether to show the button.
- **"View matches as guest" link on `/login`.** A subtle link under the sign-in
  card pointing at `/matches`, so a first-time visitor can browse without an
  account (both `/matches` and `/leaderboard` are already public/read-only via
  RLS — they just can't place predictions until signed in).
## Post-v1 — `/matches`: "washi tape" match-day date headers (2026-06-14)

Small visual tweak, owner request: make the sticky date headers on `/matches`
"pop" more — "maybe even a 'sticker' type thing".

Presented three preview options (tilted date sticker, washi-tape banner, stamp
badge); owner picked **washi-tape banner**. In
`src/app/matches/page.tsx`'s `renderDayGroups()`, each day's plain
muted-text sticky header was replaced with a full-width green banner: bold
uppercase date + match count, `clipPath: polygon(8px 0, 100% 0, calc(100% -
8px) 100%, 0 100%)` for the angled "torn tape" edges, sitting inside a sticky
wrapper (`top-[104px]`, same offset as before, clearing the page header +
tab bar) so it still covers cards scrolling underneath.

Verified via headless Playwright screenshots of `/matches` in both dark and
light mode, and during sticky scroll (header stays pinned, torn edges don't
show gaps). Owner committed this as `9d9b4bd "Imroved match day banners."`.

### Next up
No further `/matches` redesign work planned — anything else is a v2 idea (see
`docs/PLAN.md` "v2 ideas").

## Post-v1 — match cards: "Bets open" bar, hover effects, nudge animation (2026-06-14)

Three related polish requests on `/matches` match cards, all in
`src/app/matches/match-card.tsx` (plus one new `@keyframes` in
`src/app/globals.css`):

1. **"Bets open" bar** — previously, the only hint that a match was open for
   betting was a "Log in to bet" link shown to logged-out users only.
   Logged-in users got no hint at all until they tapped a team. Now, any
   bettable match with no existing bet and no team picked yet shows a green-
   dot "Bets open" bar above the card's bottom edge — "Bets open — tap a team
   to pick your winner" when logged in, or "Bets open" + a "Log in to bet"
   link when logged out. It disappears once a team is picked (the bet panel
   takes over) or once a bet exists (the confirmed-bet/result row takes over).

2. **Hover effects** — every card gets a subtle `shadow-md` on hover (whole
   card). When a user can actually place a bet (`canPick`), the two team
   buttons additionally lift 2px and gain their own shadow on hover, to mark
   them as the clickable elements.

3. **Nudge animation** — before a team is picked, tapping anywhere on a
   bettable card *except* the team buttons (pool info, empty space, etc.)
   triggers a 450ms bounce (`@keyframes nudge` in `globals.css`) plus a green
   ring (`ring-2 ring-[var(--green)] ring-offset-2`) on both team buttons, to
   draw the eye to where betting actually starts. `handleCardClick` ignores
   clicks inside the team buttons themselves (via `homeRef`/`awayRef`) and
   stops applying once `selected !== null` (bet panel open).

### CSS specificity gotcha resolved
The team buttons' colors are set via inline `style={teamStyle(...)}`
(`background`/`borderColor`/`color`, computed per-render for
selected/winner/flagged states). Inline styles win over Tailwind `:hover`/
animation classes for the *same* CSS properties, so the new hover/nudge
effects deliberately use properties `teamStyle()` never sets —
`transform`/`translate` (lift) and `box-shadow`/`ring` (shadow + outline) —
so they layer on top without being overridden. Also note: Tailwind v4's
`-translate-y-*` utilities set a separate `translate` CSS property, not
`transform` — `getComputedStyle(el).transform` stays `'none'` even when the
utility is active; check `.translate` instead.

Verified: `npx tsc --noEmit` clean. Visually checked via a temporary
`/dev-preview` route rendering `<MatchCard>` with `loggedIn`/`bettable` props
set directly (no real auth needed) — confirmed the nudge ring/bounce render
correctly and `getComputedStyle` shows `boxShadow`/`translate` changing on
hover. Temporary route and scripts removed after verification. Owner
committed this as `290bcc0 "Match cards improvements: Bets open bar for all
matches, hover effect on teams, nudge to highlight click teams"`.

### Next up
No further `/matches` redesign work planned — anything else is a v2 idea (see
`docs/PLAN.md` "v2 ideas").

## Post-v1 — bet placement: toast + no scroll-jump (2026-06-14)

Owner feedback: placing a bet caused the page to refresh/scroll back to top,
which "feels unintentional" and forced a self-check that the bet went
through. Wanted a confirmation toast and to stay anchored at the match card
instead of jumping to the top.

### Root cause
`placeBet` (`src/app/matches/actions.ts`) was a `<form action={placeBet}>`
server action that always ended with `redirect("/matches?message=...")` or
`redirect("/matches?error=...")`. Even though the destination is the same
page, a server-action `redirect()` is a full navigation — the page
re-renders from scratch and the browser scrolls to top, and the `?message=`/
`?error=` banner at the top of `page.tsx` was easy to miss while scrolled
down.

### Fix
- `placeBet` no longer redirects on success/error — it now returns
  `PlaceBetResult` (`{ status: "success" | "error", message: string }`). The
  `!user` (expired-session) edge case still `redirect("/login")`, since the
  UI already gates the bet panel on `loggedIn`.
- `match-card.tsx` no longer wraps the submit in a `<form>`. "Place bet →" is
  a plain button with an `onClick={handlePlaceBet}` async handler that builds
  a `FormData`, calls `placeBet(formData)` directly (still a valid way to
  invoke a `"use server"` function from a Client Component), and tracks its
  own `pending` state (replacing the `useFormStatus`-based
  `PlaceBetButton`, which is now deleted).
- On completion, the result renders as a small self-dismissing toast (green
  for success, red for error) fixed just above the bottom nav
  (`bottom-[76px]`, `pointer-events-none` so it never blocks taps), auto-
  hidden after 3 seconds via a `useEffect`/`setTimeout`.
- On success only: `setSelected(null)` collapses the bet panel and
  `router.refresh()` re-fetches the page's server data (balance, pool,
  `existingBet`) **without navigating** — so scroll position is untouched.
  Because `MatchCard` instances are keyed by `match.id`, each card's local
  state (toast, tab selection, etc.) survives the refresh.
- Removed the now-dead `?message=`/`?error=` query-param banner from
  `page.tsx` (its `searchParams` prop) and deleted
  `src/app/matches/place-bet-button.tsx`.

### `react-hooks/set-state-in-effect` detour
First attempt used `useActionState` + an effect that copied the action's
result into a `toast` state and called `router.refresh()`/`setSelected(null)`
synchronously inside the effect body. `eslint-plugin-react-hooks` v7's new
`set-state-in-effect` rule flags any synchronous `setState` call directly in
an effect body (classic "derived state" smell, even when the setState is
really "react to an action result"). Resolved by moving the whole flow into
the `onClick` handler (an event handler, where `setState` is always fine) and
dropping `useActionState` — only the toast's auto-dismiss timer remains in a
`useEffect`, and its `setState` is inside a `setTimeout` callback (nested
function), which the rule doesn't flag — same pattern as
`DailyBonusToast`.

Verified: `npx tsc --noEmit` and `npx eslint src/app/matches` both pass with
no errors. Checked via a temporary `/dev-preview` route + Playwright: opening
the bet panel renders the new "Place bet →" button correctly, and clicking it
(with no auth session in the preview) cleanly redirects to `/login` — proving
the handler runs without crashing. Temporary route and scripts removed after
verification. Owner committed this as `f731c44 "Betting UI/UX improvements:
stay at match card after betting, bet placed toaster, removed old
confirmation."`.

### Next up
No further `/matches` work planned — anything else is a v2 idea (see
`docs/PLAN.md` "v2 ideas").
