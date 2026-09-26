# SnakeBoom M14: length is weapon storage

**Goal (issue #26):** a longer body is worth something. The items you can carry scale with your length, and a cut (Scissors, the saw, the flamethrower) drops the weapons that no longer fit as pickups on the spot, for anyone to take. Requested 2026-09-26 after playtesting v0.14/v0.15.

## Decisions

- **Slots scale with length.** `slotsFor(s, cfg)` = clamp(floor(trailLength / `slotLength`), 1, `itemSlots`). `slotLength` is new (150 units per slot); `itemSlots` stays as the cap and its default rises from 3 to 6. The floor of 1 means you can always hold something, even at `startLength` 120. With 40 units/s of growth a snake reaches 2 slots after ~5 s and the cap of 6 at 900 units (~20 s in). It is the *actual* trail length that counts, not `targetLength`, so a cut takes effect at once and growth has to be laid down before it stores anything.
- **Everything that read `itemSlots` as "how many I can carry" now reads `slotsFor`:** collecting, the invariant, both bots' greed checks, the HUD. The HUD draws all `itemSlots` cells and dims the ones you have not grown into (`.slot.locked`), so you can see storage grow and shrink.
- **A cut drops weapons.** In `cutTrail`, after the trail shortens, items beyond the new capacity are removed furthest-from-the-selected-item first (older first on a tie; done once #28's selector merged, replacing oldest-first) and each becomes a pickup of its kind, with the normal `pickupLifetime`, spread along the dropped segment at evenly spaced fractions of its point list (tail end first). A spot must be inside the live area and clear of blocks (Ghosts lay body through blocks, the plow shoves blocks onto bodies, and the border moves in over old tail); the search walks outward from the ideal point, preferring spots at least two pickup radii from the other drops, and gives up (the item is simply lost) only when nothing on the segment qualifies. No RNG: the placement is a pure function of the segment, so both peers agree.
- **Boost shedding.** After `advanceSnake`, a boosting snake holding more than `slotsFor` drops the item furthest from its selection at its tail (walking forward along the first few tail points if the tail itself is blocked). One O(1) length check per boosting snake per tick; nothing else ever shortens a body, so nothing else needs to check.
- **`dropped` pickups.** `PickupState.dropped` marks a pickup that fell off a snake. They may exceed `maxPickups`; the invariant only counts spawned ones. The spawner still counts everything on the field toward `maxPickups`, so drops pause spawning rather than flooding the arena.
- **The cutter** can take the drops like anyone else: pickups are collected before cuts run, so the earliest is the next tick.
- **Shield** is a bubble flag and is not storage; unchanged.
- **Oldest first** is the loss rule for now. When the weapon selector (#28) lands, the rule should become "the ones furthest from the selected item" so a cut never takes what you are about to fire.
- **Classic preset** keeps `itemSlots: 3` as its cap; it inherits the length rule (there is no way to say "always 3" with a floor formula, and Classic is a comparison preset, not a mode).
- No version bump on this branch: #27 and #28 are in flight and the owner cuts the release.

## Tasks

### Task 1: The sim
- `slotLength`/`itemSlots` in config; `PickupState.dropped`; `storage.ts` (`slotsFor`, `shedOverflow`); `cutTrail` sheds; step sheds while boosting; invariants; bots; tests; golden hash.
- [x] Commit `feat(sim): body length is weapon storage; cuts and boost drop what no longer fits`.

### Task 2: The client and the docs
- HUD locked slots, Powers page lead, tuning rows, README.
- [x] Commit `feat(client): storage slots on the HUD, tuning rows and copy`.

### Task 3: Verify and ship
- `pnpm test`, typecheck, build, soak, netsim, a headless cut check; PR against main.
