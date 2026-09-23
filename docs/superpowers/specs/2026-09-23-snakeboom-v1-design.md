# SnakeBoom v1: Design Spec

- **Date:** 2026-09-23
- **Status:** Design approved in conversation; this written spec is awaiting review
- **Scope:** Local prototype with two players on one keyboard. Online play gets its own spec later.

## 1. Goal

Build a local prototype of SnakeBoom, with two players sharing one keyboard, to find out whether the core duel is fun. The test is simple: do the players keep hitting Space for a rematch?

The long-term goal is a hosted web game with 1v1 duels started from invite links, plus quick-match. v1 is written so that its rules engine can run on a server later without a rewrite.

### Success criteria

1. A full first-to-5 match can be played on one keyboard without crashes or visual glitches.
2. The automated soak test (section 7) shows rounds finishing inside the 1–3 minute target. Bots only approximate human play, so human playtests confirm the pacing.
3. The game runs at the display's refresh rate on the developer's Mac. That includes very long snakes in late overtime and large chain reactions.
4. The rules engine (`src/sim`) runs in Node with no browser APIs. The test suite and soak script prove this.
5. Players ask for "one more match."

### Non-goals for v1

- Online play.
- Computer opponents for players. Bots exist only for automated testing.
- Touch, mobile and gamepad support.
- Music.
- Accounts, progression, skins and leaderboards.
- An in-game map editor.
- More than two players in the UI. The engine loops over N snakes, but the rules and tuning target 2.

## 2. Decisions log (from the 24-question interview)

| # | Topic | Decision |
|---|---|---|
| 1 | Movement | Smooth 360° steering |
| 2 | Length | Grows steadily over time; there is no food |
| 3 | Arena objects | Bombs dropped by players, static obstacles, power-up pickups |
| 4 | First playtest | Two people on one keyboard |
| 5 | Bomb supply | Only from pickups |
| 6 | Bomb type | Timed bomb |
| 7 | What blasts destroy | Heads, body segments, obstacles, other bombs (chain reactions) |
| 8 | Self-damage | Your own bomb can kill you |
| 9 | Arena edge | Deadly walls |
| 10 | Hitting your own body | Deadly |
| 11 | Head-on collision | Both snakes die and the round is a draw |
| 12 | Match | First to 5 round wins |
| 13 | Round length | 1–3 minutes |
| 14 | Boost | Recharging meter |
| 15 | Power-ups | Ghost, Shield, Turbo and Slow ("speed/slow" split in two), Reverse |
| 16 | Obstacle layout | Hand-made maps that rotate each round |
| 17 | Controls | Keyboard: turn left/right, plus boost and use keys |
| 18 | "Local executable" | A local web page |
| 19 | Language | TypeScript, for the client and the future server |
| 20 | Online (later) | 1v1 duels with invite links, plus quick-match |
| 21 | Visual style | Neon glow |
| 22 | Effects and sound | Lots of both, from day one |
| 23 | Plan scope | Local prototype first; online play is a separate spec |
| 24 | Workflow | Autonomous work on a feature branch, stopping at each playable milestone |

## 3. Gameplay

### 3.1 Arena and coordinates

- The world is 1600×1000 units, scaled to fit the window with letterboxing.
- `x` points right and `y` points down. A heading of 0 means east, positive angles turn clockwise, and "turn right" increases the heading.
- The arena border is a deadly wall.
- Obstacles sit on a grid of 20-unit tiles (80×50). Each tile is either solid or empty, and blasts remove solid tiles.

### 3.2 Snakes

- **Body:** a snake is a head (a circle of radius `r` = 7) plus a **trail**, which is the ordered list of points the head has passed through, one per tick. Trail points stay fixed in the world. The snake moves by adding a point at the head and dropping points from the tail.
- **Growth:** the target length grows every tick at `growthPerSecond`, measured from GO. After `overtimeAt`, the rate is multiplied by `overtimeGrowthMultiplier`. Tail points are trimmed so that the trail's path length never exceeds the target.
- **Steering:** the turn input is −1, 0 or +1. Holding both turn keys counts as 0. Each tick the heading rotates by `turnRate × dt`. The turn rate never changes, so faster snakes make wider turns.
- **Speed:** `baseSpeed × (boosting ? boostMultiplier : 1) × (slowed ? slowFactor : 1)`.
- **Boost meter:** the meter runs from 0 to 1. The snake is boosting while the boost key is held and the meter is above 0, and the meter drains at `1 / boostMeterSeconds` per second. It refills at `1 / boostRefillSeconds` per second, but only while the key is released. Turbo stops the drain.
- **Spawning:** each map sets a spawn cell and heading for each player. A snake starts as a lone head, and its body grows out behind it as it moves.
- **Reset:** everything round-specific resets at the start of each round: length, trail, meter, items, effects, bombs, pickups, and the map's tiles.

### 3.3 Death

A head dies if any of the following is true at the end of a tick:

- **Wall:** the head circle crosses the arena border.
- **Obstacle:** the head circle overlaps a solid tile. Ghost prevents this.
- **Body:** the head is within `2r` of a solid trail point of another snake. Ghost prevents this.
- **Self:** the head is within `2r` of a solid point on its own trail, not counting the newest `neckLength` units of path. Ghost prevents this.
- **Head-on:** the head is within `2r` of another head, and neither snake is a ghost. Both snakes die.
- **Blast:** the head is caught in an explosion (section 3.6). Ghost does not prevent this.

A Shield absorbs any one of these deaths (section 3.5).

If several causes apply in the same tick, the reported cause is the first one in this order: `blast` (resolved first, in tick step 6), then `headOn`, then `body` / `self`, then `obstacle`, then `wall`.

**Resolving the round:** every head is checked before anything is resolved. If exactly one snake is alive afterward, it wins the round. If no snake is alive, the round is a draw.

**Death events** record a cause (`wall`, `obstacle`, `body`, `self`, `headOn` or `blast`) and a killer, where there is one: the owner of the body that was hit, or the owner of the bomb. The round banner uses these, for example "PINK hit CYAN's body" or "CYAN blew themselves up."

**The neck is safe.** At minimum turning radius (`baseSpeed / turnRate` = 50 units, or 30 while slowed), the trail point `neckLength` = 24 units back is about 23 units from the head. That is safely more than `2r` = 14, so a snake can never clip its own neck. It can still circle into its own tail once it is long enough, which is intended.

### 3.4 Pickups

Pickups are the only source of bombs and power-ups.

- **Spawning:** the first pickup appears `firstPickupDelay` after GO. After that, every `pickupInterval` seconds a new pickup spawns if fewer than `maxPickups` are on the field.
- **Placement:** the spawn point comes from the seeded random generator. It must be at least `pickupClearance` from walls, solid tiles, solid trail points and bombs, and at least `pickupMinHeadDistance` from every head. The game tries up to 50 random points. If none fit, it skips that spawn.
- **Kind:** chosen by weight. The defaults are Bomb 25 and 15 each for the other five kinds.
- **Lifetime:** `pickupLifetime`. The pickup blinks for its last 3 seconds (a client-side effect) and then disappears. This stops pickups that get walled in from blocking new spawns.
- **Collecting:** a head collects a pickup on contact (`distance < r + pickupRadius`) if it has room: a free item slot, or, for a Shield, no bubble already. Bodies never collect pickups. When both heads reach the same pickup, the closer one gets it.

### 3.5 Items

Each player carries up to `itemSlots` (3) items in a queue, oldest first, and both queues are shown on the HUD. The Use key fires the item at the front of the queue, once per press. A bomb pickup stays at the front until its last bomb is thrown. A Shield never takes a slot: it becomes a bubble around your head instead, one at a time.

| Item | What Use does | Details |
|---|---|---|
| **Bomb ×3** | Throws a bomb ahead of your opponent | It arcs through the air for `bombFlightTime` and lands where they'll be if they hold course, then blasts `bombFuse` later. A reticle marks the blast zone from the moment it's thrown. The slot empties after the third bomb, and throws must be at least `bombThrowCooldown` apart. |
| **Ghost** | For `ghostDuration`, your **head** passes through bodies, other heads and obstacles | Walls and blasts still kill. Your body stays solid to your opponent. The head flickers for the final `ghostWarning`. If the head is inside something when Ghost ends, it dies. |
| **Shield** | (never in the queue) | Picking it up puts a bubble on you straight away. The bubble absorbs your next death of any kind, then pops. You can only have one at a time; while you have one, Shield pickups stay on the field. |
| **Turbo** | For `turboDuration`, boosting doesn't drain the meter | You still hold the boost key to go fast. |
| **Slow** | For `slowDuration`, every opponent moves at `slowFactor` speed | Using it again restarts the timer. |
| **Reverse** | For `reverseDuration`, every opponent's left and right are swapped | The sim applies the swap to inputs, so a future server does it too. |
| **Bulldozer** | For `dozerDuration`, a plow on your head shoves blocks | Blocks the plow touches move one tile ahead along your heading's main axis, pushing rows of up to 4 blocks. A block that can't move (a longer row, or one at the arena edge) is crushed. While plowing, blocks can't hurt you, but bodies, heads and walls still can. Shoving a block into your opponent's head kills them. It never spawns on maps without blocks. |

**How a Shield deflects:**

- **Wall:** the head is clamped inside the arena, and its heading is set parallel to the wall, in whichever direction is closer to the old heading.
- **Body, obstacle, head-on, or ending a Ghost inside something:** the game finds the contact normal, which points from the nearest contact point (on a trail point, tile or head) to the head's center. The head is pushed out along the normal until it is clear. Its heading is set along the surface, perpendicular to the normal, in whichever direction is closer to the old heading.
- **Blast:** the Shield absorbs it without changing direction.
- **Afterward:** the snake gets `shieldGrace` seconds of invulnerability to everything except walls. A `shieldBlocked` event is sent.
- **Head-on with Shields:** if both snakes have a Shield, both deflect. If only one does, it deflects and the other snake dies.

### 3.6 Bombs and blasts

- A bomb is **thrown**. It lands ahead of the nearest living opponent, at the spot they'd reach in `(bombFlightTime + bombFuse) × bombLeadFactor` seconds at their current speed and heading (kept inside the arena). It flies for `bombFlightTime`, lands, and then burns a fuse of `bombFuse`. Bombs are not solid, so snakes pass over them. Bombs still in the air can't be set off by other blasts.
- When a fuse reaches 0, the bomb explodes with radius `R` (`blastRadius`). Four things happen:
  1. **Heads:** any head within `R + r` of the center dies, including the owner's. A Shield or shield grace absorbs the hit.
  2. **Bodies:** every trail point within `R + r` becomes a **hole**. Holes aren't solid and aren't drawn, so the blast circle cuts the tube cleanly. A hole stays where it is until that snake's tail passes over it.
  3. **Obstacles:** every solid tile that intersects the blast circle is destroyed.
  4. **Other bombs:** any other bomb within `R` whose remaining fuse is longer than `chainDelay` has its fuse cut to `chainDelay`. Chains ripple outward, and each explosion records its chain depth for the visual effects.
- Explosions that happen in the same tick resolve in bomb-id order.
- A thrown bomb still catches the thrower (and holes their body) if they're near the landing spot when it blasts.

### 3.7 Rounds and matches

- **Phases:** `countdown` (`countdownSeconds`: the snakes are shown frozen at their spawns) → `playing` → `roundOver` (`roundOverSeconds`: gameplay is frozen and the banner shows) → the next `countdown`, or `matchOver`.
- **Scoring:** winning a round scores 1 and a draw scores nothing. The first player to reach `winsToWin` wins the match. `winsToWin` defaults to 5 and can be set from 1 to 10.
- **Overtime:** it starts after `overtimeAt` seconds of round time. Growth is multiplied as described in section 3.2, the HUD clock turns red, and an `overtime` event is sent.
- **Safety net:** if a round reaches `roundMaxSeconds`, it ends in a draw. This should never happen in real play.
- **Map rotation:** round 1 is always on "Open". Later rounds draw maps from a shuffle of all five, seeded by the match, and never use the same map twice in a row.
- **Match over:** the winner is shown. Space starts a rematch (scores reset, new seed), and Esc goes back to the title screen.

### 3.8 Maps

- There are five hand-made maps, each with 180° rotational symmetry so the spawns are fair: **Open**, **Pillars**, **Cross**, **Bunkers**, and **Lanes**.
- Maps are ASCII art stored in TypeScript files (`src/sim/maps/*.ts`), so they load the same way in the browser, in tests and on a future server without any file loader.
- The grid is 40 columns × 25 rows. Each character is a 40×40 cell, which is 2×2 destructible tiles.
  - `.` is empty, `#` is solid, and `1` / `2` mark the spawn cells for players 1 and 2.
  - The metadata is `name` and `spawnHeadings: [p1Degrees, p2Degrees]`.
- Tests check each map for the right size, exactly one spawn per player, spawns that aren't boxed in, and 180° symmetry.

## 4. Feel and presentation

### 4.1 Visual style: neon

| Element | Color |
|---|---|
| Player 1, called "CYAN" | `#22f3ff` |
| Player 2, called "PINK" | `#ff2e97` |
| Obstacle blocks | amber `#ffb020` outline over a dark fill |
| Arena background | near-black `#05060d`, with a faint grid every 40 units and a vignette |
| Arena border | a thin, glowing blue-white line |
| Bomb | red `#ff3030` with a white-hot core |
| Pickups | Bomb `#ff4d2e` · Ghost `#e8f4ff` · Shield `#3dff7a` · Turbo `#ffe14d` · Slow `#4d7cff` · Reverse `#b44dff` |

- **Snakes** look like neon tubes: an outer stroke in the player's color (width `2r`) around a bright inner core about 35% as wide, with round joins and caps. The body is split into separate strokes wherever there are holes. The head is a little brighter and has a small white "eye" dot pointing along its heading.
- **Glow** comes from `AdvancedBloomFilter` (pixi-filters) applied to the world layer. Its strength and threshold can be tuned, and it can be turned off if performance suffers.
- **Status visuals:**
  - Shield held: a ring around the head.
  - Ghost: the head goes translucent white with an afterimage, and it flickers during the warning window.
  - Slowed: a blue tint with dragging particles.
  - Reversed: a violet swirl above the head.
  - Turbo: a brighter core with speed streaks.
  - Boosting: sparks fly off the trail.
- **Pickups** are rounded neon tiles showing a symbol. They bob and pulse, and they blink before they disappear.
- **Bombs** have a red core, a fuse ring that shrinks, and a blink that speeds up as the fuse runs down.

### 4.2 Effects

Effects run only in the client. The sim reports events, and the client reacts to them.

- **Explosion:** an additive flash, an expanding shockwave ring, 40–80 sparks, debris from destroyed tiles, and screen shake. Shake adds up across a chain reaction, with a cap. Each chained blast plays at a slightly higher pitch.
- **Death:** a hit-stop of about 120 ms (freeze plus a white flash). Then the dead snake's body shatters into particles along its whole length while effects play at 0.3× speed for about 0.8 s, with a small camera punch-in. The round banner follows.
  - Gameplay itself is frozen during `roundOver`. The slow motion applies only to effects and the camera, which is how the "beat of slow-mo" from the design discussion is delivered.
- **Small effects:** a burst when a pickup is collected, a "thunk" when a bomb is dropped, and sparks while boosting.
- **Stretch goal (M4):** sparks for near misses, when a head passes within a few units of a body and survives.

### 4.3 HUD and screens

The HUD and screens are HTML/CSS overlays on top of the canvas.

- **Top bar:** CYAN's score pips, boost meter, Shield chip and item queue are on the left. The next item is highlighted, and bomb charges show on the bomb's slot. The round clock is in the center and shows "OVERTIME" in red. PINK's side mirrors CYAN's on the right.
- **Screens:**
  - **Title:** the logo, both players' controls, a "First to N" selector, and "SPACE to start".
  - **Countdown:** 3-2-1-GO.
  - **Round banner:** the result and cause of death.
  - **Match over:** the winner and final score, with "SPACE rematch · ESC menu".
  - **Pause:** opened with Esc.
- The neon text uses a CSS `text-shadow` glow. The display font is Orbitron, bundled with `@fontsource/orbitron` (OFL license) so the game works offline.

### 4.4 Audio

- Every sound is generated at runtime with ZzFX (MIT license). There are no audio files.
- **Sound list:** countdown beeps and GO, boost start, pickup spawn (soft), pickup collect, bomb drop, fuse ticks in the last 0.5 s, explosion (higher pitch for chain links), ghost on and off, shield block, turbo, slow, reverse, death, round win, match win, and an overtime alarm.
- M mutes the sound, and the master volume is in the tuning panel. Audio starts on the first key press, because browsers block autoplay.

### 4.5 Controls

| | Turn left | Turn right | Boost | Use item |
|---|---|---|---|---|
| **P1 (CYAN)** | A | D | W | S |
| **P2 (PINK)** | ← | → | ↑ | ↓ |

- **Global keys:** Space starts a match or a rematch. Esc pauses or goes to the menu. The backtick key (`) opens the tuning panel, and M mutes.
- Keys are read by physical key code (`event.code`), so any keyboard layout works. Arrow keys and Space don't scroll the page.
- Use presses are stored between ticks, so a quick tap is never lost.
- Losing window focus releases all keys and pauses the game.
- All bindings are in one table, so they're easy to change if a keyboard can't register some key combinations (key ghosting).

### 4.6 Tuning panel

- The panel uses lil-gui and is opened with the backtick key (`). It has a control for every tunable value in section 6, in groups: Movement, Growth, Boost, Pickups, Items, Bombs, Match, Effects and Audio. Arena size and tick rate are fixed.
- Changes take effect right away, because the sim reads its config on every tick.
- Settings are saved to `localStorage` (inside try/catch). There are "Reset to defaults" and "Copy config JSON" buttons, so good settings can be made the new defaults.

## 5. Architecture

### 5.1 Stack

- TypeScript
- Vite for the dev server and builds; `pnpm dev` opens the game in the browser
- Vitest for tests
- PixiJS 8 for graphics, with pixi-filters for bloom
- lil-gui for the tuning panel
- ZzFX for sound
- tsx to run Node scripts
- pnpm as the package manager

Use the latest versions and pin them exactly. If a brand-new major version (for example TypeScript 7's native compiler, Vite 8 or Vitest 5) gets in the way, fall back to the previous major.

### 5.2 Layout

```
src/
  sim/                  the rules engine: pure TypeScript with no browser APIs
    index.ts            public API
    config.ts           the Config type and DEFAULT_CONFIG
    detmath.ts          deterministic sin, cos and atan2
    rng.ts              seeded random numbers; their state lives inside MatchState
    types.ts            MatchState, SnakeState, BombState, PickupState, SimEvent
    trail.ts            trail storage, trimming and holes
    grid.ts             a uniform spatial grid for trail-point queries
    arena.ts            the tile grid and tile queries
    maps/               parse.ts, index.ts, open.ts, pillars.ts, cross.ts, bunkers.ts, lanes.ts
    snake.ts            steering, movement, growth, boost
    collision.ts        wall, tile, trail and head checks; shield deflection
    items.ts            the item slot, using items, effect timers
    pickups.ts          spawning, collecting, expiry
    bombs.ts            fuses, explosions, chain reactions, holes, tile destruction
    match.ts            phases, scoring, overtime, map rotation, rematch
    step.ts             runs one tick in a fixed order
    bots/simple-bot.ts  a heuristic bot for soak tests, and a starting point for a future AI
  client/               browser-only code
    main.ts             startup: the Pixi app and wiring
    loop.ts             fixed-step accumulator, interpolation, time scale
    input.ts            keyboard → PlayerInput for each tick
    events.ts           sends sim events to effects, audio and the HUD
    render/             world.ts (scaling, bloom) · arena.ts · snakes.ts · pickups.ts · bombs.ts · fx.ts
    hud.ts · screens.ts HTML overlays
    audio.ts            the ZzFX sound bank, mute and volume
    tuning.ts           the lil-gui panel and saving settings
scripts/soak.ts         the headless soak test with statistics
```

Tests sit next to the code they test, as `*.test.ts` files.

### 5.3 The rules engine (`src/sim`)

**Pure:** no DOM or browser APIs. A test scans `src/sim` and fails if it finds any of these:

- `Math.random`, `Date` or `performance`
- `Math.sin`, `Math.cos`, `Math.tan`, `Math.atan2`, `Math.hypot`, `Math.pow`, `Math.exp` or `Math.log`
- `window` or `document`

**Deterministic:**

- The sim runs a fixed 60 Hz tick.
- Its random-number generator is seeded, with 32-bit integer math, and its state is stored in `MatchState`.
- Trig functions use only `+ − × ÷` and `Math.sqrt`, all of which every browser computes identically.
- Loops always run in the same order.

These rules mean different browsers produce the same results, which rollback netcode will need.

**Plain-data state:** the state is JSON-compatible, so there are no classes, Maps or closures, and `cloneState` is a deep copy. That makes replays, rollback and server snapshots possible later. The spatial grid is a cache: it can be rebuilt from the state, and a clone rebuilds it when it's first used.

**Performance:** each `step` should take ≤ 1 ms normally and ≤ 3 ms in the worst case (late overtime with many bombs). Because collision checks use the spatial grid, their cost doesn't grow with snake length. The soak test should run at least 50× faster than real time.

**API:**

```ts
createMatch(config: Config, seed: number): MatchState
step(state: MatchState, inputs: PlayerInput[], config: Config): SimEvent[] // advances one tick, mutating state in place
rematch(state: MatchState, seed: number): void
cloneState(state: MatchState): MatchState

type PlayerInput = {
  turn: -1 | 0 | 1;
  boost: boolean;
  use: boolean; // Use was pressed at least once since the previous tick
};
```

**Tick order:**

1. Advance the phase timers (countdown, round over).
2. Advance the effect timers. Apply Reverse to the inputs.
3. Use items (drop bombs, start effects).
4. Steer, move, add the new trail point, grow, and trim the tail.
5. Collect pickups.
6. Advance bomb fuses, then resolve explosions and chain reactions.
7. Check collisions and apply Shield deflections.
8. Resolve deaths into a round result.
9. Spawn new pickups and expire old ones.
10. Return the events.

**Events:**

| Group | Events |
|---|---|
| Round flow | `countdown{n}`, `go`, `overtime`, `roundOver{winner \| null, deaths}`, `matchOver{winner}` |
| Pickups | `pickupSpawned{id, kind, x, y}`, `pickupCollected{id, kind, player}`, `pickupExpired{id}` |
| Items and effects | `itemUsed{player, kind}`, `effectStarted{player, effect}`, `effectEnded{player, effect}`, `boostStarted{player}` |
| Bombs | `bombDropped{id, player, x, y}`, `explosion{id, owner, x, y, radius, chainDepth, tilesDestroyed}` |
| Damage | `shieldBlocked{player, x, y, cause}`, `death{player, cause, killer \| null, x, y}` |

### 5.4 Client (`src/client`)

- **Game loop:** it runs on `requestAnimationFrame`. An accumulator calls `step` at 60 Hz, multiplied by the current time scale, with at most 5 catch-up ticks per frame. Every frame is drawn, and each head's position is interpolated between the previous tick and the current one. The sim stores each head's previous position for this.
- **Events:** the events returned by each `step` go through `events.ts` to the effects, audio, HUD and screens.
- **Client-only states:** the title screen and pause wrap around the sim. The sim never knows about them.
- **Body rendering:** each body is drawn in chunks, and only the chunks that changed are rebuilt (the head end, the tail end, and chunks that were hit by a blast). This keeps frame time steady no matter how long the snakes get.

### 5.5 The future online path (not built in v1)

Because the engine is deterministic and each player's input per tick is tiny (about 1 byte), it can support either an authoritative server or rollback netcode over a relay. The online spec will make that choice. Online, the config is fixed for the whole match. Invite links will open on phones, so the online spec also has to cover touch controls.

## 6. Tunable defaults (starting values)

| Group | Setting | Default |
|---|---|---|
| Arena | `arenaWidth` × `arenaHeight` · `tileSize` · map cell | 1600 × 1000 · 20 · 40 (fixed in v1) |
| Snake | `snakeRadius` (r) | 7 |
| | `baseSpeed` | 170 units/s |
| | `turnRate` | 3.4 rad/s (~195°/s, 50-unit turning radius) |
| | `neckLength` | 24 units |
| Growth | `startLength` | 120 units |
| | `growthPerSecond` | 40 units/s |
| | `overtimeAt` · `overtimeGrowthMultiplier` | 150 s · ×3 |
| | `roundMaxSeconds` (safety net) | 300 s |
| Boost | `boostMultiplier` | 1.6 |
| | `boostMeterSeconds` (full → empty) | 2.0 s |
| | `boostRefillSeconds` (empty → full, key released) | 6.0 s |
| Pickups | `maxPickups` · `firstPickupDelay` · `pickupInterval` | 4 · 1 s · 2.5 s |
| | `pickupLifetime` · `pickupRadius` | 12 s · 14 |
| | `pickupMinHeadDistance` · `pickupClearance` | 150 · 40 |
| | Weights | bomb 25 · ghost 12.5 · shield 12.5 · turbo 12.5 · slow 12.5 · reverse 12.5 · dozer 12.5 |
| | `itemSlots` | 3 |
| Bombs | `bombCharges` · `bombThrowCooldown` · `bombFlightTime` | 3 · 0.5 s · 0.45 s |
| | `bombFuse` (after landing) · `blastRadius` · `chainDelay` · `bombLeadFactor` | 1 s · 70 · 0.12 s · 1 |
| Items | `ghostDuration` · `ghostWarning` | 3 s · 0.75 s |
| | `shieldGrace` | 0.5 s |
| | `turboDuration` | 4 s |
| | `slowDuration` · `slowFactor` | 4 s · 0.6 |
| | `reverseDuration` | 4 s |
| | `dozerDuration` | 5 s |
| Match | `winsToWin` · `countdownSeconds` · `roundOverSeconds` | 5 · 3 s · 2.5 s |
| Effects (client) | bloom on · strength · threshold | on · 1.5 · 0.2 |
| | `shakeScale` · `hitStopSeconds` · `slowMoScale` · `slowMoSeconds` | 1.0 · 0.12 s · 0.3 · 0.8 s |
| Audio (client) | `masterVolume` · `muted` | 0.6 · false |

The tick rate is fixed at 60 Hz and can't be tuned.

## 7. Testing

- **TDD with Vitest** for every rule in section 3:
  - steering and turning radius
  - speed with boost, Slow and Turbo, and the boost meter draining and refilling
  - growth, overtime, the safety net, and tail trimming
  - every cause of death, the neck being safe, head-on draws, and simultaneous deaths
  - Ghost, including dying when it ends inside something
  - Shield deflection and grace for every kind of hit
  - pickup spawn timing, the pickup limit, clearance, expiry, and collecting only with an empty slot
  - each item's effect and timers
  - bomb fuses, blast kills including your own bomb, holes that stay until the tail passes, tile destruction, and chain reactions with the delay
  - phases, scoring, first-to-N, map rotation, and rematch
- **Determinism test:** the same seed and input script run twice produce identical state hashes, and `cloneState` followed by `step` matches `step` on the original.
- **Purity test:** the scan for forbidden APIs described in section 5.3.
- **Map tests:** as listed in section 3.8.
- **Soak test (`pnpm soak`):** two simple bots play many rounds headless. The bots look ahead along left, straight and right arcs and use their items at random. The test checks these invariants:
  - every number is finite
  - living heads stay in bounds
  - trail length never exceeds the target
  - scores stay consistent
  - every round ends

  It reports round length (median, p90, max), causes of death, items used, and explosions per round. A short version also runs as part of `pnpm test`.
- **Before each checkpoint:** the build passes, every test passes, and I run the dev server and check screenshots in a real browser.

## 8. Milestones

Each milestone ends with a playtest checkpoint.

**M1: Duel**

Builds:
- Project scaffold with the scripts `dev`, `build`, `test`, `typecheck` and `soak`.
- Sim:
  - deterministic math and seeded random numbers
  - config and state
  - trail storage and the spatial grid
  - steering, movement and boost
  - growth, overtime and the safety net
  - wall, self, body and head-on deaths
  - round and match phases, and first-to-N
  - the map format and parser, with the Open map
  - determinism and purity tests
  - the simple bot and the soak test
- Client:
  - the game loop with interpolation, and keyboard input
  - neon snakes, the grid and bloom
  - the HUD: scores, clock and boost meters
  - countdown, round banner with cause of death, and match over with a Space rematch
  - a basic death burst, screen shake, and the core sounds
  - the tuning panel

Playtest focus: does steering feel good? Are speed, turning and growth right? Does trapping your opponent work?

**M2: Boom**

Builds:
- Tiles, the other four maps, and map rotation.
- Pickups: spawning, expiry and collecting. Bomb pickups only in this milestone.
- The item slot and the Use key.
- Bombs: fuses, blasts, holes, tile destruction and chain reactions.
- The item slot on the HUD.
- Explosion effects and sounds, and pickup visuals.

Playtest focus: are bombs satisfying? Do chain reactions happen? Do the maps add anything?

**M3: Power-ups**

Builds:
- Ghost, Shield (with deflection and grace), Turbo, Slow and Reverse.
- Pickup weights.
- Status visuals and sounds.

Playtest focus: are the items balanced? Does seeing each other's item slot lead to mind games?

**M4: Polish and flow**

Builds:
- Title screen with the logo, controls and a first-to-N selector.
- Pause.
- The full death sequence: hit-stop, shatter, slow motion and camera punch-in.
- Chain reactions that escalate visually.
- Overtime visuals and alarm.
- Near-miss sparks (stretch goal).
- An audio pass with volume control.
- A performance pass on a late-overtime stress scene.
- A final soak test and tuning.
- A README.

Playtest focus: the "one more match" test.

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Keyboard ghosting: some keyboards can't register certain combinations of keys held together | Bindings are kept in one table, and the first playtest checks for the problem. If needed, there are alternate P2 keys (J/L/I/K). |
| Drawing very long snakes every frame | Chunked body drawing (section 5.4), and a profiled late-overtime stress scene in M4. |
| Bloom is expensive at high resolutions | Filter resolution and quality settings, plus an on/off toggle in the panel. |
| Bots don't play like people | Soak statistics check the safety nets. The real pacing is set with the tuning panel during playtests. |
| Very new toolchain versions | Pin exact versions, and fall back to the previous major version if something breaks. |

## 10. Workflow

- Work happens on the `v1-prototype` branch, with a commit after each task.
- Work stops at each milestone for a playtest, and the branch merges to `main` once the developer approves.
- Autonomous work between checkpoints follows the implementation plan that comes from this spec.

## 11. Changes from playtesting

- **v0.4.0.** Bombs are thrown, not dropped. The old drop-at-your-head bomb felt random. A thrown bomb lands where the opponent is heading, shows a reticle over its blast zone, and gives them about 1.45 s to react. More pickups spawn: up to 4 on the field, the first after 1 s, then one every 2.5 s, each lasting 12 s. Power-ups have more weight relative to bombs.
- **v0.5.0.** Snakes carry up to 3 items in a queue, and Use fires the oldest. A Shield becomes a bubble that never takes a slot. There's a new **Bulldozer** power-up: for 5 s your plow shoves blocks, pushing rows of up to 4 and crushing any it can't move. It can shove a block into your opponent's head.
