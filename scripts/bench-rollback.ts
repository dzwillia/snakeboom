import { performance } from 'node:perf_hooks';
import { botInput, cloneState, createBot, createMatch, DEFAULT_CONFIG, hashState, NO_INPUT, step, TICK_RATE } from '../src/sim';

/**
 * How expensive rollback is late in a round: cloneState, a 10-tick rollback, hashState and a
 * 300-tick catch-up slice, on a state after 85 s of bot play (spec 5.3 budget: 12 ms per rollback).
 */
const cfg = { ...DEFAULT_CONFIG, roundMaxSeconds: 200, hearts: 5 };
const RUNS = Number(process.argv[2] ?? 200);

function timed(label: string, fn: () => void, runs = RUNS): void {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const at = (q: number) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))];
  console.log(`${label.padEnd(28)} median ${at(0.5).toFixed(2)} ms · p95 ${at(0.95).toFixed(2)} ms · max ${samples[samples.length - 1].toFixed(2)} ms`);
}

const state = createMatch(cfg, 77);
const bots = [createBot(1), createBot(2)];
const target = Math.round((cfg.countdownSeconds + 85) * TICK_RATE);
while (state.tick < target && state.phase !== 'matchOver') {
  // Keep both alive: restart the round with fresh hearts if someone dies early.
  step(state, bots.map((b, i) => botInput(b, state, i, cfg)), cfg);
  if (state.phase === 'roundOver') for (const s of state.snakes) s.alive = true;
}
const trail = state.snakes.map((s) => s.trail.xs.length - s.trail.start);
const json = JSON.stringify(state).length;
console.log(`state at tick ${state.tick} (${(state.roundTicks / TICK_RATE).toFixed(0)} s of round): live trail points ${trail.join(' / ')}, JSON ${(json / 1024).toFixed(0)} KB, grid entries ${state.grid.cells.reduce((n, c) => n + c.length, 0)}`);

timed('cloneState', () => void cloneState(state));
timed('rollback (clone + 10 steps)', () => {
  const s = cloneState(state);
  for (let i = 0; i < 10; i++) step(s, [NO_INPUT, NO_INPUT], cfg);
});
timed('hashState', () => void hashState(state));
timed('catch-up slice (300 steps)', () => {
  const s = cloneState(state);
  for (let i = 0; i < 300; i++) step(s, [NO_INPUT, NO_INPUT], cfg);
}, Math.max(5, Math.floor(RUNS / 10)));
