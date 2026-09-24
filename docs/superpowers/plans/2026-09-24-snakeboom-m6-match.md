# SnakeBoom M6 (Match) Implementation Plan

> **For agentic workers:** work task by task on the `online` branch, test first, commit after each task. Steps use checkbox (`- [ ]`) syntax for tracking. Like the M5 plan, this gives interfaces, algorithms and test cases; the implementer writes the code against them.

**Goal:** Everything around a match that M5 left out (online spec milestone M6, v0.9.0):
- Quick-match: strangers get paired, and the AI is offered while you wait.
- Rejoin with replay: a refreshed tab rebuilds the match from the relay's input log.
- Rematch and leave flows after a match.
- A rollback benchmark, and a hand-written `cloneState` if it earns its keep.
- The remaining abuse limits.
- A two-window check of each flow, then a remote playtest.

**Spec:** `docs/superpowers/specs/2026-09-24-snakeboom-online-design.md`, sections 3.3, 3.4, 3.6, 5.3, 5.8 and 5.9.

**What M5 already covers** (don't redo): the relay, rooms, hashes and desync, the 15 s countdown and forfeit, hidden-tab away/back, time sync, the stall caption, ping readout, origin check, the 1 KB cap, tick checks, the 200-room cap, JSON-line result logs, `RELAY_LAG_MS`.

## Global Constraints

- Everything in the M5 constraints still applies: `src/sim` and `src/net` stay pure and plain-data, exact-pinned dependencies, `pnpm test`, `pnpm typecheck` and `pnpm build` green after every task, commits on `online` with the `Co-Authored-By` trailer.
- `PROTOCOL` becomes 2 (new messages). The relay refuses protocol 1 with `error {code: "version"}`, which the client already shows as "Please refresh".
- A rejoin must never change what the peer's sim computes: the rejoining client only consumes the log; it sends nothing until it has caught up.
- The browser check from M5 (Playwright's cached Chromium, `--use-gl=angle --use-angle=swiftshader`, `window.__snakeboom.online.debug`) is the acceptance tool for every client flow here. `RELAY_LAG_MS` stands in for the network.

## Review Focus

1. **Replay fidelity.** A session rebuilt from the relay's log must reach exactly the hash the original session had at the same tick, and the peer must never see a desync during or after a rejoin. Tested in Task 2 (net) and Task 6 (browser).
2. **Queue races.** Two players queueing in the same instant, a queued player whose friend arrives by link, a queued player who cancels, and a queued player whose socket drops must all leave the queue consistent, with no room paired twice. Tested in Task 1.
3. **Rematch state.** After a match, a room returns to the lobby with both ready flags cleared, a rematch starts with a fresh seed and an empty log, and a rejoin token from the previous match still identifies its seat. Tested in Task 3.
4. **Catch-up cost.** Rebuilding 90 s of match (5,400 ticks) must finish within a few seconds without freezing the tab: it runs in slices per animation frame with a progress caption. Tested in Task 4 (bench) and Task 6 (browser).
5. **Abuse limits are invisible to real players.** Five rooms a minute per IP and one queue entry per socket must never trigger during a normal session of creating, leaving and re-creating rooms. Tested in Task 5.

---

### Task 1: Quick-match in the relay

**Files:**
- Create: `src/net/quickMatch.ts`, `src/net/quickMatch.test.ts`
- Modify: `src/net/protocol.ts`, `src/server/index.ts`, `src/server/registry.ts`, `src/server/server.test.ts`

**Design.** A quick-match entry *is* a room: QUICK MATCH creates the player's own room and flags it open. The next player to queue joins the oldest open room instead of making one. That gives the waiting player an invite link for free (spec 3.3), and a friend arriving by link simply fills the room and takes it out of the queue.

**Protocol additions:**
```ts
// client → relay
| { type: 'queue'; winsToWin: number }   // create an open room, or join the oldest open one
| { type: 'leaveQueue' }                 // close my open room and go back to the title
// relay → client
| { type: 'queued'; waiting: number; online: number }   // sent to every queued player on change
```
`welcome` and `lobby` follow a successful pairing exactly as for a link join.

**Interfaces (`quickMatch.ts`):**
```ts
export class QuickMatch {
  /** Oldest open room code first. */
  readonly open: string[];
  /** Adds an open room; returns false if it is already listed. */
  offer(code: string): boolean;
  /** The oldest open room other than `except`, removed from the list, or null. */
  take(except?: string): string | null;
  /** Removes a room (filled, closed or cancelled). */
  withdraw(code: string): void;
  get size(): number;
}
```
The server owns the policy: `queue` → `take(myOpenRoom)`; if it returns a code whose room is still `waiting`, join it; otherwise create a room, `offer` it, and send `queued`. `withdraw` is called when a room's status leaves `waiting` (the registry watches `room.onStatus`, a new callback on `Room`), when the room closes, and on `leaveQueue` (which also frees the seat and closes the socket's room). `queued.online` is the number of open sockets.

- [ ] **Step 1: Write the failing tests.** `quickMatch.test.ts`: FIFO order, `take` skips `except`, `withdraw` of an unknown code is a no-op, `offer` twice is false. `server.test.ts`: two clients `queue` → the first gets `queued {waiting: 1}`, the second gets `welcome {player: 1}` in the first's room and the first gets `lobby` with both; a third `queue` gets its own room and `queued`; `leaveQueue` from a waiting player closes their socket and a later `queue` from someone else does not land in that room; a link `join` into an open room takes it out of the queue (the next `queue` creates a new room).
- [ ] **Step 2: Run the tests to verify they fail**
- [ ] **Step 3: Implement**, including `PROTOCOL = 2` and the `Room.onStatus` hook.
- [ ] **Step 4: Run the tests to verify they pass**
- [ ] **Step 5: Commit** `feat(server): quick-match pairs open rooms`.

---

### Task 2: Rejoin with replay

**Files:**
- Modify: `src/net/protocol.ts`, `src/net/codec.ts` (+ test), `src/net/room.ts` (+ test), `src/net/session.ts` (+ test), `src/server/index.ts` (+ test)

**Protocol additions:**
```ts
// client → relay: hello gains `fromTick` (already typed): 0 after a refresh, confirmedTick + 1 when the tab kept its state
// relay → client, in this order on a mid-match rejoin: welcome, resume, one binary replay frame, lobby (and peerBack to the other seat)
| { type: 'resume'; seed: number; winsToWin: number; inputDelay: number; rttMs: number[]; frames: number }
```
**Replay frame (`codec.ts`):** `FRAME_REPLAY = 3`, then the relayed frames concatenated (7 bytes each). `encodeReplay(frames: Uint8Array[]): Uint8Array` and `decodeReplay(bytes): {player, tick, input}[] | null` (null on a bad length or any bad entry).

**Room:** keeps `match: {seed, winsToWin, inputDelay, rttMs} | null` from the last `start`. `rejoin(session, fromTick)` while `playing` or `over` sends `resume` and the replay of every logged frame with `tick >= fromTick` after `welcome`. Frames are already in arrival order; the client sorts by tick per seat anyway.

**NetSession additions:**
```ts
/** A local input from the relay's log, after a refresh. Stored without sending. */
restoreLocal(tick: number, input: PlayerInput): void;
/** Steps the confirmed state through up to `maxTicks` fully-known ticks and mirrors the predicted state; returns ticks stepped. */
catchUp(maxTicks: number): number;
/** True while the predicted tick is behind the newest known remote tick by more than inputDelay. */
get behind(): boolean;
```
`catchUp` advances `confirmed` as `reconcile` does, then sets `predicted = cloneState(confirmed)` when done (no misprediction bookkeeping is needed because nothing was predicted). Events from catch-up are discarded by the caller.

**Client flow (wired in Task 6):** on boot at `/r/CODE`, if `sessionStorage` holds a token for that room, `hello` carries `session` and `fromTick: 0`. On `resume`, build the session with `local = me`, feed the replay (`restoreLocal` for my frames, `receive` for the peer's), then call `catchUp(300)` once per animation frame under a "REJOINING… 37%" caption until `behind` is false, then resume normal ticking. Only then does the loop start calling `advance`, so nothing is sent while catching up. If the sim is in `roundOver` or `matchOver` after catch-up, show that banner from the state.

- [ ] **Step 1: Write the failing tests.**
  - `codec`: replay round-trip of 0, 1 and 1,000 frames; a 1-byte-short blob and a blob with a bad turn code give null.
  - `room`: rejoin mid-match sends `welcome`, `resume` with the start values, a replay containing every relayed frame, then `lobby`; `fromTick` drops earlier frames; rejoin in the lobby sends no `resume`.
  - `session`: run the M5 fake-relay harness for 2,000 frames, capture side 1's sent inputs and side 0's received inputs as a log, build a fresh session for seat 1, `restoreLocal` and `receive` from the log, `catchUp` until done, and expect its confirmed hash at the last fully-known tick to equal the original's; then connect it to the link in place of the old side 1 and run 500 more frames with agreeing hashes.
  - `server`: a client that reconnects with its token and `fromTick: 0` mid-match receives `resume` and a replay whose frame count matches `resume.frames`.
- [ ] **Step 2: Run the tests to verify they fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the tests to verify they pass**
- [ ] **Step 5: Commit** `feat(net): rejoin with replay from the relay's input log`.

---

### Task 3: Rematch and leave

**Files:**
- Modify: `src/net/room.ts` (+ test), `src/client/net/online.ts`, `src/client/screens.ts` (+ test)

**Room:** when both results agree on a match winner, status goes to `lobby` (not `over`), both ready flags clear, `lobby` is broadcast, and the log, hashes and results reset on the next `start`. `over` is reserved for forfeit and desync; from `over`, if both seats are still connected the room also returns to `lobby`, otherwise `waiting`. Session tokens survive across matches.

**Client:** at the sim's `matchOver`, Space sends `ready {ready: true}` and the match-over panel gains a line, "REMATCH REQUESTED · WAITING FOR BOB" or "BOB WANTS A REMATCH · SPACE TO ACCEPT", driven by the `lobby` message's ready flags (`Screens.matchOverLine(text)` updates just that line). `start` begins the new match. Esc at match-over sends `ready {ready: false}` and shows the lobby (phase `lobby`); Esc in the lobby leaves as today. After a forfeit or desync the notice's hint becomes "SPACE LOBBY · ESC MENU" when the peer is still there.

- [ ] **Step 1: Write the failing tests.** `room`: after a match result, status is `lobby` with both `ready: false`; both `ready` again → a second `start` with a different seed and `room.log` empty; after a `forfeit`, the winner's `ready` leads nowhere until a new player joins; a forfeited seat's old token no longer rejoins. `screens`: `matchOverLine` replaces the line without touching the title or scores.
- [ ] **Step 2: Run the tests to verify they fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the tests to verify they pass**
- [ ] **Step 5: Commit** `feat(net): rematches from the match-over screen`.

---

### Task 4: The rollback benchmark and `cloneState`

**Files:**
- Create: `scripts/bench-rollback.ts`
- Modify: `package.json` (`"bench:rollback": "tsx scripts/bench-rollback.ts"`), possibly `src/sim/state.ts` (+ `state.test.ts`)

**Bench:** drive two simple bots to 85 s of round time with `roundMaxSeconds` raised so the round is still live, then report the median and p95 of 200 runs of: `cloneState` alone; `cloneState` plus 10 `step`s (a full rollback); `hashState`; and a 300-tick `catchUp` slice. Also print the state's JSON size.

**Decision rule:** if a 10-tick rollback exceeds 12 ms at p95 on the developer's Mac, replace `cloneState` with a hand-written copy (typed arrays and objects copied field by field, grid cells sliced). Keep the `structuredClone` result as the oracle in `state.test.ts`: both copies must be deep-equal and independent. If it is under budget, leave `cloneState` alone and record the numbers in the plan.

- [x] **Step 1: Write the bench and run it.** Paste the numbers here as a comment.
  <!-- 2026-09-24, M2 MacBook, state at 57 s of round (447 KB JSON, 6.8k grid entries):
       cloneState median 0.99 ms · p95 2.20 ms; rollback (clone + 10 steps) median 1.06 ms · p95 2.80 ms;
       hashState median 2.65 ms; catch-up 300 steps median 1.94 ms. Under budget: cloneState unchanged. -->
- [ ] **Step 2: If over budget, write the failing equality test, then the hand-written clone, and rerun the bench.**
- [ ] **Step 3: Commit** `perf(sim): rollback benchmark` (and `cloneState` if changed).

---

### Task 5: The remaining abuse limits

**Files:**
- Modify: `src/server/index.ts` (+ test), `src/server/registry.ts`

- Five room creations per IP per minute (`create` and `queue` both count), using `X-Forwarded-For`'s first address when present (Caddy sets it) and the socket address otherwise. Over the limit: `error {code: "busy", message: "Slow down a little."}` and the socket stays open.
- One open queue entry per socket: a second `queue` is a no-op that resends `queued`.
- The queue holds at most 50 open rooms; beyond that `queue` answers `error {code: "busy"}`.
- `/health` gains `queued` (open rooms) for real.

- [ ] **Step 1: Write the failing tests** (six creates from one address → the sixth is refused; a second `queue` doesn't create a second room; `/health.queued` counts open rooms).
- [ ] **Step 2: Run the tests to verify they fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the tests to verify they pass**
- [ ] **Step 5: Commit** `feat(server): per-address room limits and queue caps`.

---

### Task 6: Client wiring, browser checks, README, ship v0.9.0

**Files:**
- Modify: `src/client/net/online.ts`, `src/client/main.ts`, `src/client/screens.ts` (+ test), `src/client/style.css`, `README.md`, `package.json`

**Queue screen:** `Screens.queue({link, waiting, online, seconds, aiOffered})`: "LOOKING FOR AN OPPONENT…", the player count, the room link with Copy, "ESC CANCEL", and after 10 s "OR PLAY THE AI NOW · PRESS A". `A` leaves the room and starts a local match against Hard at the chosen first-to-N (the existing local flow, with `settings.opponent` untouched). The title's QUICK MATCH row now sends `queue {winsToWin}` after the name box.

**Rejoin:** `sessionStorage['snakeboom.session'] = {room, session}` on `welcome`; cleared on leave and on a `closed` message. The boot router and the `resume` flow from Task 2. A "REJOINING… 37%" caption during catch-up.

**Rematch:** the match-over line and Space/Esc from Task 3.

**Browser checks** (extend the M5 Playwright script; run each with `RELAY_LAG_MS=50`):
- Quick-match: A and B both choose QUICK MATCH → A sees the queue screen with the link, B lands in A's lobby, both ready, the match starts. A third window queuing alone sees "OR PLAY THE AI NOW" after 10 s and pressing A starts a local match with the AI tag on PINK.
- Rejoin: mid-round, `B.reload()`. A shows "RECONNECTING…"; B shows "REJOINING…" then the live game; the round finishes with agreeing hashes (the relay log has no `desync`) and both reach the same banner.
- Rematch: after "WINS", both press Space → a new countdown, new seed in the relay log, scores reset.
- Leave: Esc at match-over shows the lobby; Esc again returns to the title and the peer sees `peerLeft`.

- [ ] **Step 1: Wire the screens and flows; keep `window.__snakeboom.online.debug` current.**
- [ ] **Step 2: Run the browser checks; fix what they find; keep the screenshots for the PR.**
- [ ] **Step 3: README:** quick-match and the AI fallback, refresh-to-rejoin, rematches.
- [ ] **Step 4: Verify everything:** `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm bench:rollback`, `pnpm soak --rounds 50`.
- [ ] **Step 5: Commit and PR.** Bump to `0.9.0`, commit `feat: quick-match, rejoin with replay and rematches (v0.9.0)`, push, open the PR to `main` titled "M6: Match — quick-match, rejoin and rematches". The developer merges after the playtest.

**Playtest:** the spec asks for two machines in different cities. That needs a relay reachable from the internet, which M7 deploys. Either play M6 on a LAN and do the remote test right after M7's first deploy, or, if you want it sooner, run the relay on the Happy Path box by hand behind a temporary Caddy fragment.
