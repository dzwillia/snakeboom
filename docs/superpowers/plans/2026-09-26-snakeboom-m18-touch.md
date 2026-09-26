# SnakeBoom M18: Touch Controls

**Goal (v0.18.0):** phones and tablets can play online and AI matches with on-screen controls: thumb zones to steer, Boost/Fire/Select under the right thumb, and tappable menus. Spec: `docs/superpowers/specs/2026-09-26-snakeboom-touch-design.md` (issue #33).

## Decisions
See the spec. In short: scheme A (left 30% / right 30% turn zones, hold to turn), corner buttons (Boost above Fire, Select beside Fire), landscape only for play, tap rows to navigate menus, follow zoom 2.5 on short screens, a `touch` setting of auto/on/off.

## Tasks

### Task 1: The input reducer and hit-testing (pure, tested)
- `src/client/touch/zones.ts`: `layout(width, height, insets)` → zone and button rectangles; `hitTest(layout, x, y)` → `'left' | 'right' | 'boost' | 'fire' | 'select' | null` (buttons win over zones).
- `src/client/touch/pointers.ts`: `TouchState` reducer over pointer events (`down`, `move`, `up`, `cancel`, `blur`) keeping a map of pointer id → target; `sample()` returns a `PlayerInput` (turn from held zones, boost held, use/select latched) and clears latches, mirroring `KeyboardInput`.
- `src/client/touch/orientation.ts`: `playable(width, height)` (landscape) and the settings gate `touchMode(settings, matches)`.
- Tests for all three.
- [ ] Commit `feat(client): touch input reducer and layout`.

### Task 2: The overlay and the wiring
- `src/client/touch/overlay.ts`: DOM overlay under `#screens` and above the canvas: two zone outlines (fade after 2 s), the button stack with safe-area offsets, the pause `II` and `?` buttons, the portrait card. Pointer events with capture; `touch-action: none`. Fire shows the selected item's glyph/colour; Select shows the carried count.
- `main.ts`: an `Input` union so `input.sample()` / `sampleLocal()` merge keyboard and touch (touch OR keyboard per field, latches from either). Show/hide the overlay by screen and phase. HUD slot taps set `selected` (local only; online it is a `select` press sequence to reach that slot, or skip online).
- Camera: `touchZoom` for `followView` on short screens; minimap size/position in touch mode.
- `index.html` viewport-fit; CSS for the overlay, safe areas and the portrait card.
- [ ] Commit `feat(client): on-screen controls`.

### Task 3: Menus and screens by tap
- `screens.ts`: rows and adjusters get `data-action`; hint lines become buttons in touch mode; pause/powers/banners/lobby/forms get their buttons. One delegated `pointerup` handler in `main.ts` maps `data-action` to the same code paths the keys use (refactor the key switch into named actions first: `menuUp`, `menuDown`, `adjust(-1|1)`, `confirm`, `escape`, `powers`, `mute`).
- Online screens: `online.key(code)` gains `online.action(name)` (or the actions synthesise key codes).
- Tests: `screens.test.ts` for the touch hints; a small test for the action mapping.
- [ ] Commit `feat(client): tap to navigate every screen`.

### Task 4: Verify and ship
- `pnpm test`, typecheck, build. Playwright with `devices['iPhone 13']` and `devices['iPad (gen 7)']` (landscape): overlay present only under touch; left-zone hold turns left; Boost doubles speed; Fire uses the selected item; title row tap starts; portrait card. Screenshots at both sizes.
- README: a Touch section; the Play section's control table gets a touch column.
- Bump `0.18.0`, PR. The owner tests on real devices before merging.
