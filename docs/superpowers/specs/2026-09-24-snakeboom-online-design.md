# SnakeBoom Online: Design Spec

- **Date:** 2026-09-24
- **Status:** Reviewed 2026-09-24; decisions 10, 11 and 13 confirmed by the developer
- **Scope:** Online 1v1 duels started from invite links, plus quick-match, hosted at `snakeboom.com`. Builds on the v1 local prototype (`2026-09-23-snakeboom-v1-design.md`, v0.7.0) and the local AI opponent (PR #9). Local play stays exactly as it is.

## 1. Goal

Let two people play SnakeBoom from different computers. One player creates a room and sends a link; the other opens it and they play a first-to-N match with rematches. Quick-match pairs strangers who are online at the same time.

The rules engine (`src/sim`) already runs the same way in every browser and in Node, so both players can run the whole game locally and exchange nothing but inputs. The server is a small relay that pairs players, forwards inputs, and referees the result. It runs on the existing Happy Path box next to ClearDeal and Captain's Log, and it is written so it can move to Cloudflare Durable Objects later without a rewrite.

### Success criteria

1. Two people in different cities in the same country play a full first-to-5 match with rematches, and steering feels the same as local play. No visible rubber-banding at a round trip of 80 ms.
2. A headless test plays bot-vs-bot through a simulated network with 80 ms of round trip and 20 ms of jitter, and both sides finish every round with identical state hashes.
3. A tab refresh mid-match rejoins the same match within 5 s.
4. A player who disappears for 15 s forfeits, and the other player gets a clean "you win" screen, never a hang.
5. `git tag v0.8.0 && git push --tags` deploys the game to `snakeboom.com` with no manual steps after the one-time host setup.
6. The relay costs nothing to run beyond the existing box: no database, no new AWS resources.

### Non-goals

- Touch and phone play. A link opened on a touch-only device shows a "play this on a computer" page that keeps the link. (The v1 spec expected touch in this spec; that's deferred to keep this milestone set small. Nothing here prevents it.)
- Spectating.
- Accounts, ranking, stats and match history. The relay logs results to stdout only.
- Playing the AI online. The AI is a local fallback (section 3.3); an online match is always two people.
- More than two players in a room.
- WebRTC peer-to-peer transport. The protocol is transport-agnostic and this could be added later.
- Server-side simulation for cheat detection. The relay compares state hashes (section 5.7); replaying inputs on the server is a possible later step.
- Regional servers. One relay in us-east-2.
- A stage environment. Deploys go straight to prod (see decision 10).
- Voice, chat and emotes.

## 2. Decisions log

| # | Topic | Decision |
|---|---|---|
| 1 | Netcode | Rollback. Both clients run the sim; inputs go through a WebSocket relay; the opponent's next input is predicted and corrected when the real one arrives. |
| 2 | Hosting | The existing Happy Path EC2 box: Docker Compose, the shared Caddy, GHCR images, GitHub Actions deploy. Room logic is kept portable so it can move to Cloudflare Durable Objects later. |
| 3 | Scope | Invite-link duels and quick-match. No phone play, no spectating. |
| 4 | Latency target | Friends in the same country: 20–80 ms round trip. Tuned for that, works up to about 200 ms. |
| 5 | Identity | Anonymous with a display name saved in `localStorage`. No accounts. |
| 6 | Disconnects | Pause with a 15 s countdown, then the missing player forfeits the match. A refresh rejoins. |
| 7 | Config | The default config only. The room creator picks first-to-N. The tuning panel is disabled online. |
| 8 | Anti-cheat | The relay is the referee: it logs every input and compares state hashes from both clients. A mismatch voids the match. |
| 9 | Domain | `snakeboom.com`, registered in Route 53 with DNS in Route 53. The relay is at `api.snakeboom.com`. |
| 10 | Environments | Prod only. A `v*` tag deploys to prod. There's no database to migrate and the game is its own smoke test. Stage can be added later with the same files. |
| 11 | Lobby | A ready-up lobby. Both players see names, match length and ping, and each presses Space to ready up. The same lobby serves invite links, quick-match pairs and rematches. |
| 12 | Repo | Same repo, same package. New folders `src/net` (shared protocol) and `src/server` (the relay). Two Docker images: web (static) and api (relay), following the ClearDeal layout. |
| 13 | AI fallback | The local AI opponent (PR #9, `src/sim/bots/opponent.ts`, Easy/Normal/Hard) is offered while quick-match is waiting, so nobody is stuck on an empty queue. It plays locally, not through the relay. |

## 3. Player experience

### 3.1 Title screen

Today the title screen uses ← / → for the match length and ↑ / ↓ for the opponent (Human, Easy, Normal, Hard). It becomes a short menu of rows, moved between with ↑ / ↓ and highlighted in the player color. ← / → adjusts the highlighted row, and Space confirms:

| Row | ← / → | Space |
|---|---|---|
| **LOCAL · HUMAN / EASY / NORMAL / HARD** | picks the opponent | starts a local match |
| **FIRST TO N** | picks the match length | starts a local match |
| **CREATE LINK** | | makes a room and shows the lobby with the link |
| **QUICK MATCH** | | joins the queue |

The match length applies to local play and to rooms you create. The row you were on last is remembered. The first time you pick an online row, a name box appears: 1–12 characters, letters, digits and spaces, saved in `localStorage`. Empty means you play as CYAN or PINK.

### 3.2 Rooms and the lobby

- A room has a 6-character code from the alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I). The link is `https://snakeboom.com/r/ABC123`.
- Opening the link, or choosing CREATE LINK, shows the **lobby**: the code, the link with a "Copy" button, both players' names and colors, the match length and the ping between the players (the relay's estimate). The room creator is CYAN (player 1) and the guest is PINK (player 2).
- Each player presses Space to ready up, and can press it again to un-ready. When both are ready, the relay starts the match. If a player leaves the lobby, the other player's ready state is cleared.
- Anyone else who opens the link while the room is full sees "This room is full" and a button to start their own.
- A room with nobody in it is deleted after 2 minutes. A room with no activity for 10 minutes is closed and both players are told.

### 3.3 Quick-match

- QUICK MATCH shows "Looking for an opponent…" with the number of players online, a Cancel button, and your own invite link so you can pull a friend in while you wait. If a friend joins your link, you leave the queue.
- After 10 s with nobody, the screen adds "or play the AI now · press A", which leaves the queue and starts a local match against the Hard opponent at your first-to-N. Nothing online happens after that; it's the v1 local game.
- When two players are in the queue, the relay puts them in a fresh room, and both see the lobby. The player who queued first is CYAN, and the match length is that player's first-to-N choice. The lobby shows it, so the other player can leave if they don't like it.
- Cancel or Esc leaves the queue.

### 3.4 Playing

- The countdown starts when both are ready. The match plays exactly like local play: same rules, same effects, same HUD, with the players' names in place of CYAN and PINK on the top bar.
- The HUD shows a small ping readout next to the clock. It turns amber above 120 ms and red when the game is stalled waiting for the opponent's input (section 5.4).
- Esc opens a pause overlay that reads "Leave the match?" with "Esc again to leave · Space to stay". The sim does not pause online. Leaving is a forfeit.
- Blur releases all keys, as it does locally, but doesn't pause. A hidden tab counts as a disconnect (section 3.6).
- Space at the match-over screen requests a rematch: "Rematch? · waiting for PINK". When both have pressed it, a new match starts from the lobby's settings, with a new seed. Esc goes back to the lobby, and the opponent is told.

### 3.5 Results

The match-over screen has one more line than local play: "Reported to the referee" normally, or one of the outcomes below.

- **Forfeit:** "PINK left · CYAN wins the match".
- **Desync:** "Out of sync · match voided". Both players are returned to the lobby. This should never happen; if it does, it means a determinism bug, and the relay logs both hashes and the input log for that match so it can be reproduced.
- **Server restart:** "The server restarted · match ended". Back to the title.

### 3.6 Disconnects and rejoins

- If a player's socket drops or their tab is hidden, the other player sees "PINK reconnecting… 15" counting down over the frozen game. The game stops advancing (the rollback window runs out within a fraction of a second, section 5.4).
- If the missing player comes back in time, play resumes where it stopped. A refreshed tab rejoins the room with a session token kept in `sessionStorage`, receives the whole input log for the current match, replays it at full speed ("Rejoining…", a few seconds at most), and continues.
- If the countdown reaches 0, the relay ends the match and the remaining player wins it.

## 4. Architecture

### 4.1 The pieces

```
src/
  sim/            unchanged, plus hashState()
  net/            shared by client and server: message types, binary input encoding, room
                  state machine, and the rollback session — pure TypeScript, no DOM, no Node
    protocol.ts   message types and the version constant
    codec.ts      binary input frames ↔ objects
    room.ts       the Room state machine (lobby, playing, paused, over) with a host interface
    session.ts    NetSession: the rollback engine, transport-agnostic
    fakeRelay.ts  an in-memory relay with latency and jitter, for tests
  server/         Node only
    index.ts      HTTP + WebSocket server, /health, config from env
    wsHost.ts     adapts `ws` sockets and Node timers to the Room host interface
    quickMatch.ts the queue
    log.ts        JSON-lines logging
  client/
    net/          browser only: WebSocket transport, the online game mode, lobby and queue screens
```

The **relay** is stateless across restarts. Rooms, queues and input logs live in memory. No database.

### 4.2 Why the room logic is portable

`Room` in `src/net/room.ts` never touches sockets or timers directly. It gets a `RoomHost` with `send(player, message)`, `close(player, reason)`, `now()` and `setTimeout(ms, fn)`, and it exposes `onMessage(player, message)` and `onDisconnect(player)`. The Node server wraps `ws` in that interface. A Durable Object could wrap its own WebSocket pairs and alarms in the same interface, and Cloudflare's WebSocket hibernation maps onto it. The same purity test that guards `src/sim` guards `src/net`: no `window`, `document`, `node:` imports, `Date` or `performance`. Time comes only from the host.

### 4.3 Stack additions

- `ws` for the server's WebSockets, and `hono` with `@hono/node-server` for `/health` and the room-create endpoint, matching the other Happy Path APIs.
- Node 22, as on the box.
- `tsc -p tsconfig.server.json` builds `src/{sim,net,server}` to `dist-server/`, run with `node dist-server/server/index.js`.
- The client learns the relay URL from `VITE_API_URL` at build time (`https://api.snakeboom.com`); in dev it defaults to `http://localhost:3001`.
- `pnpm dev` runs Vite and the relay together. `pnpm dev:web` and `pnpm dev:relay` run them separately.

## 5. Netcode

### 5.1 Overview

Both clients run `step` at 60 Hz. Each client sends its own input for each tick to the relay, which forwards it to the other client and appends it to the match's input log. A client that hasn't received the opponent's input for a tick yet predicts it (the last known turn and boost, and no Use), keeps stepping, and rolls back when the real input turns out to be different.

The relay never runs the sim. It picks the seed, sets the input delay from the measured pings, forwards inputs, keeps the log for rejoins, compares hashes, and decides forfeits.

### 5.2 Input delay and ticks

- Each client keeps its own **local tick** counter, starting at 0 when the match starts, and steps the sim once per local tick.
- The input a player presses during local tick `T` is applied at tick `T + D`, on both machines. `D` is the **input delay** in ticks. Both machines apply both players' inputs at the same ticks, so the game is symmetric.
- The relay chooses `D` at match start from the players' pings to the relay: `D = clamp(ceil((rttA + rttB) / 2 / 2 / 16.67 ms), 1, 4)`. That's the estimated one-way latency between the players, rounded up to ticks, between 1 and 4. At 80 ms round trip it's 2 ticks (33 ms), which is below the threshold most players notice. `D` stays fixed for the match.
- Each input message carries its tick, so inputs can be applied in order no matter when they arrive.

### 5.3 Rollback

`NetSession` keeps two states:

- **Confirmed:** the state at the last tick for which both players' inputs are known. It only ever moves forward, and it's cheap: one `step` per tick, no cloning.
- **Predicted:** the state the screen shows, at the local tick, which is ahead of the confirmed state by the ticks whose remote inputs are still predicted.

Each animation frame:

1. Apply any inputs that arrived from the relay. Advance the confirmed state through every tick that is now fully known.
2. If any newly confirmed remote input differs from what was predicted, **roll back**: `predicted = cloneState(confirmed)`, then step it through the remaining ticks up to the local tick with the corrected inputs. This is the only place `cloneState` is called.
3. Otherwise, the predicted state is still right. Step it one tick for each local tick the fixed-step loop wants (as today, at most 5 per frame).
4. Render the predicted state, interpolated as today.

Mispredictions are rare in a snake game: a turn input changes a few times a second. When they happen, the correction is at most a few ticks of a snake's heading, which reads as a tiny twitch of the opponent's head.

**Budget:** rollback re-simulates at most `maxRollback` = 10 ticks. `cloneState` of a late-round state plus 10 steps must fit in 12 ms on the developer's Mac, measured by `pnpm bench:rollback`. If `structuredClone` is too slow (the grid cache holds up to ~11k entries per round), `cloneState` gets a hand-written copy that skips the grid and rebuilds it.

### 5.4 Stalls and time sync

- **Stall:** if the local tick gets more than `maxRollback` ticks ahead of the confirmed tick, the client stops stepping until more inputs arrive. The ping readout turns red, and after 0.5 s a "Waiting for PINK…" caption appears. A stall is what a disconnect looks like from the inside.
- **Time sync:** the two clients drift apart because their clocks run at slightly different rates and because one of them may have started late. Every input message carries the sender's local tick. Using the relay's latency estimate, each client works out how far ahead of its peer it is; the one that is ahead by more than 1 tick runs its fixed-step loop at 97% speed until it isn't. Nobody speeds up. The countdown phase (3 s of ignored inputs) absorbs the start-up difference.
- **Start:** the relay's `start` message includes a start time on the relay's clock; each client estimates the relay clock offset from its ping/pong exchange and begins tick 0 at that moment. Time sync fixes the rest.

### 5.5 Events during rollback

The sim's events are cosmetic or flow. Online, `NetSession` tags every event with its tick and whether it came from the confirmed or the predicted state.

- **Cosmetic events** (sparks, sounds, pickup bursts, explosion visuals, near misses, `heartLost`) play the first time a tick is simulated, and are de-duplicated by `(tick, type, player or id)` so a rollback doesn't replay them. A mispredicted cosmetic event is a rare wrong sound; that's accepted.
- **Flow events** (`death`, `roundOver`, `matchOver`, `overtime`) drive the death beat, the banners and the scores, so they fire only from the confirmed state. That's at most `D` plus a few ticks after the predicted state showed them, well under 100 ms at the target latency, and never wrong.

The HUD reads hearts, items and the clock from the predicted state, as it does locally.

### 5.6 The wire format

The transport is one WebSocket per client to `wss://api.snakeboom.com/ws`. Control messages are JSON text frames. Inputs are binary frames because there are 60 of them a second each way.

**Input frame (6 bytes):** `0x01`, tick as uint32 little-endian, and one input byte: bits 0–1 turn (0 = straight, 1 = right, 2 = left), bit 2 boost, bit 3 use. The relay forwards the frame unchanged, prefixed with the sender's player index, and appends it to the log. That's about 400 bytes a second per direction.

**Control messages (JSON):**

| Direction | Message | Purpose |
|---|---|---|
| client → relay | `hello {protocol, version, name, session?}` | First message. `protocol` must match the relay's; otherwise `error {code: "version"}` and the client shows "Please refresh". `session` rejoins a room. |
| client → relay | `create {winsToWin}`, `join {room}`, `queue {winsToWin}`, `leaveQueue` | Rooms and the queue. |
| relay → client | `welcome {player, room, link, session}` | You're in a room. `session` is the rejoin token. |
| relay → client | `lobby {players: [{name, ready}], winsToWin, ping}` | Sent on every change. |
| client → relay | `ready {ready}` | Toggle. |
| relay → client | `start {seed, winsToWin, inputDelay, startAt, latency}` | Both ready. The sim config is the client's `DEFAULT_CONFIG` with this `winsToWin`. |
| both | `ping {t}` / `pong {t, serverTime}` | Every second. The relay measures each client's RTT and shares the estimate. |
| client → relay | `hash {tick, hash}` | Every 60 confirmed ticks and at each `roundOver`, with the round result. |
| relay → client | `desync {tick}` | Hashes differ. Match voided. |
| relay → client | `peerAway {deadline}` / `peerBack` | The disconnect countdown. |
| client → relay | `away` / `back` | Sent on `visibilitychange`, so a hidden tab is treated as a disconnect promptly. |
| relay → client | `forfeit {winner, reason}` | The countdown ran out, or the opponent left. |
| relay → client | `replay {fromTick, frames}` | On rejoin: the input log as a binary blob. |
| client → relay | `rematch` / `leave` | After a match. |
| relay → client | `peerLeft`, `closed {reason}`, `error {code, message}` | The rest. |

Client and server share the types in `src/net/protocol.ts`, and `PROTOCOL` is a number bumped on every incompatible change. The web and api images are deployed together, so a mismatch only happens when a player has an old tab open.

### 5.7 The referee

- **Hashes:** `hashState(state)` in `src/sim` is a 32-bit FNV-1a over a canonical serialization of the gameplay state: everything except the grid cache. `JSON.stringify` is precisely specified for numbers, so two engines serialize identical doubles identically. Every 60 confirmed ticks each client sends the hash; the relay compares each pair. At `roundOver` the hash message also carries the winner and scores. A mismatch anywhere sends `desync` to both and logs both hashes plus the input log.
- **Results:** the relay logs one JSON line per round and per match: room, players' names, winner, scores, ticks, rollback count and max, and whether the result was clean, forfeited or voided.
- **What this stops:** a client can't claim a win the other client's sim didn't produce, because the hashes wouldn't match. What it doesn't stop is a client that plays with perfect information about the opponent's next inputs (there aren't any secrets in this game) or a bot driving the keys. That's acceptable for a friends-first game.

### 5.8 Rejoin in detail

1. The client reconnects and sends `hello` with its session token.
2. The relay finds the room, re-attaches the player, sends `welcome`, then `replay` with every input frame of the current match, then `peerBack` to the other player.
3. The client creates a fresh match from the original seed and steps through the log as fast as it can, then continues normally. Late in a 90 s round that's about 5,400 ticks, a few seconds at most.
4. If the client never closed (a hidden tab), it still has its state and only asks for frames after its confirmed tick.

The relay keeps the log in memory. A 10-minute match is under a megabyte.

### 5.9 Abuse limits

- `Origin` must be `https://snakeboom.com` (or localhost in dev).
- One `hello` per socket; 5 rooms per IP per minute; a queue entry per socket; messages over 1 KB are dropped and the socket closed.
- Input frames are accepted only while playing, only with monotonic ticks, and only up to 600 ticks ahead of the peer.
- Rooms are capped at 200 live at once. Beyond that, `create` returns `error {code: "busy"}`.

## 6. Sim changes

Small, and all kept deterministic:

- `hashState(state): number`.
- `cloneState` may get a hand-written copy (section 5.3). Tests keep it equal to the `structuredClone` result.
- The determinism test gains a golden hash: a fixed seed and input script must produce a known hash, so an accidental rule change shows up as a failing test with a documented "update the golden value" step.
- Nothing else. Rounds, rematches, phases and inputs already work in ticks with no wall clock, and inputs outside the `playing` phase are already ignored.

## 7. Client changes

- **Game modes:** `main.ts` currently owns the loop, the sim and the screens for local play. It's refactored into a `LocalGame` and an `OnlineGame` that share the renderer, HUD, fx, audio and screens. The local game keeps its single `step` call. The online game hands the loop's ticks to `NetSession`.
- **Screens:** the title menu, the name box, the lobby, the queue screen, the reconnecting overlay, the leave prompt and the online match-over lines. They are HTML overlays like the existing ones.
- **Ping readout** on the HUD.
- **Routing:** `/r/ABC123` opens the join flow. The web container's Caddy serves `index.html` for unknown paths.
- **Tuning panel:** disabled online (the backtick key does nothing), and the online config is always `DEFAULT_CONFIG` plus `winsToWin`, never the saved local config.
- **Touch-only devices:** detected by `pointer: coarse` with no hover; show the "play on a computer" page with the link and a Copy button.

## 8. Deployment

Following the ClearDeal pattern exactly, so the runbooks in `captainslog/infra/README.md` and `happypathsoft-infra/README.md` apply.

### 8.1 Files in this repo

```
Dockerfile.api                 node:22-alpine, pnpm install, tsc server build, node dist-server/server/index.js on :3001
Dockerfile.web                 build the Vite site with VITE_API_URL, serve dist/ with caddy:2-alpine on :3000 (SPA fallback)
infra/snakeboom/docker-compose.yml
infra/snakeboom/.env.example
infra/caddy.d/snakeboom.caddy
.github/workflows/test.yml     pnpm test, typecheck, build
.github/workflows/deploy.yml   on v* tag or dispatch: test → build and push images → deploy
```

- **Images:** `ghcr.io/dzwillia/snakeboom-api:<tag>` and `ghcr.io/dzwillia/snakeboom-web:<tag>`. One web image, because there's no stage.
- **Compose:** containers `snakeboom-api` and `snakeboom-web`, both on `happypathsoft-net` only (no `db-net`), `restart: unless-stopped`, `APP_VERSION` from the tag, `ALLOWED_ORIGIN=https://snakeboom.com`.
- **Caddy fragment:** `snakeboom.com` → `snakeboom-web:3000` with `encode gzip zstd`; `www.snakeboom.com` → permanent redirect to the bare domain; `api.snakeboom.com` → `snakeboom-api:3001` with the usual `X-Real-IP` / `X-Forwarded-For` headers. Caddy proxies WebSockets without extra configuration.
- **Health:** `GET /health` returns `{status, version, timestamp, rooms, players, queued}`.
- **Deploy workflow:** the ClearDeal script minus the migration and the stage step: scp the compose file and fragment, set the tag in `.env`, `docker compose pull && up -d`, install and validate the fragment, `caddy reload`, then curl `/health` until it reports the tag.

### 8.2 One-time setup

1. **DNS (Route 53):** A records for `snakeboom.com`, `www.snakeboom.com` and `api.snakeboom.com` pointing at the box's Elastic IP. (The nameservers are already on Route 53; the A records don't exist yet.)
2. **Host:** `mkdir /opt/happypathsoft/snakeboom`, copy the compose file, create `.env` (mode 600) from the example. No `provision-product.sh`, because there's no database.
3. **GitHub:** the repo needs the same `EC2_HOST`, `EC2_USER` and `EC2_SSH_KEY` secrets as the other apps, and GHCR package visibility set so the box can pull.
4. **Backups:** none. The relay has no state worth keeping. Nothing to add to `backup-freshness.yml`.

### 8.3 Deploy behavior

A deploy restarts the relay, which ends any live match with "The server restarted". The health endpoint reports live players, so a deploy can wait for a quiet moment. Zero-downtime deploys are out of scope.

## 9. Testing

- **Protocol:** encode/decode round trips for input frames and every control message.
- **Room:** the state machine with a fake host and fake timers: create, join, full room, ready and un-ready, start, input forwarding and logging, hash agreement and desync, away/back, the 15 s forfeit, rejoin with replay, rematch, idle and empty-room cleanup, and the abuse limits.
- **Rollback (the important one):** two `NetSession`s connected through `fakeRelay` with configurable one-way latency and jitter, driven by the existing bots. Assertions: both sessions produce identical hashes every 60 ticks and at every round end; at 80 ms ± 20 ms the game never stalls; at 200 ms it stalls only briefly; rollback depth never exceeds the budget; and cosmetic events are never played twice for the same tick. A variant drops one side for 3 s and checks that it stalls and resumes.
- **Hash:** stable for equal states, sensitive to a single changed number, ignores the grid.
- **Purity:** the scan now covers `src/net`.
- **Server:** start the relay on an ephemeral port, connect two `ws` clients, run a scripted match end to end, hit `/health`.
- **Benchmark:** `pnpm bench:rollback` reports `cloneState` time and a 10-tick rollback on a late-round state.
- **Manual:** two browser windows on localhost; then two machines over the internet before v1.0.0.

## 10. Milestones

Each ends with a playable checkpoint. Version numbers continue from v0.7.0.

**M5: Wire (v0.8.0)**
- `hashState`, the golden determinism test, the purity scan for `src/net`.
- `src/net`: protocol, codec, `Room`, `NetSession`, `fakeRelay`, and the rollback test suite.
- `src/server`: the Node relay with rooms, `/health`, ping, hashes and the forfeit countdown. Dev script.
- Client: `LocalGame` / `OnlineGame` split, title menu, name box, CREATE LINK lobby, join by link, the online HUD ping and the reconnect overlay.
- The title-screen menu rework, keeping the opponent selector from PR #9.
- Playtest: two windows on one machine, then two machines on the same network.

**M6: Match (v0.9.0)**
- Quick-match queue and screen, with the AI fallback.
- Rejoin with replay. Rematch and leave flows. Desync and server-restart outcomes.
- Time sync tuning and the stall caption. `bench:rollback` and any `cloneState` work it calls for.
- Abuse limits and result logging.
- Playtest: two machines in different cities.

**M7: Ship (v1.0.0)**
- Dockerfiles, compose, Caddy fragment, workflows, host setup, DNS records.
- "Play on a computer" page for touch devices.
- README: online play, hosting and the deploy procedure.
- Playtest: `snakeboom.com` with a friend. The "one more match" test, remotely.

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| `cloneState` too slow for rollback late in a round | Benchmark early in M5; hand-written clone that skips the grid cache. Rollback depth is capped and stalls are visible rather than silent. |
| A determinism gap between browsers (a `Math.sqrt` edge, or a JS engine difference) | The hash check catches it within a second, the match is voided rather than silently wrong, and the input log makes it reproducible in the headless test. |
| TCP head-of-line blocking on a lossy connection | Accepted for the same-country target. The stall is visible. A WebRTC unreliable channel is the later fix and the protocol doesn't preclude it. |
| The relay restarts during a match | Announced on screen; deploy when `/health` shows no players. |
| A first WebSocket app on the shared Caddy | Caddy proxies WebSockets by default. The M7 checklist verifies it on the real box before DNS moves. |
| Abuse of an open relay | Origin check, per-IP room limits, message size and rate limits, room cap. |
| Two players with very different pings | `D` is chosen from the larger one, and the faster client slows to match. |

## 12. Workflow

- Work happens on the `online` branch, with a commit after each task and a PR to `main` at each milestone, which the developer merges after playtesting.
- Plans come from this spec, one per milestone, in `docs/superpowers/plans/`.
