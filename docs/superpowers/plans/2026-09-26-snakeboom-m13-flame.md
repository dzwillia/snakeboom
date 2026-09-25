# SnakeBoom M13: the flamethrower and the head countdown

**Goal (v0.15.0):** a sixth weapon, the flamethrower, and a countdown by the head for every timed special, so you never have to look up at the HUD to know when a power runs out. Requested 2026-09-26 after v0.14.0 shipped.

## Decisions

- **Flamethrower** is a timed special like Scissors: Use lights it for `flameDuration` (2.5 s) and a cone of fire projects ahead of the head: `flameRange` 150 units from the head, half-angle `flameSpread` 0.5 rad (about 29° each side). While it burns:
  - the opponent's **body** in the cone is cut exactly as Scissors cut, at the newest burning point (everything behind it falls off, same `cut` event). Scissors need you to run across the body; fire reaches across a gap and through a cone, and lasts less.
  - the opponent's **head** in the cone dies with cause `flame` ("PINK was torched by CYAN"). A Shield or spare heart takes it (no push, like a missile) and grace covers the rest. A Ghost is not protected: fire is a missile-class threat.
  - the opponent's **missiles** in the cone burn up (`missileFizzled`). Your own don't: they start inside your own cone.
  - blocks, pickups, saws and wormholes are untouched; fire passes over blocks (no line of sight).
  - it never hurts you or your own body.
- **Mix:** `pickupWeights` missile 30 · scissors 15 · flame 15 · ghost 15 · shield 15 · dozer 10. Classic preset: flame 0.
- **Head countdown:** every running timed special (Bulldozer, Scissors, Ghost, Flame) draws a ring around the head in its colour that empties clockwise as the time runs out, and the seconds left ("1.8") sit just above the head in the same colour. The ring and the text keep a constant size on screen whatever the zoom. Several specials at once stack rings outward; the text shows the one ending soonest. The HUD chips stay.
- **AI:** fires the flame when the opponent is ahead and within range, like a missile; treats the opponent's burning cone as a hazard in rollouts (their predicted heading, for as long as it burns).

## Tasks

### Task 1: The flamethrower in the sim
- `PickupKind` 'flame', `EffectName` 'flame', `DeathCause` 'flame' (after `saw`, before `headOn`); config; `flame.ts` (`inCone`, `applyFlames`); step order after the saw cuts; AI use and hazard; tests; golden hash.
- [x] Commit `feat(sim): the flamethrower`.

### Task 2: The client
- Pickup glyph (arena and Powers page), item slot and effect chip, a cone of flickering fire from the head, sound, Powers page text, death text, tuning rows.
- The head countdown ring and seconds for every timed special.
- [x] Commit `feat(client): fire from the head, and a countdown by it`.

### Task 3: Verify and ship
- README, hunt spec addendum, `pnpm test`, typecheck, build, soak, netsim, browser check; bump `0.15.0`; PR.
