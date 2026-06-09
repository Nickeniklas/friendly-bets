# PROJECT_CONTEXT

Self-contained summary — paste into Claude project knowledge so fresh chats start informed.

## Project
A fun, non-commercial prediction/betting site for family & friends, for the 2026 FIFA
World Cup. No real money, ever. v1 scope: view matches, bet winner/loser, live-ish
scoreboard. Built by an owner who is new to Next.js and has no football knowledge (which
is exactly why the betting design needs no oddsmaking).

## Stack (settled)
- Next.js on Vercel
- Supabase — Postgres + Auth (magic link) + realtime
- openfootball worldcup.json for fixtures + results (free, no API key, refresh 1–2×/day)
- No real odds — a parimutuel betting pool instead

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

## Open items
- Settlement trigger: manual admin action for v1 (run after results post); may automate later.
- Whether to surface the live/implied multiplier in the UI (nice-to-have, not v1-critical).
