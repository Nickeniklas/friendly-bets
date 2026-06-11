# friendly-bets

A non-commercial World Cup 2026 prediction game for family & friends. See `CLAUDE.md`
and `docs/PLAN.md` / `docs/SCHEMA.md` for the full spec, build order, and current status.

## Status

- Supabase schema, RPC, view, and RLS are live (see `supabase/migrations/`).
- `/api/sync` (`src/app/api/sync/route.ts`) is deployed to Vercel and verified live at
  `https://friendly-bets-rust.vercel.app/api/sync` — pulls openfootball fixtures/results,
  upserts `matches`, and auto-settles via `settle_match`. The Vercel project is connected
  to this GitHub repo for auto-deploys on push to `main`.
- The cron-job.org schedule that triggers `/api/sync` every 2-3h is set up and
  confirmed working (200 OK). Step 2 is complete.
- Magic-link auth is built: `/login` sends a sign-in email, `/auth/confirm` completes
  it, and the home page shows the logged-in user's name + points balance with a sign-out
  button. Session cookies are kept fresh by `src/middleware.ts`. Step 3 is complete —
  see `CLAUDE.md` for what's next (step 4: match list page).

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Copy `.env.local.example` to `.env.local` and fill in your Supabase project values
(see that file for where to find each one — `.env.local` is gitignored).

The Supabase schema lives in `supabase/migrations/` — apply it with the Supabase CLI:

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

### Testing /api/sync locally

With `npm run dev` running, in another terminal:

```bash
curl http://localhost:3000/api/sync -H "Authorization: Bearer <your-SYNC_SECRET>"
```

Expect `{"synced": <count>, "settled": [...]}`. The `matches` table should populate
with World Cup 2026 fixtures.

### Auth (magic link)

One-time setup in the Supabase dashboard — Authentication -> URL Configuration:

- **Site URL**: your deployed app URL (e.g. `https://friendly-bets-rust.vercel.app`)
- **Redirect URLs**: add that same URL plus `http://localhost:3000/**`

No email template edits are needed — the default "Magic Link" email works as-is
(`/auth/confirm` handles Supabase's PKCE `?code=...` redirect). Visit `/login`,
enter an email, and click the link from the email to sign in.
