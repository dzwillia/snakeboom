# SnakeBoom

A two-player neon snake duel. Your snake keeps growing: trap your opponent so they crash into your body, a wall, or themselves.

Grab glowing pickups for bombs (three per pickup, dropped with Use). Blasts kill any head in range (yours too), punch holes through bodies, destroy blocks, and set off other bombs in chain reactions. Every round after the first plays on a different hand-made map.

## Play

```bash
pnpm install
pnpm dev        # opens the game in your browser (http://localhost:5199)
```

| Player | Steer | Boost | Use item |
|---|---|---|---|
| **CYAN** | A / D | W | S |
| **PINK** | ← / → | ↑ | ↓ |

<kbd>Space</kbd> start / rematch · <kbd>Esc</kbd> pause · <kbd>M</kbd> mute · <kbd>`</kbd> tuning panel (every gameplay number is a live slider).

## Develop

```bash
pnpm test        # unit tests (rules engine + client helpers)
pnpm typecheck
pnpm build
pnpm soak --rounds 100   # headless bot-vs-bot stats: round lengths, death causes, speed
```

The rules engine (`src/sim`) is deterministic, pure TypeScript that also runs in Node, ready for a future game server. Design: `docs/superpowers/specs/2026-09-23-snakeboom-v1-design.md`.
