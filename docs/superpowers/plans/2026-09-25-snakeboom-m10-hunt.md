# SnakeBoom M10 (Hunt) Implementation Plan

> **For agentic workers:** work task by task on the `hunt` branch, test first, commit after each task. Steps use checkbox (`- [ ]`) syntax for tracking. Interfaces, rules and checks are given; the implementer writes the code.

**Goal:** The v2 core rules (v0.13.0): your own body is safe, encirclement kills, boost burns tail, missiles replace bombs, one life, Reverse gone.

**Spec:** `docs/superpowers/specs/2026-09-25-snakeboom-hunt-design.md`.

## Global Constraints

- The sim stays pure, deterministic and plain-data; every new number is in `Config` and on the tuning panel; the golden hash is updated once per task that changes rules, with a comment.
- **Protocol 5.**
- Removed code is removed, not disabled: bombs, blasts, holes, tile destruction by blasts, chain reactions, the boost meter, the neck rule and Reverse all go, with their tests, sounds, glyphs, panel rows and README rows.
- `pnpm soak` runs after every task; the golden numbers to watch are round length and the death-cause mix.
- Both bots keep working under the new rules at every task (they need not be clever yet; spec section 5 is M11).

## Review Focus

1. **Encirclement is exact and fair.** A head inside the closed loop dies; a head just outside does not; the loop is tested once; Ghost is immune; two snakes closing loops on each other in one tick both die. Task 4.
2. **No self-death of any kind.** After Task 1 the death causes are `wall`, `obstacle`, `body`, `headOn`, `missile`, `encircled`. `self` and `blast` are gone from the type.
3. **Boost can't take you below `minLength`**, and a snake at `minLength` doesn't boost. The HUD's bar matches the trail length. Task 2.
4. **Missiles are deterministic and dodgeable.** The same seed and inputs produce the same missile paths (they use `detmath`); a missile with limited turn rate misses a head that cuts hard enough (a test drives the target through a tight turn). Task 3.
5. **Online agrees.** A two-window match through the relay ends with agreeing hashes after encirclements and missile kills. Task 5.

---

### Task 1: Remove Reverse, remove self-collision, one life

**Files:** the same set as M9 Task 1 for Reverse (`config`, `types`, `items`, `snake` (reverse input swap), bots, `colors`, `glyphs`, `text`, `hud`, `tuning`, `audio`, `events`, `render/pickups`, `render/snakes` (the swirl), `style.css`, tests, README). Self-collision: `src/sim/collision.ts` (drop the `self` branch and `neckLength`), `src/sim/config.ts` (`neckLength` gone, `hearts: 1`), `src/sim/types.ts` (`DeathCause` without `self`), `src/client/text.ts` (`describeDeath`), tests (`collision`, `snake`, `effects`, `hearts` cases), the v1 spec's neck paragraph gets a note pointing at the hunt spec.

- [ ] **Step 1:** Remove Reverse everywhere (including the bots' reverse-lag logic and `OpponentProfile.reverseLag`).
- [ ] **Step 2:** Remove the self branch and `neckLength`; delete the neck-safety tests; a snake driving a tight circle for 10 s never dies (new test).
- [ ] **Step 3:** `hearts: 1` by default; the HUD still draws N hearts; `CLASSIC_CONFIG` keeps 3.
- [ ] **Step 4:** Golden hash, `pnpm soak`, commit `feat(sim): no self-collision, one life, Reverse gone`.

---

### Task 2: Boost burns tail

**Files:** `src/sim/config.ts` (`boostBurnPerSecond`, `minLength`; drop `boostMeterSeconds`, `boostRefillSeconds`), `src/sim/types.ts` (drop `boostMeter`), `src/sim/snake.ts`, `src/sim/invariants.ts`, `src/sim/bots/*` (boost decisions read length, not the meter), `src/client/hud.ts` (length bar), `src/client/tuning.ts`, `src/client/render/snakes.ts` (unchanged), tests (`snake.test`, `hearts`/`effects` where the meter appears, `hud.test`).

**Rule:** while `input.boost` and `trailLength(trail) > minLength`: `boosting = true`, speed doubles, and `targetLength -= boostBurnPerSecond × DT` (floored at `minLength`). Otherwise `boosting = false`. Growth still adds `growthPerSecond × DT` every tick before the burn, so boosting at the default numbers nets −20 units/s.

**HUD:** the bar shows `trailLength / 1200`, clamped, dim below `minLength`.

- [ ] **Step 1:** Failing tests: boosting shrinks the target length at the configured rate; boosting stops at `minLength`; a snake at `minLength` with Boost held moves at base speed; invariants: no `boostMeter`.
- [ ] **Step 2:** Implement, including the bots (`simple-bot` boosts when the line is clear and length > 200; `opponent.wantBoost` requires length > 200).
- [ ] **Step 3:** Golden hash, soak, commit `feat(sim): boost burns tail; no meter`.

---

### Task 3: Missiles replace bombs

**Files:**
- Delete: `src/sim/bombs.ts`, its tests (`step-boom.test.ts`, bomb parts of `items.test.ts`, `pickups.test.ts`, `dozer.test.ts` where blasts appear), `src/client/render/bombs.ts`
- Create: `src/sim/missiles.ts`, `src/sim/missiles.test.ts`, `src/client/render/missiles.ts`
- Modify: `src/sim/config.ts`, `src/sim/types.ts` (`MissileState`, `state.missiles`, events, `DeathCause` gains `missile` and loses `blast`), `src/sim/items.ts` (`fireMissile`), `src/sim/step.ts` (tick order: missiles move and resolve after snakes move, before collisions), `src/sim/trail.ts` (holes stay as a field but nothing sets them; remove the hole helpers), `src/sim/arena.ts` (blast tile destruction gone), `src/sim/shield.ts` (`missile` absorbed like `blast` was), bots (`wantUse` for missiles: fire when the opponent is roughly ahead within 500 units), `src/client/*` (glyph, colour, sounds: `missileFire`, `missileHit`, `missileFizzle`; fx: a small hit burst; HUD label `MISSILE ×3`; Powers page; tuning rows), README.

**`MissileState`:** `{ id, owner, x, y, heading, ttl }`. **Per tick:** for each missile: target = nearest living opponent head (not the owner); if any, turn heading toward it by at most `missileTurnRate × DT` (using `detAtan2` and `wrapAngle`); move `missileSpeed × DT`; `ttl--`. Then resolve: a missile whose center is within `missileRadius + r` of a non-owner live head hits it (`hits` list, cause `missile`, killer owner); a missile that crosses the live border or a solid tile, or whose `ttl` reaches 0, dies with a `missileFizzled` event. Hits are resolved with the usual Shield/heart/death path (Shield absorbs without deflection). Events: `missileFired {id, player, x, y, heading}`, `missileHit {id, player, x, y}`, `missileFizzled {id, x, y}`.

- [ ] **Step 1:** Failing tests: a fired missile spawns at the head with the owner's heading; it curves toward the opponent and hits a straight-flying head within 1.5 s; a target that turns at full rate from 200 units away is missed and the missile fizzles at `missileLife`; a Shield absorbs it; the owner is never hit (fire at a wall and turn into the missile's path); it dies on a block and on the border; determinism (same inputs, same path).
- [ ] **Step 2:** Remove bombs and everything downstream, implement missiles and the client pieces.
- [ ] **Step 3:** Golden hash, soak (expect `missile` deaths), commit `feat(sim): missiles replace bombs`.

---

### Task 4: Encirclement

**Files:**
- Create: `src/sim/encircle.ts`, `src/sim/encircle.test.ts`, `src/sim/geometry.ts` (`pointInPolygon`, tested)
- Modify: `src/sim/types.ts` (`SnakeState.crossing`, cause `encircled`, event `encircled {player, by, loop: number[]}`), `src/sim/step.ts` (after movement, before collisions), `src/sim/shield.ts` (encircled: push to the nearest loop edge + grace), `src/sim/config.ts` (`loopIgnore`), `src/client/render/fx.ts` (`loopSnap(points, color)`), `src/client/events.ts`, `src/client/audio.ts` (`snap`), `src/client/text.ts` ("CYAN encircled PINK"), tuning.

**Algorithm (spec section 2):** after all snakes have moved, for each live snake `i`: query its own trail points within `2r` of its head with `cum < headCum − loopIgnore`; pick the oldest (smallest index) such point `p`. `touching = p exists`. If `touching && !crossing`: polygon = trail points `p … head`; for each other live snake `j` (not ghost): if `pointInPolygon(head_j, polygon)`, push a hit `{player: j, cause: 'encircled', killer: i}` and an `encircled` event carrying the polygon (decimated to at most 64 points for the client). Set `crossing = touching`. Hits go into the same list as collisions this tick, before `detectHit`, so a snake can't be hit twice.

- [ ] **Step 1:** Failing tests: `pointInPolygon` on a square (inside, outside, on-edge), a concave shape and a self-touching loop; a scripted snake that drives a full circle around a parked opponent kills it with cause `encircled` and one `encircled` event; the same loop with the opponent 20 units outside does nothing; the same loop with a Ghost opponent does nothing; skimming along your own body for 60 ticks produces no repeat event; two snakes closing loops around each other on the same tick both die; a Shield pops instead.
- [ ] **Step 2:** Implement the sim and the client effect (the loop polygon drawn in the looper's colour, shrinking onto the victim over the death beat).
- [ ] **Step 3:** Golden hash, soak (expect some `encircled` deaths from the simple bots' wandering), commit `feat(sim): encirclement kills`.

---

### Task 5: Defaults, docs, verify, ship v0.13.0

- [ ] **Step 1:** Pickup weights `missile 45 · ghost 20 · shield 20 · dozer 15`; `CLASSIC_CONFIG` reviewed (it keeps 3 hearts and the slow pace; it can't keep bombs or self-collision); the v1 spec's sections 3.2–3.6 get a banner pointing at the hunt spec; README "How it plays" and the items table rewritten; Powers page copy.
- [ ] **Step 2:** `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm soak --rounds 200`, `pnpm soak --bots hard,normal --rounds 60`, `pnpm netsim --profile hotspot`, `pnpm bench:rollback`.
- [ ] **Step 3:** Headless checks: a local match where a scripted loop kills the AI (drive a circle around it from the tuning-panel start positions is unreliable, so drive against the wall-hugging simple bot in a soak-style script instead: assert one `encircled` death in 20 rounds); a missile kill on screen (screenshot); an online match through the relay with agreeing hashes.
- [ ] **Step 4:** Bump `0.13.0`, PR, merge, tag, deploy. Then the playtest: does a kill feel like something you did?
