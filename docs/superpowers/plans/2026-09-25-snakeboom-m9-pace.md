# SnakeBoom M9 (Pace) Implementation Plan

> **For agentic workers:** work task by task on the `pace` branch, test first, commit after each task. Steps use checkbox (`- [ ]`) syntax for tracking. Interfaces, rules and checks are given; the implementer writes the code.

**Goal:** Rounds that move at a faster clip, with every ten seconds forcing a decision (v0.12.0). The developer's verdict after playing v0.10.0: "I find myself getting bored."

**What changes, and why (from the 2026-09-25 design conversation):**
- **Turbo and Slow go.** Turbo was invisible (you still had to hold Boost) and Slow made the other player's turn duller. Bomb, Ghost, Shield, Reverse and Bulldozer stay.
- **Mistakes matter twice as much:** 2 hearts, not 3.
- **Rounds are short and always end in a kill:** 45 s, with the arena border closing in over the last 15 s and, if both are still alive at time-up, closing fast until someone dies. No more draws at time-up.
- **The map tightens sooner:** double growth and start length.
- **Less time per decision:** faster snakes with the same handling.
- **Effects are moments, not stretches:** Reverse 2 s, Ghost 2 s, Bulldozer 3 s.
- **More forced decisions per minute:** pickups every 1.5 s, up to 6 on the field, bombs heavier in the mix.
- **Held for after the first session:** cross-cut scoring (crossing directly in front of the opponent's head takes a heart). It's the one new attack; decide once the pace is right.

**Spec:** `docs/superpowers/specs/2026-09-23-snakeboom-v1-design.md` sections 3.2–3.7 and 6. Task 3 adds a v0.12.0 entry to section 11 (Changes from playtesting).

## Global Constraints

- Everything from earlier milestones applies. The sim stays pure and deterministic; every new rule is tunable from the panel; the golden determinism hash is updated once, deliberately, in Task 3.
- **Protocol 4.** Rules changed, so an old tab against a new one would desync; the relay refuses older clients with "Please refresh".
- The old defaults stay reachable as `CLASSIC_CONFIG` for comparison during tuning sessions (Task 3), not as a game mode.
- Every task keeps `pnpm soak` running and reports round-length statistics; the target after Task 3 is a median round of 20–35 s and zero draws.

## Review Focus

1. **Nothing references the removed items.** After Task 1, `grep -rn "turbo\|slow" src` finds only `slowMo` (the death beat), and the powers page, HUD chips, tuning panel, glyphs, bots and pickup mix all agree on five kinds. Tests for the two items are deleted, not skipped.
2. **The closing border is deterministic and fair.** Both snakes see the same inset on the same tick; the inset is in `MatchState` (hashed), never computed from wall-clock time; pickups never spawn in the dead zone; a head in the dead zone is a wall hit with the usual heart and deflection rules. Task 2.
3. **No round ends in a draw at time-up.** With both alive at the cap, the fast close kills within a few seconds; the soak reports zero time-outs. Task 2 and 3.
4. **The AI knows the new rules.** Bots and the opponent look ahead against the current inset, not the arena edge, and never plan a Turbo or Slow. Task 1 and 2.
5. **Local and online agree.** A two-window online match with the new defaults finishes with agreeing hashes, including a round ended by the border. Task 4.

---

### Task 1: Remove Turbo and Slow

**Files:**
- Modify: `src/sim/config.ts` (`PickupKind`, weights, durations), `src/sim/types.ts` (`EffectTimers`, `EffectName`), `src/sim/items.ts`, `src/sim/snake.ts` (speed no longer has a slow factor), `src/sim/bots/simple-bot.ts`, `src/sim/bots/opponent.ts`, `src/sim/pickups.ts` if it enumerates kinds
- Modify: `src/client/colors.ts`, `src/client/glyphs.ts`, `src/client/text.ts`, `src/client/hud.ts`, `src/client/tuning.ts`, `src/client/audio.ts` (drop the two sounds), `src/client/events.ts`, `src/client/style.css`
- Delete or trim: the Turbo and Slow tests in `src/sim/step-powerups.test.ts`, `src/sim/items.test.ts`, `src/sim/pickups.test.ts`, `src/client/text.test.ts`, `src/client/screens.test.ts` (the powers page counts 5 glyphs)
- Modify: `README.md` (the items table), `src/net/protocol.ts` (`PROTOCOL = 4`)

- [ ] **Step 1:** Remove the two kinds and everything that names them; fix the types until `pnpm typecheck` is clean; delete their tests; make the remaining tests pass. `speed = baseSpeed × (boosting ? boostMultiplier : 1)`.
- [ ] **Step 2:** `pnpm soak --rounds 100` still runs clean (the golden hash test will fail until Task 3; mark it `todo` here with a note, and restore it in Task 3).
- [ ] **Step 3: Commit** `feat(sim): drop Turbo and Slow`.

---

### Task 2: The closing border

**Files:**
- Modify: `src/sim/config.ts`, `src/sim/types.ts` (`MatchState.inset`), `src/sim/state.ts` (reset per round), `src/sim/step.ts` (advance the inset; no draw at time-up), `src/sim/collision.ts` (wall test uses the inset), `src/sim/shield.ts` (deflection clamps to the inset), `src/sim/pickups.ts` (clearance from the inset), `src/sim/bots/simple-bot.ts` and `opponent.ts` (look-ahead against the inset), `src/sim/invariants.ts` (living heads inside the inset)
- Modify: `src/client/render/arena.ts` (draw the live border and dim the dead zone), `src/client/hud.ts` (clock turns red while the border moves), `src/client/tuning.ts`, `src/client/audio.ts` (a low "closing" tone when it starts)
- Tests: `src/sim/border.test.ts` (new), `src/sim/arena.test.ts`, `src/sim/step.test.ts`, `src/client/render` untested

**Rules:**
- `Config` gains `borderCloseSeconds` (15): the border starts moving that many seconds before `roundMaxSeconds`; `borderCloseSpeed` (12 units/s per side): the inset grows at this rate until time-up; `borderCrushSpeed` (120 units/s per side): the rate after time-up. Over the 15 s the playable area loses 180 units per side (1600×1000 → 1240×640); after time-up it collapses within about 5 s.
- `MatchState.inset` (units, per side, ≥ 0) is stepped in `stepPlaying` before movement, from `roundTicks`. It resets to 0 at round start. The inset is capped so the playable area never drops below `4 × snakeRadius` on either axis (someone will have died long before).
- **Wall hit:** the head circle crossing `inset` on any side. The deflection clamps inside the inset and sets the heading parallel to that side, exactly as for the real wall. Ghost doesn't help; Shield and hearts apply as usual.
- **Time-up:** no winner is declared. The round continues with the crush speed until a snake dies. `mostHearts` and the "Time's up" banner text are removed; `describeRound` drops that case.
- **Pickups** need `pickupClearance` from the inset; a pickup inside the dead zone expires at once (an `pickupExpired` event) so nothing sits in the red.
- **Bots:** their wall look-ahead uses the inset (a `bounds(state)` helper in the sim returns `{left, top, right, bottom}`).
- **Rendering:** the arena border line moves with the inset and glows red; the dead zone is drawn as a translucent red fill over the grid; the HUD clock turns red and pulses from the moment the border starts moving (the existing overtime style). A `borderClosing` event is emitted once per round when it starts, for the sound.

- [ ] **Step 1: Write the failing tests.** `border.test.ts`: the inset is 0 until `roundMaxSeconds − borderCloseSeconds`, then grows at `borderCloseSpeed`, then at `borderCrushSpeed` after the cap; a snake driving straight along the middle of the top wall region loses a heart when the inset reaches it and is deflected inside; both snakes alive at the cap never produce a draw (drive both in tight circles at the center: one dies within 6 s of the cap, wall cause); the inset is in the hash; pickups don't spawn within clearance of the inset and one caught by the border expires. `arena.test.ts`/`step.test.ts`: existing "Time's up" expectations become "the round continues".
- [ ] **Step 2: Implement** the sim, bots and client.
- [ ] **Step 3: Check in the browser** (local play, `pnpm dev:web`): the border starts moving at 30 s of a 45 s round, the clock goes red, the zone fills red, a snake in it takes a wall hit, and a round with two careful players ends within seconds of time-up.
- [ ] **Step 4: Commit** `feat(sim): the closing border; rounds always end in a kill`.

---

### Task 3: The pace defaults, `CLASSIC_CONFIG`, the golden hash

**Files:**
- Modify: `src/sim/config.ts`, `src/sim/determinism.test.ts` (new golden), `src/client/tuning.ts` (a preset row), `docs/superpowers/specs/2026-09-23-snakeboom-v1-design.md` (§6 table and §11 entry), `README.md`

**New defaults** (old in parentheses):

| Setting | New | Old |
|---|---|---|
| `hearts` | 2 | 3 |
| `roundMaxSeconds` | 45 | 90 |
| `borderCloseSeconds` / `borderCloseSpeed` / `borderCrushSpeed` | 15 / 12 / 120 | — |
| `growthPerSecond` / `startLength` | 40 / 120 | 20 / 60 |
| `baseSpeed` / `turnRate` | 280 / 6.3 (same 44-unit turning radius) | 240 / 5.4 |
| `neckLength` | 35 (scales with speed) | 30 |
| `ghostDuration` / `reverseDuration` / `dozerDuration` | 2 / 2 / 3 | 3 / 4 / 5 |
| `effectWarning` | 1 | 3 |
| `pickupInterval` / `maxPickups` / `firstPickupDelay` | 1.5 / 6 / 0.5 | 2.5 / 4 / 1 |
| `pickupWeights` | bomb 40 · shield 15 · ghost 15 · reverse 10 · dozer 20 | bomb 25 · shield 20 · ghost 13 · reverse 12.5 · dozer 35 |
| `overtimeAt` | 9999 (overtime is replaced by the border) | 180 |
| `winsToWin` | 5 | 5 |

`CLASSIC_CONFIG` holds the v0.7.0 values for the five remaining items (Turbo and Slow are gone in both). The tuning panel gets a preset control at the top: **Pace** (defaults) / **Classic**, which calls `resetInPlace` with that config.

- [ ] **Step 1:** Change the defaults, add `CLASSIC_CONFIG` and the preset control, run the determinism test, paste the new golden hash with a comment naming this change.
- [ ] **Step 2:** `pnpm soak --rounds 200` and `pnpm soak --bots hard,normal --rounds 100`; paste the round-length lines here. Target: median 20–35 s, p90 under 50 s, zero time-outs, and the AI still wins some rounds against the simple bot.
- [ ] **Step 3:** Update the spec's §6 table, add the §11 entry, update the README's "How it plays" and items table.
- [ ] **Step 4: Commit** `feat: pace defaults, CLASSIC preset, golden hash`.

---

### Task 4: Verify online, ship v0.12.0, tuning session

- [ ] **Step 1:** `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm netsim --profile hotspot` (unchanged expectations), `pnpm bench:rollback` (faster snakes mean longer trails per second; the 30-tick rollback must stay under 10 ms).
- [ ] **Step 2:** Headless two-window online match with the new defaults at `RELAY_LAG_MS=50`: agreeing hashes through a border-ended round (drive both snakes in circles so time-up happens).
- [ ] **Step 3:** Bump to `0.12.0`, commit, PR to `main`, merge, tag, deploy.
- [ ] **Step 4: The tuning session.** Three first-to-3 matches against the Hard AI locally, then one online with a friend. Questions to answer, in this order: Is anyone bored? Does the border make the last 15 s the best part or a coin flip? Are 2 hearts too few for a new player? Do the shorter effects still read? Then decide on cross-cut scoring (Task 5 below, written only if wanted).

---

### Task 5 (decide after the session): Cross-cut scoring

Crossing directly in front of the opponent's head, within one body width and heading across their path, takes a heart from them (with the usual Shield and grace rules) and gives the crosser 0.5 s of grace against that opponent's body. The near-miss detector already finds the moment; the rule adds a direction test (the crosser's heading within 45–135° of the victim's) and a distance test (the victim's head within `2r` of the crosser's newest trail point, on the victim's forward side). A `crossCut` event drives a slash effect and sound. The AI learns to seek cross-cuts at aggression ≥ 0.6 and to avoid being crossed. Own plan when the time comes.
