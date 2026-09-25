# SnakeBoom M16: randomized maps generated per round

**Goal (#22):** a fresh, symmetric, connected layout for any round that draws a "random" slot from the map bag, built from the match's seeded rng so both online peers and every rollback agree. The five hand-made maps stay in rotation by default. Requested 2026-09-26.

## Decisions

- **Symmetry: point symmetry through the centre (180° rotation)**, not mirror-on-both-axes. It is what the five hand-made maps already have (`maps.test.ts` checks exactly this), it is what the existing spawn pairs are (P1 top-left ↔ P2 bottom-right, headings 180° apart), and it gives each player the identical view rotated rather than a kaleidoscope: two-axis mirroring forces four-fold symmetry, which over-constrains 40×25 and makes every layout look like the same cross. Cell (c, r) mirrors to (39−c, 24−r); a feature and its twin are stamped together.
- **Resolution:** the generator works on the 40×25 map-cell grid and expands 4×4 tiles per cell exactly like `parseMap` (shared `cellsToTiles`), so blocks look like the hand-made ones and the Bulldozer, saws and the AI's BFS field see nothing new.
- **Spawns:** one of the five hand-made spawn layouts (Open, Pillars, Cross, Bunkers, Lanes positions and headings), chosen by the rng. A 7×7 square (Chebyshev radius 3 cells = 240 units) around each spawn stays clear, which is what Lanes gives its spawns.
- **Vocabulary, mixed per map** (weights in brackets): pillars 2–4 cells square [4]; walls 6–14 long, 1 or 2 thick, with a 2–3 cell gap half the time when long enough [4]; lane pairs (two parallel walls 3–4 apart) [2]; bunkers (a C-shaped outline 5–8 × 5–7 with one whole side open) [2]; and, 60% of the time, a centre block 2–4 wide × 1–3 tall (Pillars' hub). Features keep 2 cells from each other, from their twin and from the arena edge, so every corridor is at least 160 units wide and nothing can seal a pocket. Placement is rejection sampling: up to 80 tries per attempt, stopping when the block budget is spent.
- **Density knob:** `mapDensity` (0–1, default 0.3) is the block budget as a share of the most the generator will place (15% of cells). 0.3 is 45 cells, between the hand-made average with Open counted (41) and without (52). 0 gives an empty map; 1 a dense one.
- **Validation and fallback:** an attempt passes when a flood fill at cell resolution from spawn 1 reaches spawn 2 and at least 90% of the floor, and no floor cell has fewer than two floor neighbours (a single-cell notch a snake can't turn in). Up to 8 attempts; then the empty map with the chosen spawns. Every attempt draws from the rng, so the result is still a pure function of the rng state.
- **Rotation:** `maps: 'handmade' | 'random' | 'both'` (default `'both'`). The bag deals indices into a catalogue: five hand-made entries plus three random slots (`both`), only the five (`handmade`) or only the three (`random`). A random slot generates a fresh layout each time it comes up. Round 1 stays index 0, so it is Open unless `maps` is `random`. `mapIndex`/`mapBag` are unchanged; indices wrap if the setting changes mid-match.
- **State:** `MatchState.mapName` records what was loaded (hand-made name or "Random"); the tiles already live in `state.tiles`, and spawns are only needed while `startRound` runs, so nothing else is stored. Rollback replays `startRound` from the same rng state and gets the same map.
- **Rng order:** `startRound` draws only for random slots, after `pickNextMap`'s shuffle. The golden hash changes (the bag is now 8 entries) and is re-pinned.
- **Online:** both peers build `cfg` from `DEFAULT_CONFIG` (only `winsToWin` travels), so both see `maps: 'both'` and generate the same layouts from the shared seed.

## Tasks

### Task 1: The generator
- `parse.ts`: extract `cellsToTiles` and `cellSpawn`; `generate.ts`: `generateMap(rng, { density })`, `SPAWN_LAYOUTS`, features, validation; `generate.test.ts`: determinism, symmetry, clearance, connectivity on 200 seeds, density band, fallback.
- [ ] Commit `feat(sim): a symmetric map generator`.

### Task 2: Rotation
- `Config.maps`, `Config.mapDensity`; `mapCatalogue(cfg)`; `startRound` loads by catalogue entry; `MatchState.mapName`; rotation tests; golden hash.
- [ ] Commit `feat(sim): random slots in the map bag`.

### Task 3: Client and docs
- Tuning rows (`Maps` folder), README, soak prints the map name.
- [ ] Commit `feat(client): maps and density in the tuning panel`.

### Task 4: Verify and ship
- `pnpm test`, typecheck, build, `soak --rounds 100`, netsim, headless screenshots of three random layouts; PR (no merge, tag or deploy).
