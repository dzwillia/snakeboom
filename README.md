# SnakeBoom

A two-player neon snake duel, on one keyboard or online. Your snake never stops growing and your own body never hurts you, so your body is a weapon: close a loop around your opponent's head and you've eaten them. Or shoot them down with a homing missile, or let the closing border do the work.

## Play

```bash
pnpm install
pnpm dev        # opens the game in your browser (http://localhost:5199)
```

| Player | Steer | Boost | Fire | Select |
|---|---|---|---|---|
| **CYAN** | A / D | W | S | Q |
| **PINK** | ← / → | ↑ | ↓ | Right Shift |

Fire uses the item that's highlighted on your HUD; Select moves the highlight to the next one you carry. The bindings live in `src/client/keys.ts`.

The title screen is a short menu: ↑ / ↓ moves between **LOCAL** (← / → picks who plays PINK: a second human, or the local AI at easy, normal or hard), **FIRST TO N** (← / → picks the match length, 1–10), **CREATE LINK** and **QUICK MATCH**, and <kbd>Space</kbd> goes. In a match, <kbd>Space</kbd> rematches, <kbd>Esc</kbd> pauses, <kbd>M</kbd> mutes, <kbd>H</kbd> (or <kbd>?</kbd>) opens the Powers page, and <kbd>`</kbd> opens the tuning panel, where every gameplay number is a live slider.

The Powers page lists every pickup with its icon, what it does and the numbers it currently runs on (durations, charges, missile flight time, spawn share), read live from the tuning config. It opens from the title screen or from pause, so you can check a power mid-match.

### Playing solo against the AI

Pick an AI level on the title screen's LOCAL row (or in the tuning panel under **Opponent**) and PINK steers itself; you play CYAN on WASD. The choice is remembered, and changing it during a match takes effect at the next match.

| Level | How it plays |
|---|---|
| **Easy** | Looks under a second ahead, reacts slowly, wanders toward pickups, uses items at random and rarely dodges a missile. Good for testing a mechanic in peace. |
| **Normal** | Looks further, replans quickly when something lands in its path, fights for territory and saves Ghost for when it's boxed in. |
| **Hard** | Plans two and a half seconds ahead every other tick, fights for territory (the floor it can reach before you can), cuts across your line just ahead of your head, boosts to get there, fires a missile when you're cornered in front of it, and draws a tight loop around any pickup it wants. (It doesn't loop *you* on purpose or dodge missiles yet.) |

The AI lives in the rules engine (`src/sim/bots/opponent.ts`), so it is deterministic and works headlessly: `pnpm soak --bots hard,easy` pits two levels against each other and prints win counts and who hurt whom, `--profile '{"aggression":0.5}'` overrides knobs on the first AI seat, and `--debug 1` prints what the first AI was seeing when it hurt itself. The same code could drive a server-side bot online later. Difficulty levels are a table of knobs (look-ahead, reaction time, aggression, greed, boost use, item skill, mistake rate) at the top of that file.

## How it plays

- **One life.** A wall, a block or your opponent's body kills you; a head-on collision kills you both. Your **own body never hurts you**: cross it, weave through it, draw shapes with it. (Hearts are still a tuning-panel slider.)
- **Encirclement kills.** When your head crosses your own trail, the loop you just closed is checked. If your opponent's head is inside it, they're gone. A Ghost phases through a closing loop; a Shield takes the hit.
- **Rounds always end in a kill.** After 30 s the deadly border starts closing in, the clock counts down in red, and at 45 s it crushes fast until someone dies. First to the target wins the match.
- **Growth and boost:** snakes keep growing all round, and **boosting burns your tail**: hold Boost to go twice as fast for as long as you have body to spend. The bar under your name is your length.
- **Length is storage.** You carry one item per **150 units of body** (at least one, at most six). Select picks one and Fire uses it; the selection follows the item, not the slot. Grow and the HUD's locked slots open up; get cut and the weapons that no longer fit **drop as pickups along the fallen body**, the ones furthest from your selected item first (so what you're about to fire survives), for anyone to grab, the cutter included. Boosting past a slot boundary drops one at the tail the same way. Both item queues show on the HUD, so you always know what your opponent has and what they're about to use.
- **Pickups** spawn every second or so and vanish after 12 s, dropped ones included, and you **loop one to take it**: running over a pickup does nothing, but close a loop with your own body around it (the same loop that would catch a head) and it's yours, with a flash of the loop in your colour. Everything inside the loop is taken at once, as far as your slots go; a Shield needs no slot. That takes about 300 units of body for the tightest circle, so it's a few seconds into a round before anyone can collect, and every pickup is a moment your opponent can interrupt.
- **A big arena.** The field is 3200×2000, four times what it was. Locally the camera fits both heads and zooms between the whole arena and a close view; online it follows your own head. The **minimap** in the corner shows the arena, the border's dead zone, both heads, hazards and where your camera is looking.
- **Wormholes.** Every 12 s a violet portal opens somewhere for 10 s, with a dashed exit ring at least 800 units away. Touch it and your head appears at the exit, heading the same way, with **no body along the chord**: the old body stays where it was until it trims away. A loop that would span a jump doesn't count, and you can't go straight back in for a second.
- **The saw.** Every 15 s a yellow circular saw appears away from both heads and roves for 12 s, bouncing off the border and blocks. It **kills a head** it touches (a Shield pushes you clear) and **cuts any body** it runs through, exactly like Scissors, spare weapons and all.

| Item | What it does |
|---|---|
| **Missile ×3** | Fires from your head and homes on your opponent for 2 s. It turns, but not on a dime: a hard cut at the right moment or a boost outruns it, a Shield eats it, and it never hits you. |
| **Scissors** | For 3 s, running your head across your opponent's body cuts it: everything from there back to their tail falls off, and you pass through. They lose length, boost fuel, any loop they were drawing and the weapons that no longer fit, which land on the fallen body as pickups. Heads, walls, missiles and loops still kill you. |
| **Flamethrower** | For 2.5 s a cone of fire reaches 150 units ahead of your head. Your opponent's body in it is cut like Scissors would, from a distance; their head in it is torched (a Shield takes the hit, a Ghost doesn't help); their missiles burn up. It never hurts you. |
| **Ghost** | For 2 s your head slips through bodies, heads and blocks, and a closing loop can't catch you. Walls and missiles still hit. |
| **Shield** | A bubble that takes your next hit so you keep your heart. It goes up the moment you loop it and never takes a slot. |
| **Bulldozer** | For 3 s your plow shoves blocks (and crushes the ones it can't move), straight into your opponent if you aim well. |

Every timed special draws a **countdown ring** around your head in its colour, emptying as the time runs out, with the seconds left just above it, so you never have to look up at the HUD. Timed specials also flash on and off for their last second, on your snake and on the HUD. The tuning panel has a **Classic** preset with the slower v0.7 feel for comparison.

Five hand-made, symmetrical maps rotate between rounds: Open, Pillars, Cross, Bunkers and Lanes.

## Online (preview)

Since v0.8.0 two people can play from different computers. On the title screen pick **CREATE LINK**, type a name, and send the link (`/r/ABC123`) to a friend. They open it, both press Space in the lobby, and the match runs on both machines with rollback netcode: every tick each client sends its own input to a small relay and predicts the opponent's until the real one arrives. The HUD shows the ping between you next to the clock.

- **Quick match** pairs you with whoever else is waiting. While you wait you get an invite link too, and after ten seconds an offer to play the Hard AI instead (<kbd>A</kbd>).
- **Rematch:** after a match, <kbd>Space</kbd> asks for another and <kbd>Esc</kbd> goes back to the lobby. A line under the banner shows who's in.
- **Refresh to rejoin:** if your tab drops or you reload, the other player sees a 15 s countdown and the game waits. Come back in time and your browser rebuilds the match from the relay's input log in a moment; miss it and they win by forfeit.
- **Phones** get a page that keeps the link: SnakeBoom needs a keyboard.
- <kbd>N</kbd> during an online match shows the netcode readout under the ping: input delay, rollbacks and stalls per minute, how far ahead of the other player you're running, and the speed nudge that keeps you level. `pnpm netsim --profile hotspot` runs the same netcode headlessly through a simulated bad connection.

Play at **[snakeboom.com](https://snakeboom.com)**.

Under the hood: `src/net` holds the protocol, the rollback session and the room state machine (pure, tested through an in-memory relay with latency and jitter), and `src/server` is the Node relay. It never runs the game; it pairs players, forwards inputs and compares both clients' state hashes every second.

```bash
pnpm dev                          # Vite on :5199 plus the relay on :3001
pnpm dev:relay                    # the relay alone (PORT, ALLOWED_ORIGIN, APP_VERSION, RELAY_LAG_MS)
RELAY_LAG_MS=50 pnpm dev:relay    # add 50 ms each way, to feel rollback on one machine
pnpm build:server && pnpm start:server
```

To play across a LAN, run the relay on one machine and point the other at it: `VITE_API_URL=http://<lan-ip>:3001 pnpm dev:web --host`. The client reads `VITE_API_URL` at build time and defaults to `http://localhost:3001`.

## Hosting

The site and the relay ship as two Docker images (`Dockerfile.web`, `Dockerfile.api`) and run behind the shared Caddy on the Happy Path box. A `v*` tag builds, pushes and deploys them through `.github/workflows/deploy.yml`; the tag is baked into the site as the version shown in the corner of the title screen (a local build shows `v0.x.y-dev`). The runbook, including the one-time setup, is in [`infra/README.md`](infra/README.md).

## Develop

```bash
pnpm test                 # unit tests (rules engine + client helpers)
pnpm typecheck
pnpm build                # static site in dist/
pnpm soak --rounds 100    # headless bot-vs-bot stats: round lengths, deaths, pickups, speed
pnpm soak --bots hard,normal --rounds 40   # pit two AI levels (or `simple`, the soak bot) and count wins
```

- `src/sim` is the rules engine. It's deterministic, pure TypeScript with no browser APIs: fixed 60 Hz ticks, seeded random numbers, its own trig functions, and plain-data state. Online play runs it on both machines and hashes it to referee.
- `src/client` is the PixiJS renderer with bloom, plus HTML overlays, ZzFX-generated sounds and a lil-gui tuning panel.

Design: `docs/superpowers/specs/2026-09-23-snakeboom-v1-design.md` (local) and `docs/superpowers/specs/2026-09-24-snakeboom-online-design.md` (online) · Plans: `docs/superpowers/plans/`
