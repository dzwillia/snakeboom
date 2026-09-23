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

On the title screen, ← / → picks the match length (first to 1–10). <kbd>Space</kbd> starts or rematches, <kbd>Esc</kbd> pauses, <kbd>M</kbd> mutes, and <kbd>`</kbd> opens the tuning panel, where every gameplay number is a live slider.

## How it plays

- **Dying:** you die if your head hits a wall, a block, your opponent's body or your own. A head-on collision means both die, and the round is a draw. First to the target wins.
- **Growth and overtime:** snakes keep growing, and after 2:30 overtime triples the growth.
- **Pickups** spawn all round. You carry up to **three items** and Use fires the oldest. Both item queues show on the HUD, so you always know what your opponent has.

| Item | What it does |
|---|---|
| **Bomb ×3** | Thrown ahead of your opponent. A reticle marks the blast zone, and it goes off 1 s after landing. Blasts kill heads (yours too), punch holes through bodies, destroy blocks and set off other bombs. |
| **Ghost** | For 3 s your head slips through bodies, heads and blocks. Walls and blasts still kill. |
| **Shield** | A bubble that saves you from your next crash. It never takes a slot. |
| **Turbo** | 4 s of free boost. |
| **Slow** | Your opponent moves at 60% speed for 4 s. |
| **Reverse** | Your opponent's left and right are swapped for 4 s. |
| **Bulldozer** | For 5 s your plow shoves blocks (and crushes the ones it can't move), straight into your opponent if you aim well. |

Five hand-made, symmetrical maps rotate between rounds: Open, Pillars, Cross, Bunkers and Lanes.

## Develop

```bash
pnpm test                 # unit tests (rules engine + client helpers)
pnpm typecheck
pnpm build                # static site in dist/
pnpm soak --rounds 100    # headless bot-vs-bot stats: round lengths, deaths, pickups, speed
```

- `src/sim` is the rules engine. It's deterministic, pure TypeScript with no browser APIs: fixed 60 Hz ticks, seeded random numbers, its own trig functions, and plain-data state. The same code can run on a game server, which is the next milestone: online 1v1 duels with invite links.
- `src/client` is the PixiJS renderer with bloom, plus HTML overlays, ZzFX-generated sounds and a lil-gui tuning panel.

Design: `docs/superpowers/specs/2026-09-23-snakeboom-v1-design.md` · Plans: `docs/superpowers/plans/`
