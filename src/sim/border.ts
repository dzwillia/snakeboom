import { ARENA_HEIGHT, ARENA_WIDTH, DT, TICK_RATE, type Config } from './config';
import { roundCapSeconds } from './players';
import type { MatchState } from './types';

/** The most the border can ever move in: the live area never drops below 4r on either axis. */
export function maxInset(cfg: Config): number {
  return (Math.min(ARENA_WIDTH, ARENA_HEIGHT) - 4 * cfg.snakeRadius) / 2;
}

/** The border's closing speed at a given round tick, in units per second per side. */
export function borderSpeedAt(roundTicks: number, cfg: Config, players = 2): number {
  const capTicks = Math.round(roundCapSeconds(cfg, players) * TICK_RATE);
  const startTicks = capTicks - Math.round(cfg.borderCloseSeconds * TICK_RATE);
  if (roundTicks <= startTicks) return 0;
  return Math.max(0, roundTicks > capTicks ? cfg.borderCrushSpeed : cfg.borderCloseSpeed);
}

/** Where the border will be `ticksAhead` ticks from now, for look-ahead (bots). Closed form of the sim's stepping. */
export function insetAt(state: MatchState, cfg: Config, ticksAhead: number): number {
  if (ticksAhead <= 0) return state.inset;
  const capTicks = Math.round(roundCapSeconds(cfg, state.snakes.length) * TICK_RATE);
  const startTicks = capTicks - Math.round(cfg.borderCloseSeconds * TICK_RATE);
  const now = state.roundTicks;
  const until = now + ticksAhead;
  const closingTicks = Math.max(0, Math.min(capTicks, until) - Math.max(startTicks, now));
  const crushTicks = Math.max(0, until - Math.max(capTicks, now));
  const inset = state.inset + closingTicks * Math.max(0, cfg.borderCloseSpeed) * DT + crushTicks * Math.max(0, cfg.borderCrushSpeed) * DT;
  return Math.min(maxInset(cfg), inset);
}
