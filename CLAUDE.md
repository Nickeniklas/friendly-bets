# CLAUDE.md

Operating brief for Claude Code. Read `docs/PLAN.md` and `docs/SCHEMA.md` for full detail.
For a step-by-step account of how v1 was built (including bugs found and fixed along the
way), see `docs/HISTORY.md` — that detail has been moved out of this file to keep this
brief current and short.

## Status (as of 2026-06-13)
**v1 is complete and live** at `https://friendly-bets-rust.vercel.app`. All of
`docs/PLAN.md`'s build order (steps 1-8) is DONE:

- Supabase schema, RPC (`settle_match`), `accuracy` view, RLS, and GRANTs are applied.
- `/api/sync` is deployed, protected by `SYNC_SECRET`, and triggered every 2-3h by
  cron-job.org (syncs openfootball fixtures/results and auto-settles finished matches).
- Magic-link auth (`/login`, `/auth/confirm`, sign-out) works via custom SMTP (Brevo).
- `/matches` lists all 104 fixtures grouped by kickoff date, with a place-bet form per
  bettable match and a live pool/multiplier display per side.
- `/leaderboard` shows points balance + accuracy (W-L, win %, streak).
- Vercel Web Analytics is enabled.

Post-v1 polish:
- `/login` now shows a persistent reminder (plus a post-submit message) to check
  spam/junk for the magic-link email, since the Brevo sending address has no domain
  reputation yet (commit `a85216a`).
- `/matches` now shows a small flag next to each team name (`src/components/flag.tsx`,
  `src/lib/flags.ts`, SVGs in `public/flags/` — see README "Team flags").

No known open bugs. Anything further is a v2 idea (see `docs/PLAN.md` "v2 ideas") —
not part of the original plan, don't start on these without being asked.

## Cron setup (DONE — reference only)
1. Go to https://cron-job.org, sign up / log in.
2. Create a new cronjob:
   - URL: `https://friendly-bets-rust.vercel.app/api/sync`
   - Schedule: every 2-3 hours
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

## What we're building
A non-commercial World Cup 2026 prediction game for family & friends. No real money.
People bet points on match winners; a parimutuel pool decides payouts. Everyone starts
at 1000 points. Separate accuracy leaderboard tracks raw prediction skill.

## Stack (decided — do not re-litigate without being asked)
- Next.js on Vercel
- Supabase: Postgres + Auth (magic link) + realtime
- Match data: openfootball `worldcup.json` (free, no key), synced 1–2×/day
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
- Balances never change via direct client writes — only via bet insert + settlement RPC.
  Lock this down with RLS; settlement is a security-definer RPC.

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
  button. See `src/app/login/submit-button.tsx` and
  `src/app/matches/bet-button.tsx` for the pattern. Without this, slow
  round-trips look unresponsive and invite double-submits, which surface as
  confusing errors (stale magic-link, duplicate-bet constraint, etc.).
- Magic-link emails sent via Brevo (see "Email / SMTP" above) may land in
  spam/trash for first-time recipients, since the sending address has no
  reputation yet. `src/app/login/page.tsx` now shows a persistent reminder
  about this, and `src/app/login/actions.ts`'s post-submit success message
  repeats it — so this no longer needs to be said manually when sharing the
  link. This should improve over time as the address sends more mail.

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
