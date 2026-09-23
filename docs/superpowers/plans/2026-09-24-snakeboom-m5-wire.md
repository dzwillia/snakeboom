# SnakeBoom M5 (Wire) Implementation Plan

> **For agentic workers:** work task by task on the `online` branch, test first, commit after each task. Steps use checkbox (`- [ ]`) syntax for tracking. Unlike the M1–M4 plans, this one gives interfaces, algorithms and test cases rather than every line of code; the implementer writes the code against them.

**Goal:** Two people play SnakeBoom over the network from an invite link (spec milestone M5, v0.8.0):
- `hashState` and a golden determinism test.
- `src/net`: the protocol, the binary input codec, the `Room` state machine and the `NetSession` rollback engine, all pure and tested through an in-memory fake relay with latency and jitter.
- `src/server`: the Node relay with rooms, `/health`, pings, hash refereeing and the disconnect countdown.
- Client: a title menu, a name box, CREATE LINK, join by link, the ready-up lobby, the ping readout, the reconnecting overlay and the online match-over lines.
- Playtest: two windows on one machine, then two machines on one network.

Quick-match, rejoin with replay, rematch, abuse limits and deployment are M6 and M7.

**Spec:** `docs/superpowers/specs/2026-09-24-snakeboom-online-design.md`, sections 3.1, 3.2, 3.4, 3.6, 4, 5 and 6.

## Global Constraints

- `src/sim` and `src/net` stay pure: the purity scan (no `Math.random`, `Date`, `performance`, `window`, `document`, `node:` imports, `**`, engine-dependent `Math.*`) now covers both. Time comes from a host or the caller.
- `MatchState` stays plain data. `structuredClone` and `JSON.stringify` are the only serialization.
- The sim's tick rate stays 60 Hz. Every tick number in the protocol is a `MatchState.tick` value.
- Online gameplay uses `DEFAULT_CONFIG` with the room's `winsToWin`. The local tuning panel's saved config is never used online.
- `pnpm test`, `pnpm typecheck` and `pnpm build` pass after every task. New dependencies are pinned exactly (`pnpm add -E`).
- **Git:** before every commit, `git branch --show-current` must print `online`. Commit messages end with the `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer. The milestone ends with a PR to `main`; the developer merges after playtesting, and then `v0.8.0` is tagged.

## Review Focus

1. **Rollback correctness.** After any sequence of late, early or reordered remote inputs, both sessions' confirmed states must be identical. Tested in Task 3 (hash agreement through the fake relay at several latencies, with a seeded scramble of delivery order).
2. **Events under rollback.** A cosmetic event for a tick plays exactly once; a flow event fires only when its tick is confirmed. Tested in Task 3 (`EventGate`).
3. **Stalls.** When the remote goes quiet, the session stops within `maxRollback` ticks and resumes cleanly, with no duplicate sends and no skipped local inputs after resume. Tested in Task 3.
4. **Room lifecycle.** Disconnect during the lobby, during play and after a match must each end in a consistent state and never leak a timer. Tested in Task 4 with fake timers.
5. **The first message.** A socket that sends anything but a valid `hello` first, or an unsupported protocol number, is closed with `error {code: "version"}` and nothing else. Tested in Task 5.
6. **The local player uses either hand.** Online, WASD and the arrow keys both drive the local snake, and a Use press on either key is latched. Tested in Task 6 (`KeyboardInput.sampleLocal`).

---

### Task 1: `hashState`, the golden determinism test, purity for `src/net`

**Files:**
- Create: `src/sim/hash.ts`, `src/sim/hash.test.ts`
- Modify: `src/sim/index.ts` (export), `src/sim/determinism.test.ts` (golden), `src/sim/purity.test.ts` (scan `src/net` too)

**Interfaces:**
```ts
/** 32-bit FNV-1a of a UTF-16 string; deterministic in every engine. */
export function fnv1a(text: string): number;
/** Hash of the gameplay state: everything in MatchState except the grid cache. */
export function hashState(state: MatchState): number;
```

**Algorithm:** `hashState` destructures `{ grid, ...rest }` and returns `fnv1a(JSON.stringify(rest))`. Property order is creation order, and both peers create state through `createMatch`, so the string is identical on both sides. `fnv1a` loops over `charCodeAt`, `h ^= c; h = Math.imul(h, 0x01000193) >>> 0`, starting from `0x811c9dc5`.

- [ ] **Step 1: Write the failing tests** (`hash.test.ts`)
  - Equal states from the same seed hash equal, after 500 bot-driven ticks.
  - Changing `rng.s` by one changes the hash.
  - Pushing an entry into `grid.cells[0]` does not change the hash.
  - `hashState(JSON.parse(JSON.stringify(s)))` equals `hashState(s)`.
  - `fnv1a('')` is `0x811c9dc5` and `fnv1a('a')` is `0xe40c292c`.
- [ ] **Step 2: Run the tests to verify they fail**
- [ ] **Step 3: Implement** `hash.ts` and export from `index.ts`.
- [ ] **Step 4: Golden test.** In `determinism.test.ts`, add: seed 2024, `createBot(1)` and `createBot(2)`, 4000 ticks, `expect(hashState(a)).toBe(GOLDEN_HASH)`. Run once with a placeholder, paste the value, and add a comment: "Any intentional rule or tuning change updates this constant; an unintended change is a determinism regression."
- [ ] **Step 5: Purity for `src/net`.** Make the scanner in `purity.test.ts` take a list of directories: `SIM_DIR` and `../net` (skipped if the folder doesn't exist yet, since Task 2 creates it).
- [ ] **Step 6: Run the tests to verify they pass**
- [ ] **Step 7: Commit** `feat(sim): hashState and a golden determinism hash`.

---

### Task 2: The protocol and the input codec

**Files:**
- Create: `src/net/protocol.ts`, `src/net/codec.ts`, `src/net/codec.test.ts`, `src/net/names.ts`, `src/net/names.test.ts`

**Interfaces (`protocol.ts`):**
```ts
export const PROTOCOL = 1;
export type ClientMessage =
  | { type: 'hello'; protocol: number; version: string; name: string; session?: string; fromTick?: number }
  | { type: 'create'; winsToWin: number }
  | { type: 'join'; room: string }
  | { type: 'ready'; ready: boolean }
  | { type: 'pong'; t: number }
  | { type: 'hash'; tick: number; hash: number; result?: RoundResult }
  | { type: 'away' } | { type: 'back' }
  | { type: 'leave' };
export interface RoundResult { round: number; winner: number | null; scores: number[]; matchWinner: number | null }
export interface LobbyPlayer { name: string; ready: boolean; connected: boolean }
export type ServerMessage =
  | { type: 'welcome'; player: number; room: string; session: string; name: string }
  | { type: 'lobby'; players: (LobbyPlayer | null)[]; winsToWin: number; pingMs: number | null }
  | { type: 'start'; seed: number; winsToWin: number; inputDelay: number; startAt: number; rttMs: number[] }
  | { type: 'ping'; t: number }
  | { type: 'desync'; tick: number }
  | { type: 'peerAway'; deadline: number } | { type: 'peerBack' }
  | { type: 'forfeit'; winner: number; reason: 'left' | 'timeout' }
  | { type: 'peerLeft' }
  | { type: 'closed'; reason: 'idle' | 'restart' | 'full' | 'unknownRoom' }
  | { type: 'error'; code: 'version' | 'badMessage' | 'busy' | 'notInRoom'; message: string };
```
`queue`/`leaveQueue`, `replay` and `rematch` are added in M6. Times (`startAt`, `deadline`, `t`) are milliseconds on the relay's clock.

**Interfaces (`codec.ts`):**
```ts
export const FRAME_INPUT = 1;    // client → relay: [0x01, tick u32 LE, input u8]  (6 bytes)
export const FRAME_RELAYED = 2;  // relay → client: [0x02, player u8, tick u32 LE, input u8]  (7 bytes)
export function packInput(input: PlayerInput): number;     // bits 0–1 turn (0 straight, 1 right, 2 left), bit 2 boost, bit 3 use
export function unpackInput(byte: number): PlayerInput;
export function encodeInput(tick: number, input: PlayerInput): Uint8Array;
export function decodeInput(bytes: Uint8Array): { tick: number; input: PlayerInput } | null;
export function encodeRelayed(player: number, tick: number, input: PlayerInput): Uint8Array;
export function decodeRelayed(bytes: Uint8Array): { player: number; tick: number; input: PlayerInput } | null;
```
Decoders return `null` for the wrong length, wrong frame byte, a turn value of 3 or a player above 1. Ticks are unsigned 32-bit.

**Interfaces (`names.ts`):**
```ts
export const NAME_MAX = 12;
/** Trimmed, letters/digits/spaces only, single spaces, at most NAME_MAX chars; '' when nothing is left. */
export function sanitizeName(raw: unknown): string;
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function isRoomCode(s: unknown): s is string;   // exactly 6 chars from the alphabet
export function roomCode(rng: () => number): string;   // 6 chars from `rng()` in [0, 1)
export function displayName(name: string, player: number): string;  // name || PLAYER_NAMES-style default: 'CYAN' / 'PINK'
```

- [ ] **Step 1: Write the failing tests**
  - `codec`: every combination of turn ∈ {−1, 0, 1}, boost, use round-trips through pack/unpack and through encode/decode; a tick of `2**32 − 1` round-trips; the 5 bad-frame cases return `null`; `encodeRelayed(1, 7, …)` starts with `[2, 1, 7, 0, 0, 0]`.
  - `names`: `sanitizeName('  Dave  Z!!  ')` is `'Dave Z'`; a 20-char name is cut to 12; non-strings give `''`; `isRoomCode` rejects `'ABC120'` (has a 0) and lowercase; `roomCode` with a fixed rng returns a valid code; `displayName('', 1)` is `'PINK'`.
- [ ] **Step 2: Run the tests to verify they fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the tests to verify they pass** (the purity scan now covers `src/net`)
- [ ] **Step 5: Commit** `feat(net): protocol types, binary input codec and name rules`.

---

### Task 3: `NetSession`, the rollback engine, tested through a fake relay

**Files:**
- Create: `src/net/session.ts`, `src/net/events.ts`, `src/net/fakeRelay.ts`, `src/net/session.test.ts`, `src/net/events.test.ts`

**Interfaces (`session.ts`):**
```ts
export interface SessionOptions {
  seed: number;
  cfg: Config;
  /** 0 or 1: which seat this machine plays. */
  local: number;
  /** Ticks between pressing a key and it taking effect, ≥ 1. */
  inputDelay: number;
  /** Ticks the predicted state may run ahead of the confirmed state. Default 10. */
  maxRollback?: number;
  /** Outgoing local inputs, to be sent to the relay. */
  send: (tick: number, input: PlayerInput) => void;
}
export interface TaggedEvent { tick: number; event: SimEvent; confirmed: boolean }
export interface SessionStats { rollbacks: number; maxRollbackDepth: number; stalledTicks: number }

export class NetSession {
  constructor(opts: SessionOptions);
  /** The state to draw: the predicted state. */
  readonly state: MatchState;
  get tick(): number;             // predicted tick
  get confirmedTick(): number;
  get stalled(): boolean;         // the last advance() refused to step
  readonly stats: SessionStats;
  /** Highest remote tick received, for time sync; −1 before any. */
  get remoteTickSeen(): number;
  /** A remote input for a tick. Safe in any order; duplicates are ignored. */
  receive(tick: number, input: PlayerInput): void;
  /** One local tick: schedules `localInput` for tick + inputDelay, sends it, steps the predicted state. */
  advance(localInput: PlayerInput): TaggedEvent[];
  /** Ticks this machine is ahead of the peer, given the estimated one-way latency in ticks. */
  lead(oneWayTicks: number): number;
}
```

**Algorithm:**
- Two states: `confirmed` (from `createMatch`) and `predicted` (`cloneState` of it at construction). Inputs live in two sparse arrays indexed by tick: `localInputs[t]` and `remoteInputs[t]`. Ticks `1 … inputDelay − 1` of `localInputs` are pre-filled with `NO_INPUT`. `predictedRemote[t]` records the remote input the predicted state used for tick `t`, for ticks above `confirmedTick`.
- `advance(localInput)`:
  1. `const T = predicted.tick`. Assign `localInputs[T + inputDelay] = localInput` if not yet set, and call `send` for it. (Never overwrite: a stall must not re-send.)
  2. `reconcile()` (below).
  3. If `predicted.tick − confirmed.tick ≥ maxRollback`: set `stalled`, count it, return `[]`.
  4. Step `predicted` one tick with `[local, remote]` in seat order, where the remote input is `remoteInputs[T + 1]` if known, else the prediction: the input at the highest known remote tick with `use: false`, or `NO_INPUT`. Record it in `predictedRemote[T + 1]`. Return the events tagged `confirmed: false`.
- `receive(tick, input)`: ignore if already known. Store. If `tick ≤ predicted.tick` and `predictedRemote[tick]` differs in any field, set `needRollback`.
- `reconcile()`:
  1. While `remoteInputs[confirmed.tick + 1]` and `localInputs[confirmed.tick + 1]` are known: step `confirmed`, collect events tagged `confirmed: true`, delete `predictedRemote` for that tick.
  2. If `needRollback`: `predicted = cloneState(confirmed)`, then step it through `confirmed.tick + 1 … oldPredictedTick` using known remote inputs or the prediction rule, re-recording `predictedRemote`. Count a rollback and its depth. Events from these steps are tagged `confirmed: false`.
  3. Events from step 1 and step 2 are returned by the enclosing `advance` call, confirmed events first.
- `lead(oneWayTicks)`: the peer sends its input for tick `R + D` while at tick `R`, so `peerNow ≈ remoteTickSeen − inputDelay + oneWayTicks`; return `predicted.tick − peerNow`.
- Memory: drop `localInputs`, `remoteInputs` and `predictedRemote` entries older than `confirmed.tick − 600`.

**Interfaces (`events.ts`):**
```ts
export const FLOW_EVENTS: ReadonlySet<SimEvent['type']>;  // countdown, go, overtime, death, roundOver, matchOver
/** Which tagged events to act on: flow events once confirmed, cosmetic events the first time their tick is seen. */
export class EventGate {
  /** Returns the events to play, in order, and remembers them. */
  filter(events: TaggedEvent[]): SimEvent[];
  /** Forgets keys older than `tick − 600`. Called by the session owner once a frame. */
  prune(tick: number): void;
}
```
The key for a cosmetic event is `tick:type:` plus `player`, `id` or `x,y` whichever the event carries.

**Interfaces (`fakeRelay.ts`):**
```ts
export interface FakeLinkOptions { latencyMs: number; jitterMs: number; seed: number; }
/** Connects two sessions through a virtual clock. Messages arrive latency ± jitter later, possibly out of order. */
export class FakeLink {
  constructor(a: NetSession, b: NetSession, opts: FakeLinkOptions);
  /** Delivers everything due by `now + ms` and advances the clock. */
  advance(ms: number): void;
  /** Holds all traffic from one side (simulates a dropped connection). */
  pause(side: 0 | 1, paused: boolean): void;
  readonly now: number;
}
```
The link is built around the sessions' `send` callbacks, so construct the sessions with `send` set to `link.enqueue(side, tick, input)` via a small factory `createLinkedSessions(opts, sessionOpts)`.

**Test harness:** `runFrames(link, sessions, bots, frames)` steps both sessions once per 16.67 ms frame with `botInput` from each session's own predicted state (two `createBot` seeds, one per side, each side only steering its own seat), calls `link.advance(16.67)` after each frame, and collects hashes at every tick where `confirmedTick % 60 === 0` and at every confirmed `roundOver`.

- [ ] **Step 1: Write the failing tests** (`session.test.ts`)
  - **Agreement:** at latency 40 ms / jitter 20 ms, D = 2, 4000 frames: both sides' hash records match tick for tick, `stalledTicks` is 0, and at least one rollback happened (bots change direction).
  - **Order scramble:** at latency 100 ms / jitter 60 ms, D = 3: still identical hashes; `maxRollbackDepth ≤ 10`.
  - **Zero latency, D = 1:** identical hashes and zero rollbacks when the link delivers instantly (each frame's inputs arrive before the next).
  - **Stall and resume:** pause side 1 for 3 s at frame 600; side 0 stalls within 10 ticks, `stalled` is true; unpause; both catch up and hashes match through frame 2000; every local tick sent exactly once (count `send` calls = distinct ticks).
  - **Events:** during the agreement run, feed each side's tagged events through an `EventGate`; every `roundOver` fires exactly once per round and only with `confirmed: true`; no cosmetic key repeats.
  - **`lead`:** with `remoteTickSeen = 100`, `inputDelay = 2`, predicted tick 102 and one-way 2 ticks, `lead(2)` is 2.
- [ ] **Step 2: Run the tests to verify they fail**
- [ ] **Step 3: Implement** `session.ts`, `events.ts`, `fakeRelay.ts`.
- [ ] **Step 4: Run the tests to verify they pass.** Note the run time of the agreement test; if it exceeds 5 s, halve the frames.
- [ ] **Step 5: Commit** `feat(net): NetSession rollback engine, event gate and a fake relay`.

---

### Task 4: The `Room` state machine

**Files:**
- Create: `src/net/room.ts`, `src/net/room.test.ts`

**Interfaces:**
```ts
export interface RoomHost {
  now(): number;                                                     // ms
  send(player: number, message: ServerMessage | Uint8Array): void;
  close(player: number): void;
  setTimer(ms: number, fn: () => void): () => void;                  // returns cancel
  random(): number;                                                  // [0, 1)
  log(entry: Record<string, unknown>): void;
}
export interface RoomOptions { code: string; winsToWin: number; graceMs?: number /* 15000 */; idleMs?: number /* 600000 */; emptyMs?: number /* 120000 */; version: string; }
export type RoomStatus = 'waiting' | 'lobby' | 'playing' | 'over' | 'closed';
export class Room {
  constructor(host: RoomHost, opts: RoomOptions);
  readonly code: string;
  get status(): RoomStatus;
  /** Called when the room closes for any reason; the server deletes it. */
  onClosed: (() => void) | null;
  join(name: string): { player: number; session: string } | 'full';
  /** A returning socket. Returns the seat, or null if the token is unknown. */
  rejoin(session: string): number | null;
  onMessage(player: number, message: ClientMessage): void;
  onInput(player: number, frame: Uint8Array): void;
  onDisconnect(player: number): void;
  /** For /health. */
  get playerCount(): number;
}
```

**Behavior:**
- `join`: first joiner takes seat 0, second seat 1, third gets `'full'`. Sends `welcome` to the joiner and `lobby` to everyone. Status `waiting` with one, `lobby` with two.
- `ready`: sets the flag; broadcasts `lobby`. When both are ready and connected: `start` with `seed = floor(random() * 2^31)`, `inputDelay` from the pings (spec 5.2, using the latest RTT of each; unknown RTT counts as 100 ms), `startAt = now() + 1500`, `rttMs` for both; status `playing`; ready flags cleared; hash records cleared; input log cleared.
- `ping`: the room sends `ping {t: now()}` to each connected player every 1000 ms via a timer, and `pong {t}` sets that player's `rttMs = now() − t`. Every `lobby` message carries `pingMs = (rttA + rttB) / 2` when both are known.
- Input frames: accepted only while `playing`, only from a connected seat, only if `decodeInput` succeeds and the tick is above that seat's last tick and at most 600 above the other seat's last tick (or 600 total before the other seat has sent anything). Forwarded to the other seat as a relayed frame, and appended to `log: Uint8Array[]` (relayed frames, in arrival order).
- `hash`: stored by `(player, tick)`. When both seats have a hash for a tick: equal means both records are deleted; different means `desync {tick}` to both, a log entry with both hashes and the log length, status `over`. When a `hash` carries a `result`, the room stores it per player; when both results for a round agree and `matchWinner !== null`, status `over` and a log entry `{event: 'match', winner, scores}`. (M6 turns `over` back into `lobby` for rematches.)
- Disconnect while `playing`: the seat is marked disconnected, the other gets `peerAway {deadline: now() + graceMs}`, and a grace timer starts. If it fires: `forfeit {winner: other, reason: 'timeout'}` to the other, log, status `over`. `rejoin` in time cancels it and sends `peerBack` (the replay is M6; for now the client only rejoins with its state intact, i.e. a hidden tab).
- `away` / `back` are treated exactly like a disconnect and a rejoin, so a hidden tab starts the countdown promptly.
- Disconnect in `waiting`/`lobby`/`over`: the seat is freed (`peerLeft` to the other; their ready flag clears; status back to `waiting`). When no seat is connected, an `emptyMs` timer closes the room.
- `leave`: same as a disconnect, but the socket is closed too and the seat can't rejoin.
- Idle: every message from a player resets the `idleMs` timer; when it fires, `closed {reason: 'idle'}` to both, close both, status `closed`, `onClosed()`.
- `closed` cancels every timer. Every timer's callback checks the status first.

- [ ] **Step 1: Write the failing tests** with a `FakeHost` that records sends per player, keeps a manual clock, and runs timers in due order on `tick(ms)`.
  - Join flow: `waiting` → `lobby`; third join is `'full'`; `welcome.player` is 0 then 1; `lobby.players` shows names and ready flags.
  - Ready-up: only when both are ready is `start` sent to both, with the same seed, `inputDelay` 2 for 60 ms and 80 ms RTTs, 4 for 200 ms and 250 ms, and `startAt = now + 1500`.
  - Input forwarding: a frame from seat 0 arrives at seat 1 as a relayed frame with player 0; it's rejected before `start`, with a non-increasing tick, and when 601 ticks ahead of the other seat.
  - Hashes: equal hashes clear; unequal send `desync` to both and set `over`.
  - Grace: disconnect during play sends `peerAway` with the right deadline; a rejoin at 14 s sends `peerBack` and no forfeit; a rejoin at 16 s is too late and the other side got `forfeit {reason: 'timeout'}`.
  - Away/back mirror disconnect/rejoin.
  - Lobby disconnect frees the seat, clears the other's ready flag, and a new `join` takes seat 1 again.
  - Empty room closes after 2 min; an idle room closes after 10 min with `closed {reason: 'idle'}`; after `closed`, no timer fires (the fake host asserts none are pending).
- [ ] **Step 2: Run the tests to verify they fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the tests to verify they pass**
- [ ] **Step 5: Commit** `feat(net): Room state machine with lobby, refereeing and the disconnect countdown`.

---

### Task 5: The Node relay

**Files:**
- Create: `src/server/index.ts`, `src/server/wsHost.ts`, `src/server/registry.ts`, `src/server/log.ts`, `src/server/server.test.ts`, `vite.server.config.ts`
- Modify: `package.json` (deps `ws`, `hono`, `@hono/node-server`; dev deps `@types/ws`, `concurrently`; scripts), `tsconfig.json` (nothing, `types: ["node"]` is already there)

**Scripts:**
```json
"dev": "concurrently -k -n web,relay \"vite --open\" \"tsx watch src/server/index.ts\"",
"dev:web": "vite --open",
"dev:relay": "tsx watch src/server/index.ts",
"build": "tsc --noEmit && vite build && vite build --config vite.server.config.ts",
"build:server": "vite build --config vite.server.config.ts",
"start:server": "node dist-server/index.js"
```
`vite.server.config.ts`: `build.ssr = 'src/server/index.ts'`, `build.outDir = 'dist-server'`, `ssr.noExternal = []` (dependencies stay external), target `node22`. Add `dist-server` to `.gitignore`.

**Server (`index.ts`):**
- Env: `PORT` (3001), `ALLOWED_ORIGIN` (unset in dev means any `localhost` / `127.0.0.1` origin is accepted), `APP_VERSION` (`dev`).
- Hono app on `@hono/node-server`'s `serve`, with `GET /health` → `{status: 'ok', version, timestamp, rooms, players, queued: 0}`.
- A `WebSocketServer` from `ws` in `noServer` mode, attached to the Node server's `upgrade` event for path `/ws`; other paths get a 404 and the socket destroyed. The `Origin` header is checked before upgrading.
- Per connection: the first message must be a text frame parsing to `hello` with `protocol === PROTOCOL`; anything else gets `error {code: 'version' | 'badMessage'}` and a close. After `hello`, `create` and `join` (and `session` on the hello) attach the socket to a room through the registry; every later text message goes to `room.onMessage`, every binary frame to `room.onInput`. `close` calls `room.onDisconnect`. Messages over 1 KB close the socket.
- Graceful shutdown on SIGTERM: `closed {reason: 'restart'}` to every socket, then exit.

**Registry (`registry.ts`):** `create(winsToWin) → Room`, `get(code)`, `bySession(token)`, `count`, `players`. Codes come from `roomCode(Math.random)` with a retry on collision. `room.onClosed` removes it. Caps at 200 rooms (`error {code: 'busy'}`).

**Host (`wsHost.ts`):** `createWsHost(room sockets)` implementing `RoomHost` over `ws`: `send` serializes JSON for objects and sends binary for `Uint8Array`; `setTimer` wraps `setTimeout`; `now` is `Date.now()`; `random` is `Math.random`; `log` writes a JSON line with `room` and a timestamp through `log.ts`.

- [ ] **Step 1: Write the failing integration test** (`server.test.ts`): start the server on port 0 with `startServer({port: 0})` returning `{port, close}`; open two `ws` clients; hello → create → welcome; second hello → join → welcome with player 1; both `ready` → both get `start` with the same seed; client 0 sends 3 input frames, client 1 receives 3 relayed frames with player 0 and the same ticks; both send `hash {tick: 60, hash: 1}` → no desync; client 1 closes → client 0 gets `peerAway`; `GET /health` reports `rooms: 1`. Plus: a first message of `{"type":"create"}` gets `error {code: 'badMessage'}` and a close; `hello` with `protocol: 0` gets `error {code: 'version'}`; an `Origin` of `https://evil.example` is refused at upgrade when `ALLOWED_ORIGIN` is set.
- [ ] **Step 2: Run the test to verify it fails**
- [ ] **Step 3: Implement** the server, host, registry and log; add the scripts and the Vite server config.
- [ ] **Step 4: Verify:** `pnpm test`, `pnpm typecheck`, `pnpm build` (both builds), `pnpm start:server` then `curl localhost:3001/health`.
- [ ] **Step 5: Commit** `feat(server): the WebSocket relay with rooms, health and pings`.

---

### Task 6: Client online mode — transport, online match, screens, input and HUD

**Files:**
- Create: `src/client/net/transport.ts`, `src/client/net/online.ts`, `src/client/net/clock.ts`, `src/client/net/clock.test.ts`, `src/client/menu.ts`, `src/client/menu.test.ts`, `src/client/events.ts`
- Modify: `src/client/main.ts`, `src/client/screens.ts` (+ test), `src/client/hud.ts`, `src/client/input.ts` (+ `input.test.ts`), `src/client/keys.ts`, `src/client/settings.ts` (`name: string`), `src/client/text.ts`, `src/client/style.css`, `src/client/tuning.ts` (disable online)

**Pure helpers, tested first:**
```ts
// menu.ts — the title rows (spec 3.1)
export type MenuRow = 'local' | 'wins' | 'create' | 'quick';
export const MENU_ROWS: readonly MenuRow[];
export function nextRow(row: MenuRow, delta: number): MenuRow;   // clamps, no wrap
// clock.ts — relay clock offset from pings
export class RelayClock {
  /** A ping arrived carrying the relay's time `t`, and the relay last reported our RTT as `rttMs`. */
  onPing(t: number, localNow: number, rttMs: number | null): void;
  /** Relay time now, or null before the first ping. */
  toRelay(localNow: number): number | null;
  /** Local time at which relay time `t` happens. */
  toLocal(t: number): number;
}
// input.ts — either hand drives the local seat online
sampleLocal(): PlayerInput;   // union of both bindings: turn from whichever hand is held (both hands disagreeing = 0), boost from either, use latched from either
```
`RelayClock` keeps an exponential moving average of `t + rtt/2 − localNow` (α = 0.2; unknown RTT counts as 0).

**`events.ts`:** move the `handle(events)` switch out of `main.ts` into `class EventSink { constructor(deps: {fx, sound, screens, hud, names(), cfg}); handle(events: SimEvent[], state: MatchState): void; beat: DeathBeat | null }`. Local play calls it as before. Online play calls it with the output of an `EventGate`.

**`transport.ts`:** `class RelayConnection { constructor(url: string); onMessage: (m: ServerMessage) => void; onFrame: (f: Uint8Array) => void; onClose: (code: number) => void; send(m: ClientMessage): void; sendFrame(f: Uint8Array): void; close(): void; readonly open: boolean }`. Messages sent before the socket opens are queued. `binaryType = 'arraybuffer'`.

**`online.ts`:** `class OnlineMatch` owns the flow for one room visit:
- Constructor: `{ url, name, mode: {kind: 'create', winsToWin} | {kind: 'join', room}, deps: {screens, hud, sink, sound, input, cfg: DEFAULT_CONFIG, settings} }`.
- States: `connecting` → `lobby` → `starting` (waiting for `startAt`) → `playing` → `over` / `error`. Each shows a screen: `screens.lobby(...)`, `screens.online(...)` captions.
- On `start`: `cfg = {...DEFAULT_CONFIG, winsToWin}`; create the `NetSession` with `local = welcome.player`, `send` = encode and `sendFrame`; keep `startAt` via `RelayClock.toLocal`. `tick()` from the loop does nothing until `startAt`.
- `tick()` while playing: `session.advance(input.sampleLocal())` → `gate.filter` → `sink.handle`. Every 60 confirmed ticks and at confirmed `roundOver`: send `hash` with `hashState` of the confirmed state (the session exposes `confirmedState` read-only for this) and the `RoundResult` from the event.
- Relayed frames → `session.receive`.
- Time sync: once a frame, `loop.timeScale = session.lead(oneWayTicks) > 1 ? 0.97 : 1`, with `oneWayTicks = (rttA + rttB) / 2 / 2 / 16.67` from `start.rttMs`.
- `peerAway` → `screens.reconnecting(peerName, secondsLeft)` updated every frame from `RelayClock`; `peerBack` clears it. `forfeit` → `screens.matchOverOnline(...)` "PINK left · CYAN wins the match". `desync` → "Out of sync · match voided". `closed {restart}` → "The server restarted · match ended". Socket close without a reason → "Connection lost".
- `visibilitychange` → `away` / `back`. `Escape` → `screens.leavePrompt()`; a second Escape within 3 s sends `leave`, closes, and returns to the title. `Space` in the lobby toggles `ready`.
- HUD: `hud.setNames([...])` from `lobby`, `hud.setPing(ms, stalled)` every frame.

**Screens additions:** `title(menu: {row, winsToWin, opponent, hearts})` renders the four rows with the active one highlighted in the player color (the old two selectors become rows; keys shown per row). `nameBox(current, onSubmit)` (an `<input maxlength=12>` inside the overlay, `pointer-events: auto`, Enter submits, Escape cancels). `lobby({code, link, players, winsToWin, pingMs, you})` with a Copy button (`navigator.clipboard.writeText`, falls back to selecting the text). `caption(text)` for "Connecting…", "Waiting for PINK…", "Rejoining…". `reconnecting(name, seconds)`. `matchOverOnline(title, detail, color)`. `leavePrompt()`. `full(code)` and `touchOnly(link)` (the latter is wired in M7).

**HUD additions:** `setNames(names: string[])` (tags still work), `setPing(ms: number | null, stalled: boolean)` rendering a `.ping` element next to the clock: amber above 120 ms, red when stalled.

**`main.ts`:** becomes a small router. The `boot()` sets up the shared objects, then: if the path is `/r/CODE` (valid code) → ask the name if unset → `new OnlineMatch({mode: join})`. Otherwise the title. The title's Space on `create` → name if unset → `OnlineMatch({mode: create, winsToWin})`; on `quick` → `screens.caption('Quick-match arrives in the next milestone')` (M6). The `FixedLoop` tick calls `local.tick()` or `online.tick()` depending on the mode; the render callback is shared and draws `mode.state`. Leaving an online match calls `history.replaceState(null, '', '/')`. The tuning panel's backtick is ignored while online.

**Keys:** `GAME_KEYS` gains `Enter` only while the name box is open (the input element handles its own keys because `KeyboardInput` already ignores events targeted at inputs).

- [ ] **Step 1: Write the failing tests:** `menu.test.ts` (rows and clamping), `clock.test.ts` (offset converges to `t + rtt/2 − local` within 5 pings; `toLocal(toRelay(x)) ≈ x`), `input.test.ts` (`sampleLocal` with left hand turning left and right hand idle → −1; both hands disagreeing → 0; Use latched from either key and consumed once), `screens.test.ts` additions (the title renders four rows with the active one marked; the lobby shows the code, both names, READY flags and "waiting for a player" when one seat is empty).
- [ ] **Step 2: Run the tests to verify they fail**
- [ ] **Step 3: Implement** the helpers, `EventSink`, the transport, `OnlineMatch`, the screens, HUD, styles and the `main.ts` router.
- [ ] **Step 4: Typecheck and test**
- [ ] **Step 5: Commit** `feat(client): online mode — title menu, lobby, rollback play, ping and reconnect overlay`.

---

### Task 7: Wire, verify in two windows, README, ship v0.8.0

**Files:**
- Modify: `README.md`, `package.json` (version `0.8.0`), `src/client/style.css` as needed

- [ ] **Step 1: Two windows.** `pnpm dev`. Window A: CREATE LINK → name → lobby shows the code. Window B: open the link → name → lobby shows both. Both Space → countdown → a full first-to-3 match. Check: the ping readout shows a number; the HUD names are the typed names; steering feels instant in both windows; the death beat and banners appear once; the match-over screen shows the winner. Watch the console for errors and the `stats` (expose `window.__snakeboom.session` in dev) for rollback counts.
- [ ] **Step 2: Rough network.** In Chrome DevTools, throttle Window B's network to add 100 ms latency and repeat a round. Both windows must finish the round with no desync. Hide Window B's tab: Window A shows "PINK reconnecting… 15" and the game stops; show it again within 15 s: play resumes. Hide it for 16 s: Window A gets "PINK left · CYAN wins the match".
- [ ] **Step 3: Two machines.** Run the relay on one machine (`ALLOWED_ORIGIN` unset), `VITE_API_URL=http://<lan-ip>:3001 pnpm dev:web --host` and open it from a second machine on the same network. Play a first-to-3.
- [ ] **Step 4: README.** Add an "Online (preview)" section: what works in v0.8.0 (invite links on a LAN or a dev relay), how to run the relay, `VITE_API_URL`, and that `snakeboom.com` arrives with M7.
- [ ] **Step 5: Verify everything:** `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm soak --rounds 50`.
- [ ] **Step 6: Commit and PR.** Bump to `0.8.0`, commit `feat: online duels over a relay (v0.8.0)`, push `online`, open a PR to `main` titled "M5: Wire — online duels from an invite link". The developer merges after the playtest and tags `v0.8.0`.
