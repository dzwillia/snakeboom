# SnakeBoom M19: Up to Eight Players

**Goal (v0.19.0):** free-for-all rooms of 2–8, online and against bots locally. Spec: `docs/superpowers/specs/2026-09-26-snakeboom-players-design.md` (issue #20).

## Tasks

### Task 1: The sim plays N
- `createMatch(cfg, seed, players)`, ring spawns with tile clearing, `DeathRecord.tick`, places and placement points in `endRound`, `roundOver.places`, `lastPlaces`, match target `winsToWin × (N−1)` with unique-leader rule, `roundCapSeconds`, `maxPickupsFor`/`pickupIntervalFor`, invariants, config fields, golden hash. Tests at 2, 3 and 8 players; soak with `--players`.
- [x] Commit `feat(sim): matches of up to eight players`.

### Task 2: Rollback for N seats
- `NetSession` per-seat histories, `receive(seat, …)`, N-way prediction, lead against the slowest seat; codec player range; `FakeLink` for N; `inputDelayFor(rtts)`; netsim `--players`; session tests at 2, 4 and 8 with hash agreement.
- [x] Commit `feat(net): rollback sessions for up to eight seats`.

### Task 3: Rooms of N
- Protocol 8 (`size`, `seats`, `ended`, `seatAway/Back/Left`, `places` in results); `Room` with `size` seats, start rule, ghost seats with synthesised inputs, N-way hashes and results, 2-player grace/forfeit kept; registry/server create/queue with size; per-size quick match. Room and server tests.
- [x] Commit `feat(relay): rooms of up to eight`.

### Task 4: The client
- Colours, names, CSS; title PLAYERS row; local bots; `OnlineMatch` generalised (seats, names, lobby, rematch line, notices); HUD scoreboard layout; renderer views on demand and name tags; spectator camera; round and match banners with places. Tests for text, HUD, screens.
- [x] Commit `feat(client): eight-player lobbies, HUD, camera and banners`.

### Task 5: Verify and ship
- `pnpm test`, typecheck, build, `soak --players 8 --bots hard,…`, `netsim --players 8 --profile hotspot`; Playwright: a local 8-bot match with screenshots; an online 3-tab match through the local relay including one tab dropping and rejoining. README (Play, Online, How it plays), hunt spec addendum, bump `0.19.0`, PR.
