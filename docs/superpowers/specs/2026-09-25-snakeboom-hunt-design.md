# SnakeBoom Hunt: Rules Spec (v2 core)

- **Date:** 2026-09-25
- **Status:** Decided in conversation; replaces the rules in sections 3.2–3.6 of the v1 spec. Everything else (arena, maps, rounds, online) stands.
- **Why:** after v0.12.0 the developer's verdict was "still not interesting". The only way to beat someone was to wait for them to crash: nothing a player did to the other player was direct. The redesign makes the body a weapon you aim and gives every kill an author.

## 1. The rules

1. **Your own body never hurts you.** You can cross, weave and double back through your own trail freely. There is no neck rule and no self-collision.
2. **Encirclement kills.** When your head crosses your own trail, the loop you just closed is tested. If the opponent's head is inside it, they die: "CYAN encircled PINK". A Ghost is never encircled (they phase through the loop), a Shield takes the hit and pops, and a head in grace is safe. The loop is tested once, on the tick it closes. Nothing else happens to a loop: it stays as body.
3. **The opponent's body still kills** on contact, as does the wall and the closing border. **Head-on** kills both.
4. **One life.** `hearts` defaults to 1: any hit kills unless a Shield takes it. (The hearts mechanism stays tunable.)
5. **Boost burns tail.** There is no boost meter. Holding Boost doubles your speed and shrinks your body at `boostBurnPerSecond`; you can boost as long as your body is longer than `minLength`. Growth stays on a timer, so length is a resource you spend on chasing and earn back by surviving.
6. **Missiles replace bombs.** A missile pickup holds 3. Use fires one from your head along your heading; it flies at `missileSpeed`, turns toward the nearest living opponent's head at up to `missileTurnRate`, and dies after `missileLife` seconds or on hitting a wall, a block or its target. Hitting a head kills that snake (Shield absorbs it, Ghost does not dodge it, grace ignores it). Missiles never hit their owner and never hit bodies. There are no blasts, no holes and no chain reactions any more.
7. **Scissors** (added the same day): a 3 s timed special. While it runs, your head crossing an opponent's body cuts it: everything from the newest touched point back to their tail is dropped, their target length becomes what is left, and you pass through instead of dying. The head itself can't be cut (touching it is a head-on), walls, missiles and loops still kill you, a Ghost's body is still cut, and a Shield doesn't stop it (nothing hit the head). A `cut` event carries the dropped path for the effect. Shorter snakes have less boost fuel and less body to loop with.
8. **Ghost, Shield and Bulldozer stay** as they are. Ghost is the answer to a closing loop and to a missile you can't outrun; Shield is one free hit; Bulldozer shoves blocks on block maps. **Reverse, Turbo, Slow and Bomb are gone.**
9. **The closing border, 45 s rounds, first-to-N, maps, rematches and the online rules are unchanged.**

## 2. Encirclement, precisely

- Each tick, after movement, for each live snake: find the oldest solid point of its own trail within `2r` of its head, ignoring the newest `loopIgnore` (= 3r) units of path so the head's own recent segment doesn't count. If there is one and the head was not touching its trail on the previous tick (`state.snakes[i].crossing` false), a loop closed this tick.
- The loop polygon is the trail from that point to the head (every point, holes included, since there are no holes now).
- Every other live snake whose head is inside the polygon (ray casting, ties resolved as inside) and is not a Ghost is hit with cause `encircled`, killer the looper. Shield and hearts apply as for any hit; the deflection is a push to the nearest polygon edge plus grace.
- `crossing` is set true while the head touches the trail and cleared when it doesn't, so a head skimming along its own body doesn't re-close the loop every tick.
- Two snakes can encircle each other in the same tick; both hits are resolved together like head-on deaths.
- Loops smaller than the head can't contain anything, so there is no minimum size rule.

## 3. Defaults (new and changed)

| Setting | Default |
|---|---|
| `hearts` | 1 |
| `boostBurnPerSecond` · `minLength` | 60 units/s · 60 units |
| `missileCharges` · `missileCooldown` | 3 · 0.4 s |
| `missileSpeed` · `missileTurnRate` · `missileLife` · `missileRadius` | 420 units/s · 3.5 rad/s · 2.5 s · 10 |
| `loopIgnore` | 3r = 24 units |
| `pickupWeights` | missile 35 · scissors 20 · ghost 15 · shield 15 · dozer 15 |
| `scissorsDuration` | 3 s |
| removed | `neckLength`, `boostMeterSeconds`, `boostRefillSeconds`, everything `bomb*`, `blastRadius`, `chainDelay`, `reverseDuration` |

The pace defaults from M9 (speed 280, growth 40, 45 s rounds, the border) stay.

## 3a. M12 addendum: the big map (2026-09-25)

Shipped as v0.14.0 after this spec. See the M12 plan for the reasoning; the rules as built:

- **Arena** 3200×2000 (`MAP_CELL` 80: the 40×25 map sources are unchanged, every block is 80 units). Tiles stay 20 units. Local play fits every live head in view (zoom 1 = the whole arena, 2 = the old apparent size); online the camera follows your own head at zoom 2. A 200 px minimap sits bottom-right.
- **Tuning that scales:** `borderCloseSpeed` 24 (was 12), `borderCrushSpeed` stays 120 (240 made the endgame a coin flip: hard AI fell to parity with normal), `maxPickups` 12, `pickupInterval` 1 s, `pickupMinHeadDistance` 300.
- **Wormhole** (`wormholeInterval` 12 s, `wormholeLifetime` 10 s, `wormholeRadius` 30, `wormholeMinJump` 800, `portalCooldown` 1 s): one at a time; a head within radius + r + 2 of the portal appears at the exit with its heading. The trail gets a **jump point**: zero path length, not solid, not drawn. Nothing can collide with, cut or draw the chord; a loop whose polygon would include a jump is not a loop. The border swallowing either end closes it. Missiles ignore it. Pickups keep clear of both ends. The AI treats it as floor and replans after a jump.
- **Saw** (`sawInterval` 15 s, `sawLifetime` 12 s, `sawRadius` 34, `sawSpeed` 180, `sawMinHeadDistance` 400): one at a time; spawned at a clear spot with a seeded random heading; moves one axis at a time and flips that axis's velocity when the live border or a block is in the way (deterministic, no trig after spawn). A head within radius + r + 2 dies with cause `saw` (priority after `encircled`, before `headOn`); a Shield or spare heart pushes the head clear of the disc and grants grace; grace ignores it; Ghost does not. Any solid body point within reach is cut through the shared `cutTrail`, with a `cut` event whose `by` is -1. The border swallowing it removes it. In rollouts the AI predicts it as a straight line bouncing off the border for 0.8 s only.
- **Events:** `wormholeOpened` / `wormholeClosed` / `warped`, `sawSpawned` / `sawGone`. All cosmetic for the net gate (played once, predicted).
- **Classic preset:** both hazards off (`wormholeInterval` 0, `sawInterval` 0).

## 3b. M13 addendum: the flamethrower and the head countdown (2026-09-26)

Shipped as v0.15.0. See the M13 plan.

- **Flamethrower** (`flameDuration` 2.5 s, `flameRange` 150, `flameSpread` 0.5 rad): a timed special; while it burns, the cone ahead of the head (within range + r and spread of the heading, tested with `detAtan2`/`wrapAngle`) cuts the opponent's body at the newest burning point via the shared `cutTrail` (the `cut` event's `by` is the flamer), marks the opponent's head for a hit with cause `flame` (after `saw`, before `headOn`; a Shield or spare heart takes it with no push, like a missile; grace ignores it; Ghost does not protect), and burns up the opponent's missiles (`missileFizzled`). Own body and own missiles are never touched; blocks, pickups, saws and wormholes are ignored (no line of sight). Runs after the saw cuts, before missiles resolve.
- **Mix:** missile 30 · scissors 15 · flame 15 · ghost 15 · shield 15 · dozer 10. Classic: flame 0.
- **Head countdown:** for every running timed special (Bulldozer, Scissors, Flame, Ghost) the client draws a ring around the head in the special's colour, emptying clockwise from the top in proportion to ticks left over the special's configured duration, and the seconds left (one decimal) above the head. Ring radius 22 px, 3 px wide, stacked 8 px apart, sized in screen pixels via the world scale. Several specials: the label follows the one ending soonest. The HUD chips and the last-second blink stay.
- **AI:** lights the flame when the opponent is within 1.3× range and at least 0.6 ahead (cosine), with a chance scaled by `itemSkill`; treats the opponent's cone (from their predicted position, at their current heading, while their timer runs) as a rollout hazard.

## 4. Feel

- **Encirclement:** the loop flashes in the looper's colour and shrinks onto the victim over the death beat, with a "snap" sound. The banner reads "CYAN ENCIRCLED PINK".
- **Missile:** a bright dart with a short exhaust trail in the owner's colour, a rising whine while it flies, a pop when it hits or dies. Both players see it homing, so a dodge is a read.
- **Boost:** sparks as now, plus the tail visibly retreating. The HUD's boost meter becomes a length bar (0–1200 units) that dips while boosting; below `minLength` it turns dim and Boost does nothing.
- **Own trail:** unchanged look; crossing it produces no effect unless a loop catches someone.

## 5. What the AI must learn (M11, not this milestone)

- Avoid being inside a loop that is about to close (the enemy head approaching its own trail with me inside).
- Try loops when the opponent is slow, cornered, or against the border.
- Dodge missiles (they are moving obstacles in the rollout) and fire them when the opponent is committed to a line.

Until then, the AI plays the new rules without these skills: it avoids bodies and walls, uses Ghost when boxed in, and fires missiles on the old bomb logic.
