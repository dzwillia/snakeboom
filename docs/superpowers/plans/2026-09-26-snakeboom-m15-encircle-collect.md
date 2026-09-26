# SnakeBoom M15: loop a pickup to take it

**Goal:** a pickup is collected by drawing a loop around it, not by running over it (issue #27). Collecting becomes a skill, rewards a longer body, and gives the opponent a moment to interrupt. The AI learns to draw the loop. Requested 2026-09-26 after the v0.14/v0.15 playtests.

## Decisions

- **The rule.** A pickup is collected on the tick a head crosses its own trail, if the loop it just closed contains the pickup's centre: the same polygon, the same tick and the same `pointInPolygon` test as encirclement, so the `loopIgnore` neck rule and the "a loop spanning a wormhole jump doesn't count" rule apply unchanged. Running over a pickup does nothing: the head passes through and the pickup stays.
- **Several at once.** Every pickup inside the loop is taken, in ascending id order (spawn order), each subject to `canCarry`: a Shield needs no bubble already, anything else needs a free item slot. Ones that don't fit stay on the field. When two heads close loops around the same pickup on the same tick, the lower seat takes it (the seats are tested in order; a pickup already taken is gone).
- **Where it lives.** `detectEncirclements` builds the polygon once and calls `collectInLoop(state, cfg, seat, poly, events)` from `pickups.ts`, so the shape can never drift from the kill test. `collectPickups` (the run-over rule) stays, and `step` calls it only when `collectByLoop` is false.
- **Events.** `pickupCollected` keeps its shape and gains the pickup's `x, y`, so the burst plays where the pickup was (it is gone from the state by the time the client sees the event). A loop that collected at least one pickup also emits `loopCollected { player, loop, ids }`, the loop thinned with `decimatePolygon` like the `encircled` event, so the client can flash it.
- **Config.** `collectByLoop: boolean` (default true; a "loop a pickup to take it" toggle in the tuning panel's Loops folder) restores run-over for comparison. `pickupClearance` goes from 40 to 60: a full-rate turning circle has radius `baseSpeed / turnRate` ≈ 44, so a loop drawn around a pickup passes about 44 from it; 60 leaves the body (radius 8) 8 units clear of a block when the loop is centred well, and a player who isn't centred has the whole circle's tolerance. 80 would be safer still but starves Lanes and Bunkers of spawns (50 tries per spawn).
- **AI.** Loops are found by simulation, not scripted:
  - Rollouts now watch for the planned path closing a loop, exactly as the sim would: the head coming within `2r` of a point of its own trail (the real one, or the path just planned) older than the `loopIgnore` neck, with the sim's `crossing` latch so a head already skimming its trail doesn't "close" a loop every step. When a loop closes, the polygon (trail from the crossed point, plus the planned path) is tested against every pickup the bot can carry that will still exist and whose crossed point will still be in the body (the perimeter must fit `targetLength`). A rollout reports how many it would take and at which step.
  - `pickGoal` still picks the nearest useful pickup, but steers at an **approach point**: the tangent point from the head to the circle of radius `R = baseSpeed / turnRate` around the pickup, on whichever side needs the smaller heading change. Arriving there tangentially and holding a full-rate turn draws a circle centred on the pickup. Within 1.2 R of the pickup the goal is the pickup itself (the loop is under way, and rollouts decide the rest). Pickups are only sought when the body is (or will be, by arrival) long enough for the circle plus the neck.
  - The plan set gains **loop plans** whenever a pickup goal is in force: a lead turn (−1, 0, +1) held for the usual 5 steps or not at all, then a full-rate turn either way held *until the loop closes* (a new hold sentinel; capped at a circle and a half), then straight to the horizon, so the end of the plan is scored on where the head goes after the loop, not on the middle of a circle. Loop plans that capture nothing are dropped without the territory BFS, so they cost little.
  - Any plan that captures scores `LOOP_W × greed` per pickup, plus a bonus for closing sooner, on top of the usual survival, space and territory terms; a capture is worth more than the space or territory difference between two open lines, and less than dying. Boost is never used on a capturing plan (it burns the body the loop needs and doubles the turning circle).
  - Easy's look-ahead rises from 16 to 22 steps (0.8 s → 1.1 s) so a full circle (20 steps) fits inside it; otherwise it could never see a loop close.
  - The simple soak bot stays dumb: it still steers at pickups and just stops collecting them.
- **Client.** The pickup burst plays at the pickup; the collected loop flashes in the collector's colour with `loopSnap` at half strength (thinner, dimmer, a smaller jolt). Powers page lead: "LOOP A PICKUP TO TAKE IT". README "How it plays" and the Hard row of the AI table say so too.

## Tasks

### Task 1: The sim
- `collectByLoop`, `pickupClearance` 60, `collectInLoop`, the `encircle.ts` hook, `pickupCollected` x/y, `loopCollected`, step gate; tests (one, several, order, slots, Shield, run-over does nothing, wormhole-jump loop, `collectByLoop: false`); golden hash.
- [x] Commit `feat(sim): loop a pickup to take it`.

### Task 2: The AI
- Loop detection in rollouts, the tangent approach goal, loop plans, capture scoring, no boost while looping, easy's horizon; a test that hard collects within a few seconds on the open map; the duel tests.
- [x] Commit `feat(ai): the opponent draws a loop around the pickup it wants`.

### Task 3: The client and the copy
- Burst at the pickup, the loop flash, the tuning row, Powers page, README, the hunt spec addendum.
- [x] Commit `feat(client): the collected loop flashes; loop it to take it`.

### Task 4: Verify and ship
- `pnpm test`, typecheck, build, `pnpm soak --rounds 100`, `pnpm netsim`, headless browser check; PR (no merge, tag or deploy).
