# SnakeBoom

A two-player neon snake duel on one keyboard. Your snake never stops growing: trap your opponent so they crash into your body, a block, a wall, or themselves, and throw bombs that blow holes in everything.

## Play

```bash
pnpm install
pnpm dev        # opens the game in your browser (http://localhost:5199)
```

| Player | Steer | Boost | Use item |
|---|---|---|---|
| **CYAN** | A / D | W | S |
| **PINK** | ← / → | ↑ | ↓ |

The title screen is a short menu: ↑ / ↓ moves between **LOCAL** (← / → picks who plays PINK: a second human, or the local AI at easy, normal or hard), **FIRST TO N** (← / → picks the match length, 1–10), **CREATE LINK** and **QUICK MATCH**, and <kbd>Space</kbd> goes. In a match, <kbd>Space</kbd> rematches, <kbd>Esc</kbd> pauses, <kbd>M</kbd> mutes, <kbd>H</kbd> (or <kbd>?</kbd>) opens the Powers page, and <kbd>`</kbd> opens the tuning panel, where every gameplay number is a live slider.

The Powers page lists every pickup with its icon, what it does and the numbers it currently runs on (durations, charges, blast radius, spawn share), read live from the tuning config. It opens from the title screen or from pause, so you can check a power mid-match.

### Playing solo against the AI

Pick an AI level on the title screen's LOCAL row (or in the tuning panel under **Opponent**) and PINK steers itself; you play CYAN on WASD. The choice is remembered, and changing it during a match takes effect at the next match.

| Level | How it plays |
|---|---|
| **Easy** | Looks under a second ahead, reacts slowly, wanders toward pickups, uses items at random and stays confused by Reverse for a full second. Good for testing a mechanic in peace. |
| **Normal** | Looks further, replans quickly when something lands in its path, fights for territory and times Reverse for when you're boxed in. |
| **Hard** | Plans two and a half seconds ahead every other tick, fights for territory (the floor it can reach before you can), cuts across your line just ahead of your head, boosts to get there, bombs you when you're cornered and reads Reverse instantly. |

The AI lives in the rules engine (`src/sim/bots/opponent.ts`), so it is deterministic and works headlessly: `pnpm soak --bots hard,easy` pits two levels against each other and prints win counts and who hurt whom, `--profile '{"aggression":0.5}'` overrides knobs on the first AI seat, and `--debug 1` prints what the first AI was seeing when it hurt itself. The same code could drive a server-side bot online later. Difficulty levels are a table of knobs (look-ahead, reaction time, aggression, greed, boost use, item skill, mistake rate) at the top of that file.

## How it plays

- **Hearts:** you get **3 hearts** a round. Hitting a wall, a block, your opponent's body or your own costs a heart and bounces you off, with a second of grace. The hit on your last heart kills you. A head-on collision costs both of you a heart.
- **Rounds** end when a snake dies, or after 90 s, when the snake with more hearts left wins (equal hearts is a draw). First to the target wins the match.
- **Growth:** snakes keep growing all round, so the arena keeps getting tighter.
- **Pickups** spawn all round. You carry up to **three items** and Use fires the oldest. Both item queues show on the HUD, so you always know what your opponent has.

| Item | What it does |
|---|---|
| **Bomb ×3** | Thrown ahead of your opponent. A reticle marks the blast zone, and it goes off 1 s after landing. Blasts hit heads (yours too), punch holes through bodies, destroy blocks and set off other bombs. |
| **Ghost** | For 3 s your head slips through bodies, heads and blocks. Walls and blasts still hit. |
| **Shield** | A bubble that takes your next hit so you keep your heart. It never takes a slot. |
| **Reverse** | Your opponent's left and right are swapped for 4 s. |
| **Bulldozer** | For 5 s your plow shoves blocks (and crushes the ones it can't move), straight into your opponent if you aim well. |

Timed specials flash on and off for their last 3 seconds, on your snake and on the HUD, so you know they're about to run out.

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

The site and the relay ship as two Docker images (`Dockerfile.web`, `Dockerfile.api`) and run behind the shared Caddy on the Happy Path box. A `v*` tag builds, pushes and deploys them through `.github/workflows/deploy.yml`. The runbook, including the one-time setup, is in [`infra/README.md`](infra/README.md).

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
