# SnakeBoom M8 (Net Feel) Implementation Plan

> **For agentic workers:** work task by task on the `netfeel` branch, test first, commit after each task. Steps use checkbox (`- [ ]`) syntax for tracking. Interfaces, algorithms and checks are given; the implementer writes the code.

**Goal:** Online play feels like local play on an ordinary connection, and we can prove it with numbers (v1.1.0).

**What the first real playtest showed (2026-09-24, one player on a phone hotspot):** round trips to the relay of 120–176 ms per player, no desyncs or forfeits in twelve rounds, but "freezes or stutter" and "game speed wobbled". The relay had chosen an input delay of 4 ticks (67 ms of local steering lag) and the rollback window was 10 ticks (167 ms), which a hotspot's jitter overruns, so the game stalled; the time-sync slowdown ran the leading side at 97% speed, which reads as a wobble.

**The approach, in order of expected payoff:**
1. **Measure.** A net-stats readout in the client and per-round netcode stats in the relay log, so every later change is judged by stalls per minute and rollback depth, not by feel alone.
2. **Widen the rollback window and lower the input delay.** Prediction absorbs the network; the local delay stays at 1–2 ticks.
3. **Gentler time sync.** A proportional, smoothed adjustment on both sides, within a deadband, capped at 1%.
4. **Smooth rollback corrections** visually, so a wrong guess about the opponent reads as a small drift, not a snap.
5. **Reproduce hotspot conditions headlessly** (jitter spikes, bursts) in the fake relay and a `pnpm netsim` CLI, and tune against them.

Not in M8: a WebRTC unreliable channel (the fix for TCP head-of-line blocking on lossy links). Decide after M8's numbers say how much stall remains on a lossy link.

**Spec:** `docs/superpowers/specs/2026-09-24-snakeboom-online-design.md`, sections 5.2–5.5. This plan amends the numbers in 5.2 and 5.3; update the spec in Task 2.

## Global Constraints

- Everything from M5–M7 still applies. `src/sim` and `src/net` stay pure; both peers must agree on every tunable that affects the sim (input delay comes from the relay; the rollback window and time sync are client-side and may differ between peers without affecting determinism).
- Protocol 3 (the round result gains net stats). The relay refuses older clients with "Please refresh".
- Every tuning change is checked with the netsim at three profiles before it ships: **good** (RTT 40 ± 10 ms), **hotspot** (RTT 150 ± 60 ms with 300 ms spikes every 5–10 s), **far** (RTT 250 ± 40 ms).
- Deploy as v1.1.0 through the existing workflow; then a second real playtest on the same hotspot, comparing the relay's logged stats with the first one.

## Review Focus

1. **No stalls on the hotspot profile.** With the new window and delay, the netsim's hotspot profile must show zero stalled ticks over 5 minutes of bot play, and the far profile fewer than 1 stall per minute. Task 2.
2. **Time sync converges without oscillating.** Two sessions started 8 ticks apart must be within 1 tick inside 3 seconds and stay there, with the time scale never outside 0.99–1.01. Task 3.
3. **Smoothing never hides the truth.** The visual offset after a rollback decays fully within 6 frames and is never applied to collision or to the sim; a head that is dead draws where it died. Task 4.
4. **Stats are honest.** The overlay's stalls-per-minute and rollback counts match `NetSession.stats` exactly, and the relay log's per-round stats match what the client showed. Task 1.
5. **Nothing changes for local play.** Local mode never constructs a session, never shows the overlay unless asked, and the frame loop's cost is unchanged. Task 1 and 4.

---

### Task 1: Measure — net-stats readout and per-round stats in the relay log

**Files:**
- Modify: `src/net/protocol.ts` (`PROTOCOL = 3`, `RoundResult.net`), `src/net/session.ts` (stats additions), `src/net/room.ts` (log the stats), `src/client/net/online.ts`, `src/client/hud.ts` (+ test), `src/client/style.css`, `src/client/main.ts` (the `N` key)

**Stats (`SessionStats` additions):** `ticks` (advanced), `stalledTicks`, `rollbacks`, `maxRollbackDepth`, `rollbackTicks` (sum of depths), `receivedLate` (remote inputs that arrived after their tick was predicted), and a per-second rolling `stallsPerMinute` computed by the client from deltas.

**Readout:** `Hud.setNet(stats | null)` renders a small monospace block under the ping: `delay 2 · rb 3/min (max 6) · stall 0/min · lead +0.4 · ×1.00`. Hidden by default; the `N` key toggles it online (and does nothing locally). The ping readout stays as it is.

**Per-round stats to the relay:** `RoundResult` gains `net: { stalledTicks, rollbacks, maxRollbackDepth, rollbackTicks, receivedLate, ticks }` for the round (deltas since the previous round). The relay logs them in the `round` entry: `{event: 'round', room, round, winner, net: [seat0, seat1], rttMs}`. This is what the second playtest is compared on.

- [ ] **Step 1: Write the failing tests.** `session.test.ts`: after the 40 ± 20 ms run, `stats.ticks` equals frames advanced, `rollbackTicks ≥ rollbacks`, `receivedLate ≥ rollbacks`. `room.test.ts`: a `hash` with a `result.net` produces a `round` log entry with both seats' net stats once both have reported. `hud.test.ts` (new, with a fake root): `setNet` renders the line and hides on null.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit** `feat(net): net-stats readout and per-round netcode stats in the relay log`.

---

### Task 2: Widen the window, lower the delay, and a netsim to prove it

**Files:**
- Modify: `src/net/session.ts` (`DEFAULT_MAX_ROLLBACK = 20`), `src/net/room.ts` (`inputDelayFor`), `src/net/fakeRelay.ts` (spikes and bursts), `src/net/session.test.ts`
- Create: `scripts/netsim.ts` (`"netsim": "tsx scripts/netsim.ts"`)
- Modify: the spec's sections 5.2 and 5.3

**Input delay:** `inputDelayFor` becomes: 1 tick when the one-way estimate is under 20 ms, otherwise 2, and 3 only above 150 ms one-way (RTT above 300 ms between the players). Rollback absorbs the rest.

**Rollback window:** 20 ticks (333 ms). The bench says a 20-tick rollback is about 5 ms; the frame budget at 60 Hz is 16.7 ms, and rollbacks are occasional.

**Fake relay additions:** `FakeLinkOptions` gains `spikeMs`, `spikeEveryMs` (a one-off extra delay applied to every packet sent during a 200 ms burst window, every N ms ± 50%) and `holdMs` (TCP-style: hold all packets for `holdMs` then deliver in order, modelling head-of-line blocking). Both default to off.

**`scripts/netsim.ts`:** runs two bot sessions through the fake relay for `--seconds` (default 300) at a named profile or explicit `--rtt --jitter --spike --spike-every --hold`, then prints stalls per minute, stalled ticks, rollbacks per minute, max and mean depth, and the tick difference between the sides at the end. Profiles `good`, `hotspot`, `far` as in Global Constraints.

- [ ] **Step 1: Write the failing tests.** `session.test.ts`: at the hotspot profile (150 ± 60 with 300 ms spikes every 7 s), D = 2, 3000 frames: hashes agree, `stalledTicks === 0`, `maxRollbackDepth ≤ 20`. `room.test.ts`: `inputDelayFor(60, 80)` is 2, `(20, 20)` is 1, `(320, 320)` is 3.
- [x] **Step 2: Implement, run `pnpm netsim` at all three profiles, paste the table into this plan as a comment.**
  <!-- 2026-09-24, window 30, 120 s of simple-bot play (bots twitch far more than people, so rollback counts are a ceiling):
       good    rtt 40±10                  delay 2: stalls 0 · rollbacks ~310/min · depth mean 0.7 max 1
       hotspot rtt 150±60 +300 ms spikes  delay 2: stalls 0 · rollbacks ~410/min · depth mean 10 max 29
       far     rtt 250±40                 delay 3: stalls 0 · rollbacks ~425/min · depth mean 13 max 15
       lossy   rtt 120±40, 300 ms holds   delay 2: stalls 0 · rollbacks ~325/min · depth mean 6 max 24
       All hash checkpoints agreed; tick difference 0 at the end. Window 20 would have stalled on the hotspot spikes (29 > 20). -->
- [ ] **Step 3: Update the spec (5.2, 5.3) and commit** `feat(net): 20-tick rollback window, 1–2 tick input delay, netsim with spikes and holds`.

---

### Task 3: Gentle time sync

**Files:**
- Modify: `src/net/session.ts` (a smoothed lead), `src/client/net/online.ts` (the time-scale rule), `src/net/session.test.ts`

**Rule:** the session keeps an exponential moving average of `lead(oneWayTicks)` (α = 0.1 per advance). The client sets `timeScale = 1 − clamp((smoothedLead − 1) × 0.005, 0, 0.01)` when the smoothed lead is above 1 tick, `1 + clamp((−smoothedLead − 1) × 0.005, 0, 0.01)` when it is below −1 tick, and exactly 1 inside the deadband. At most 1% either way, so a 10-tick gap closes in about 17 seconds without a visible change of pace, and both sides share the work.

- [ ] **Step 1: Write the failing test.** Two linked sessions where side 0 starts 8 ticks ahead (advance it 8 extra times before the run), with a harness that applies the time-scale rule to each side's frame accumulator: within 180 frames the tick difference is ≤ 1, and every time scale value lies in [0.99, 1.01]; over the following 1800 frames the difference never exceeds 2.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit** `feat(client): proportional, smoothed time sync within 1%`.

---

### Task 4: Smooth rollback corrections

**Files:**
- Modify: `src/net/session.ts` (report the correction), `src/client/net/online.ts`, `src/client/render/snakes.ts`, `src/client/render/renderer.ts`
- Create: `src/client/smoothing.ts`, `src/client/smoothing.test.ts`

**Session:** `advance` returns, alongside events, `corrections: { player, dx, dy }[]` for any head whose predicted position changed by more than 0.5 units because of a rollback this call (old predicted position minus new).

**Client:** `HeadSmoothing` keeps a visual offset per snake: on a correction, `offset += (dx, dy)`, clamped to 40 units; every frame `offset *= 0.6`, and it is zeroed below 0.1 units or when the snake dies. `Renderer.draw` takes an optional `offsets` array and adds each to that head's drawn position (and to the last trail segment's end so the tube stays attached). The offset never touches the sim.

- [ ] **Step 1: Write the failing tests.** `smoothing.test.ts`: a 10-unit correction decays below 0.1 within 6 frames; a second correction adds to the first; the clamp holds; death zeroes it. `session.test.ts`: a forced misprediction (remote turned while predicted straight) reports a correction for the remote seat only.
- [ ] **Step 2: Implement.** Check in the browser with `RELAY_LAG_MS=80`: a bot opponent's turns no longer snap.
- [ ] **Step 3: Commit** `feat(client): smooth rollback corrections on the drawn head`.

---

### Task 5: Verify, deploy v1.1.0, second playtest

- [ ] **Step 1:** `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm netsim` at all three profiles, `pnpm bench:rollback` (a 20-tick rollback under 8 ms at p95).
- [ ] **Step 2:** Headless two-window checks at `RELAY_LAG_MS=80`: a full match, a rejoin, the overlay reading sensible numbers.
- [ ] **Step 3:** Drop the redundant `X-Forwarded-For` line from the Caddy fragment (the warning in the deploy log). README: the `N` key.
- [ ] **Step 4:** Bump to `1.1.0`, commit `feat: net feel — measured, wider window, lower delay, gentle sync, smoothing (v1.1.0)`, PR to `main`, merge, tag, deploy.
- [ ] **Step 5:** Playtest again with the same hotspot player. Compare the relay's `round` entries with the first playtest's `start` entries (RTT) and the new stall and rollback numbers. That comparison decides whether M10 needs WebRTC.

---

## After M8: M9, the rules pass

M9 is the gameplay tuning milestone: a structured playtest checklist (pace, growth, hearts, item balance, map fairness, round length), the tuning panel's values as presets, and whatever the playtests say. It gets its own plan once M8's numbers are in, because a game that stutters can't be tuned.
