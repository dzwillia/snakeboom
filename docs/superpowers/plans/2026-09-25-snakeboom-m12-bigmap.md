# SnakeBoom M12 (Big Map) Implementation Plan

> **For agentic workers:** work task by task on the `bigmap` branch, test first, commit after each task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal (v0.14.0):** four times the arena, a camera and a minimap to play it on, a wormhole that moves you across it, and a roving circular saw that cuts what it touches. Requested 2026-09-25 after the hunt rules shipped. (Up to 8 players is filed as issue #20, not part of this.)

## Decisions

- **Arena 3200×2000** (was 1600×1000). Tiles stay 20 units, so the tile grid is 160×100. The hand-made maps keep their 40×25 source grids; a map cell becomes 80 units (4×4 tiles), so every existing map scales up unchanged and keeps its symmetry tests. Blocks are chunkier; that's fine for now.
- **Camera.** The world no longer fits on screen at a playable size, so the client gets a view: a centre and a zoom, where zoom 1 shows the whole arena and zoom 2 shows the old apparent size. **Local play** fits both live heads with a margin, between zoom 1 and 2, centred between them. **Online** follows your own head at zoom 2, clamped to the arena, so the opponent can be off screen: that's the hunt. The view eases toward its target; the death punch and screen shake compose with it.
- **Minimap** in the bottom-right corner, always on: the arena, the dead zone, every head, wormholes (entry and exit), saws, and the camera's view rectangle.
- **Tuning that scales with the map:** the border closes twice as fast (24 units/s) but crushes at the old 120 units/s, since a 240 crush was faster than a snake can comfortably run and turned the endgame into a coin flip (hard AI fell to parity with normal), pickups up to 12 with one every second and a 300-unit distance from heads. Snake speed stays 280 for the first playtest.
- **Wormhole.** One at a time. Every `wormholeInterval` (12 s) a portal opens at a clear spot for `wormholeLifetime` (10 s), with an exit marked at another clear spot at least `wormholeMinJump` (800) away. A head touching the portal appears at the exit with its heading, and a `portalCooldown` of 1 s stops it re-entering. The body doesn't come along: the trail gets a **jump** point (zero path length, not solid, not drawn), so the snake continues from the exit and the old body stays where it was until it trims away. A loop that would span a jump doesn't count (no chord across the map). Missiles ignore wormholes. The AI treats them as neutral and replans after a jump.
- **Saw.** One at a time. Every `sawInterval` (15 s) a saw of radius 34 appears at a clear spot 400+ from every head, heading a random way at `sawSpeed` (180), for `sawLifetime` (12 s). It bounces off the live border and off blocks. A head it touches dies (cause `saw`; Shield absorbs; grace ignores). A body it touches is cut exactly as scissors cut, with the same `cut` event (`by: -1`). The AI treats saws as moving hazards (constant velocity) in its rollouts.

## Review Focus

1. **Nothing assumes the old size.** After Task 1, `grep -rn "1600\|1000\|800, 500" src` finds only tests placing snakes inside the arena; every wall, border, spawn, pickup and camera calculation reads the constants. Task 1.
2. **The camera never shows outside the arena and never loses a head** in local play. Task 1 (pure functions, tested).
3. **A jump is not a body.** After a wormhole, no collision, loop or cut can happen along the chord between entry and exit. Task 2.
4. **The saw is deterministic** (bounces use `detmath`, spawns use the seeded rng) and cuts exactly like scissors. Task 3.
5. **Online agrees** with all three in play. Task 4.

## Tasks

### Task 1: The big arena, the camera and the minimap
- Sim: constants; `MAP_CELL` 80; border and pickup defaults; the golden hash. `pnpm soak` and the AI tests keep their timeouts (the territory BFS is 4× the cells).
- Client: `camera.ts` (`targetView`, `clampView`, `easeView`, tested); `World.view`; `Fx.update` composes view, punch and shake; `render/minimap.ts`; `main.ts` sets the target each frame (local: all live heads; online: the local head); `OnlineMatch.localPlayer`.
- [ ] Commit `feat: a 3200×2000 arena with a camera and a minimap`.

### Task 2: The wormhole
- Sim: `WormholeState`, `state.wormholes`, `trailJump`, `SnakeState.portalCooldown`, spawn/expire/enter in `wormholes.ts`, the jump rule in `encircle.ts`, events `wormholeOpened/Closed/Warped`; tests.
- Client: portal and exit rendering, minimap marks, a warp sound, camera snap on warp (no easing across the map).
- [ ] Commit `feat(sim): the wormhole`.

### Task 3: The saw
- Sim: `SawState`, `state.saws`, `saws.ts` (spawn, move, bounce, head kill, body cut via the shared `cutTrail` from `scissors.ts`), cause `saw`, events `sawSpawned/Gone`; the AI's rollout hazard; tests.
- Client: a spinning toothed disc, buzz and snip, minimap mark, `describeDeath` "CYAN ran into the saw".
- [ ] Commit `feat(sim): the roving saw`.

### Task 4: Verify and ship
- Spec addendum in the hunt spec; README; tuning rows; `pnpm test`, `typecheck`, `build`, soaks, netsim; browser checks (camera in local play, following online, a warp, a saw cut); bump `0.14.0`; PR; merge; tag; deploy.
