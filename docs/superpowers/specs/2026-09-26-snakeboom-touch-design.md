# SnakeBoom Touch: On-Screen Controls for Phones and Tablets

- **Date:** 2026-09-26
- **Status:** Decided in conversation (issue #33). Steering scheme A (thumb zones) with the corner button layout.
- **Why:** a phone or tablet has no keyboard, so today it can load the game but not steer. Touch play opens online matches and AI matches to anyone with a phone. Two players on one tablet is out of scope (a separate design).

## 1. Principles

1. **Touch produces the same input as a keyboard.** The overlay feeds the existing `PlayerInput` (turn −1/0/1, boost, use, select). The sim, the AI and the rollback netcode never know which one is in use, and a touch player is neither faster nor slower to turn than a keyboard player.
2. **Thumbs, not buttons.** Steering is by big zones you can hit without looking. Only Boost, Fire and Select are buttons, and they sit under the right thumb.
3. **Everything else stays.** The HUD, the camera, the minimap, the menus and the online flow keep working; they gain tap targets, nothing more.

## 2. Detection and the gate

- **Touch mode is on** when `isTouchOnly` matches (coarse pointer and no hover: `src/client/device.ts`, which today is defined but unused) or when the `touch` setting forces it. It is off on desktop. A tablet with a keyboard attached still gets the overlay (it matches coarse pointer); the keyboard keeps working alongside it.
- **The "play on a computer" page is gone** in favour of the overlay. The `snakeboom.desktop` override key stays for testing.
- **Landscape only for play.** In portrait, a full-screen card says "turn your phone sideways" over the game, and inputs are released. Menus work in either orientation.
- `index.html` gets `viewport-fit=cover`; the overlay respects `env(safe-area-inset-*)`.

## 3. Steering: scheme A, thumb zones

- The play area (below the HUD) is split into three columns: the left **30%** is the left-turn zone, the right **30%** is the right-turn zone, the middle 40% does nothing (so a stray touch never turns you).
- **Touch and hold** a zone to turn that way; release to go straight. Holding both turns neither (same as pressing A and D together). The turn signal is −1 or 1 while held; there is no proportional steering in this version.
- Zones are the full height of the play area, so either hand can steer, and a thumb can rest at the bottom corner. The right-turn zone's bottom corner is shared with the buttons: **a touch that starts on a button is a button press, not a turn.**
- A faint outline of each zone shows for two seconds when the overlay first appears in a match, then fades; a held zone glows dimly at its edge so you can see the input landed.

## 4. Buttons: the corner layout

Bottom-right corner, stacked, in the HUD font, translucent (about 35% until pressed, 80% while held), each at least 64 px square with 12 px gaps, offset by the safe-area inset:

| Button | Position | Action | Behaviour |
|---|---|---|---|
| **BOOST** | top of the stack | boost | held: `boost` true while touched |
| **FIRE** | below Boost | use | tap: latched `use` like a key press |
| **SELECT** | left of Fire, smaller | select | tap: latched `select` |

- Fire shows the selected item's colour and glyph so you know what you're about to fire; it dims when you carry nothing. Select shows a small cycle glyph and the count of carried items.
- Tapping an item slot on the HUD also selects that item directly (a convenience the keyboard doesn't have; it only sets `selected`, which the sim already clamps).
- Buttons use `pointerdown`/`pointerup`/`pointercancel` with pointer capture; `click` is never used, so there is no delay. Multi-touch: turn, Boost and Fire can all be held at once.

## 5. Menus and screens by tap

- **Title:** tap a row to make it active; tap the active row to confirm (what Space does). The `◀`/`▶` adjusters on the LOCAL and FIRST TO rows are tap targets. The key hints under the menu are replaced by touch hints in touch mode ("TAP A ROW · TAP AGAIN TO GO").
- **Lobby, forms, notices, round and match banners:** every hint line ("SPACE READY", "ENTER TO CONTINUE", "SPACE REMATCH · ESC MENU") becomes tappable buttons carrying the same actions. The room-name and display-name inputs already work with the on-screen keyboard; Enter on it submits.
- **Pause:** a small `II` button at the top-right of the play area, under the HUD, pauses (Escape). The pause panel gets RESUME and MENU buttons.
- **Powers page:** reachable from a `?` button beside the pause button, and from the title's hint line.
- The tuning panel (lil-gui) is not exposed on touch; the `` ` `` key still opens it with a keyboard attached.

## 6. Camera on small screens

- Online play follows your head at zoom 2 today. In touch mode on a screen shorter than 500 CSS px, the follow zoom is **2.5**, as a `touchZoom` setting. Local AI matches keep the fit-both-heads camera.
- The minimap stays bottom-right but moves up above the button stack in touch mode (it is 200 px wide; on phones it shrinks to 140).

## 7. Settings

- `touch: 'auto' | 'on' | 'off'` (default `auto`), `touchZoom: 2.5`, `touchOpacity: 0.35`. All in `ClientSettings`, persisted with the others, with rows in the tuning panel's new Touch folder.

## 8. What is deliberately not in this version

- Proportional steering (a floating joystick) and steer-toward-finger. If thumb zones feel too stiff, either becomes a setting later; both need a turn-pulse conversion that keeps touch and keyboard play equivalent.
- Two players on one tablet.
- Haptics.
- Gamepad support (a different issue).

## 9. Verification

- Unit tests for the pure parts: zone hit-testing (which column a point falls in, button rectangles win over zones), the pointer-to-`PlayerInput` reducer (holds, latches, multi-touch, cancel releases everything), orientation gating, and `trackForScreen`-style mapping of screens to their tap actions.
- Headless Playwright with device emulation (iPhone and iPad presets, `hasTouch: true`): the overlay appears only under touch; tapping the left zone turns the head left within a few ticks; Boost held doubles speed; Fire uses the selected item; a title row tap starts a match; portrait shows the card. Screenshots of the overlay at both sizes.
- A real-device pass by the owner (feel, safe areas, address bar behaviour on iOS Safari and Android Chrome) before merge.
