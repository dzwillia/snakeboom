# SnakeBoom Players: Up to Eight in a Match

- **Date:** 2026-09-26
- **Status:** Decided in a fourteen-question interview (issue #20). Free-for-all only.
- **Why:** every rule so far assumes two snakes. Rooms of up to eight turn a duel into a brawl, and let a group play together instead of in pairs.

## 1. Decisions (the interview, in order)

1. **Free-for-all.** No teams in this milestone.
2. **Placement points.** Every round each player scores by finishing place. With N players in the round, the last snake standing (place 1) scores N−1, the next N−2, and so on down to 0 for the first to die. Players who die on the same tick share a place. If the last survivors die together, nobody takes place 1: they all score as place 2 (so a 1v1 draw still scores nothing, as today). FIRST TO n means the first to n×(N−1) points, so "first to 5" is still five round wins' worth whatever the room size. If several players cross the target in the same round, the highest score wins; an exact tie plays another round.
3. **Dead players spectate.** The camera follows the longest live snake; Left/Right cycle through the live snakes, Up/Down zoom. Nothing is sent that matters: dead snakes ignore input.
4. **Round cap grows with players:** `roundMaxSeconds + roundSecondsPerExtraPlayer × (N−2)`, capped at `roundMaxSecondsCap` (45 + 10 per extra player, cap 90). The border starts closing `borderCloseSeconds` before the cap as now.
5. **Everything applies to everyone caught.** A loop kills every enemy head inside it (credited to the looper for each), fire cuts every enemy body in the cone, missiles home on the nearest enemy head. These already generalise; the spec only confirms it.
6. **Spawns on a ring.** With more than two players, spawns sit evenly on an ellipse (radii 32% of the arena's width and height) starting at the top, heading toward the centre. Blocks within 140 units of a spawn are cleared for the round (tiles only; the map source is untouched). Two players keep the maps' own spawns, so 1v1 is unchanged.
7. **Pickups scale, hazards don't.** `maxPickups × N/2` (rounded, capped at 40) and `pickupInterval × 2/N`; still one wormhole and one saw at a time.
8. **Rollback with N seats, prototyped first.** The session keeps an input history per seat, confirms a tick only when every seat's input is known, and predicts every missing seat. The fake relay links N sessions; netsim and the session tests run at 4 and 8 before the rest is built. Input delay comes from the two slowest round trips.
9. **The host sets a size (2–8); the match starts when everyone present is ready and at least two are in.** Late joiners fill empty seats before the start; nobody joins mid-match. Quick match queues by size and fills rooms toward it.
10. **Drops in rooms of three or more: dead this round, seat kept, may rejoin.** The moment a player's connection drops (or their tab hides), the relay starts synthesising neutral inputs for that seat, so the other players never wait: the snake coasts straight and usually dies. The seat, score and session token stay for the whole match, and a rejoin replays the log as today. If fewer than two humans remain connected, the match ends and the remaining player wins. Two-player rooms keep today's grace-then-forfeit behaviour.
11. **Camera follows your own head**, dead players get the spectator camera (3). Local play with bots keeps the fit-every-head camera.
12. **HUD: your panel plus a scoreboard.** With more than two players, your own full panel stays on the left and the right side lists everyone else: colour, name, alive or dead, score, selected item. Two players keep today's two panels.
13. **Eight fixed colours plus name tags.** Seats are CYAN, PINK, LIME, AMBER, VIOLET, ORANGE, ICE, RED. With more than two players every head carries a small name tag that fades near your own head.
14. **Bots fill empty seats in local play only.** The title gets a PLAYERS row (2–8). With more than two, seat 0 is you (and seat 1 a second human when the opponent is HUMAN); the rest are AI at the chosen level (NORMAL when the opponent is HUMAN). Online rooms are humans only.

## 2. The sim, precisely

- `createMatch(cfg, seed, players = 2)`; `MatchState.scores` has one entry per player; `startRound` spawns `players` snakes.
- A `DeathRecord` gains `tick` (round tick) so places can be settled at round end.
- Round end: when one or zero snakes are alive. `endRound` computes places from the deaths (same tick shares a place) and the survivor, awards points, records `state.lastPlaces: number[]` (place per player, 1 = winner), and reports `roundOver { winner, places, deaths }`. `winner` stays the survivor or null.
- Match end: any player at or above `winsToWin × (N−1)` with a unique top score.
- Border and clock use `roundCapSeconds(cfg, players)`.
- Pickup spawning uses `maxPickupsFor(cfg, players)` and `pickupIntervalFor(cfg, players)`.
- Spawns: `ringSpawns(players)` in `maps/spawns.ts`; `startRound` clears tiles within `spawnClearance` of each spawn when `players > 2`.
- The AI needs no rule changes: its opponent is already the nearest live enemy. Its territory field treats only that one as the rival, which is acceptable for now.
- The golden hash is re-pinned once (new fields); 1v1 behaviour is otherwise byte-identical.

## 3. Netcode

- `NetSession { players, local }`: `inputs: Map<tick, PlayerInput>[]` per seat, `latest[]` per remote seat, `predictedRemote: Map<tick, PlayerInput[]>`. A tick is confirmed when all seats' inputs are known; prediction reuses each remote seat's last turn and boost. `receive(seat, tick, input)`. Lead is measured against the slowest remote seat.
- Codec: the relayed frame's player byte allows 0–7.
- `FakeLink` links N sessions and broadcasts each input to the other N−1; `createLinkedSessions(..., players)`.
- `inputDelayFor(rtts)`: from the mean of the two largest round trips.

## 4. Relay and protocol (PROTOCOL 8)

- `create { winsToWin, size, name? }`, `queue { winsToWin, size }`. Size is clamped to 2–8.
- `Room` has `size` seats. `join` fills the lowest free seat while status is waiting or lobby. `lobby` carries every seat. `maybeStart`: at least two seated, all seated players connected and ready.
- `start { seed, winsToWin, players, seats, inputDelay, startAt, rttMs }` where `seats[roomSeat]` is the sim player index or −1 for an empty seat, so the sim only has the players who started. `resume` carries the same. Relayed frames carry the room seat; clients map seat to player.
- Absent seats during a match (size ≥ 3): a `ghost` flag; the room synthesises `NO_INPUT` frames for the seat for every tick up to the highest tick any connected seat has sent, logs them, and forwards them. A rejoin clears the flag; the client's own frames for ticks the room already has are dropped, as today. Fewer than two connected humans → `ended { winner, reason: 'left' | 'timeout' }` to the remaining player and back to the lobby.
- Two-player rooms keep grace and `forfeit` exactly as today.
- Hashes: per tick, compared once every connected, non-ghost seat has reported; any disagreement voids the match. Match result: every connected seat reports the same `matchWinner`.
- `seatAway { seat, deadline }` / `seatBack { seat }` replace peerAway/peerBack; `seatLeft { seat }` replaces peerLeft.
- Quick match: the queue is per size; a queued player's room is open until it starts.

## 5. Client

- `OnlineMode` create/quick carry `size`. The title's PLAYERS row sets the local player count and the online room size.
- `OnlineMatch`: `me` (room seat), `player` (sim index), `names[]`, `HeadSmoothing(players)`, lobby with N seats and "READY k/N", rematch line generalised ("3 OF 5 WANT A REMATCH"), notices for `ended`, `seatAway` shown as a small caption that doesn't cover the game.
- Local play: `startLocal()` creates `players` snakes; `bots: Map<seat, OpponentState>`.
- HUD: two-panel layout for two players; own panel plus scoreboard otherwise. `Hud.setLocal(player)`.
- Colours: `PLAYER_COLORS` and `PLAYER_CSS` have eight entries; CSS variables for each.
- Renderer: `SnakeView` per player created on demand; name tags (Pixi Text, constant screen size like the countdown) when players > 2.
- Camera: follow own head when alive; spectator otherwise (online) or fit all (local).
- Banners: round over lists places ("1. AMBER · 2. CYAN · …"), match over shows the scoreboard.

## 6. Out of scope

Teams, bots in online rooms, mid-match joins, per-player colour choice, more than eight.
