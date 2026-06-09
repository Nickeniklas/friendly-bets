# SCHEMA — data model & settlement contract

The heart of the project. Get the tables and the settlement RPC right and the rest is UI.

## Tables

### `profiles`
Extra game data per user. Supabase Auth owns `auth.users`; this hangs off it.

| column | type | notes |
|---|---|---|
| id | uuid (PK) | = auth.users.id |
| display_name | text | shown on leaderboard |
| points_balance | int | starts at 1000 |
| created_at | timestamptz | default now() |

New users get a row with `points_balance = 1000` (trigger on auth signup, or on first login).

### `matches`
One row per game, synced from openfootball.

| column | type | notes |
|---|---|---|
| id | uuid (PK) | |
| external_ref | text (unique) | stable key from openfootball to dedupe on re-sync |
| team1 | text | |
| team2 | text | |
| kickoff_at | timestamptz | betting closes at this time |
| group_label | text | e.g. "Group A" |
| stage | text | group / r32 / r16 / qf / sf / final |
| status | text | `scheduled` → `closed` → `settled` |
| result | text | `team1` / `team2` / `draw` / null until played |
| settled_at | timestamptz | null until settled |

`external_ref`: openfootball doesn't ship a clean id, so build one deterministically,
e.g. `"{date}-{team1}-{team2}"`. Upsert on this so a daily re-sync updates rows instead
of duplicating them.

### `bets`
One row per bet. Stake is deducted from balance the moment this row is created.

| column | type | notes |
|---|---|---|
| id | uuid (PK) | |
| user_id | uuid (FK→profiles) | |
| match_id | uuid (FK→matches) | |
| pick | text | `team1` / `team2` (see draw note) |
| stake | int | > 0 |
| payout | int | null until settlement |
| outcome | text | `won` / `lost` / `refunded` / null |
| placed_at | timestamptz | default now() |

Rule: a bet may only be inserted while the match is `scheduled` AND now() < kickoff_at.
Enforce in the DB (RPC or policy), not just UI.

### accuracy — a VIEW, not a table
Derive from `bets` + `matches` so it can never drift:
- bets_placed = count of settled, non-refunded bets
- correct = count where pick matched match.result
- wrong = bets_placed − correct
- win_rate = correct / bets_placed
- streak = current run of consecutive correct (compute in the query/app)

## The seed / pool rule
At settlement, `pot = sum(stake)` over all bets on the match.
If `pot < 300`, set `pot = 300` — the difference is house-funded (points appear from
nowhere; fine, it's a fun game). A healthy pool (≥300) is never topped up.

## Settlement — `settle_match(match_id)` RPC

MUST be one atomic transaction. Run once per match (guard on status).

```
function settle_match(match_id):
  load match; assert status = 'closed' (or 'scheduled' past kickoff) and result is set
  bets = all bets for match_id
  pot = sum(b.stake for b in bets)
  if pot < 300: pot = 300

  winning_pick = result   # 'team1' or 'team2'  (draw: see note)
  winners = [b for b in bets if b.pick == winning_pick]
  winning_stake = sum(b.stake for b in winners)

  if winning_stake == 0:
      # push — nobody picked the winner; refund every stake
      for b in bets:
          profiles[b.user_id].points_balance += b.stake
          b.payout = b.stake; b.outcome = 'refunded'
  else:
      for b in bets:
          if b.pick == winning_pick:
              b.payout = round(b.stake / winning_stake * pot)
              profiles[b.user_id].points_balance += b.payout
              b.outcome = 'won'
          else:
              b.payout = 0; b.outcome = 'lost'   # stake already deducted at placement

  match.status = 'settled'; match.settled_at = now()
```

Note loser stakes are NOT re-deducted — they were taken when the bet was placed.
Winners get their proportional slice credited. Net effect for a winner = payout − stake.

## Draw handling (open decision)
Group games can draw. Options:
- **Treat draw as a push**: if result = 'draw', refund all bets. Simplest; recommended v1.
- Add 'draw' as a third pick. More interesting, more UI. Defer.
Recommend: draw = refund-all (push) for v1, so picks stay team1/team2 only.

## RLS (Supabase)
- `profiles`: a user reads all (leaderboard) but updates none directly — balance only
  changes via bet placement and settlement RPC.
- `bets`: a user inserts only their own (and only on a bettable match); reads all
  (so the pool is visible).
- `matches`: read for all; writes only by the sync job / admin (service role).
- Settlement runs as a `security definer` RPC so normal users can't touch balances.
