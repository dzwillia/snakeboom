import { botInput, checkInvariants, createBot, createMatch, DEFAULT_CONFIG, rematch, step, TICK_RATE } from '../src/sim';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const rounds = Number(args.get('rounds') ?? 100);
const seed = Number(args.get('seed') ?? 1);
const cfg = structuredClone(DEFAULT_CONFIG);

const state = createMatch(cfg, seed);
const bots = [createBot(seed + 1), createBot(seed + 2)];
const lengths: number[] = [];
const causes = new Map<string, number>();
const problems: string[] = [];
let draws = 0;
let ticks = 0;
let explosions = 0;
let chained = 0;
let collected = 0;
const started = performance.now();

while (lengths.length < rounds) {
  const events = step(state, bots.map((b, i) => botInput(b, state, i, cfg)), cfg);
  ticks++;
  for (const e of events) {
    if (e.type === 'death') causes.set(e.cause, (causes.get(e.cause) ?? 0) + 1);
    if (e.type === 'explosion') {
      explosions++;
      if (e.chainDepth > 0) chained++;
    }
    if (e.type === 'pickupCollected') collected++;
    if (e.type === 'roundOver') {
      lengths.push(state.roundTicks / TICK_RATE);
      if (e.winner === null) draws++;
    }
  }
  if (events.length > 0 || ticks % 97 === 0) problems.push(...checkInvariants(state, cfg));
  if (state.phase === 'matchOver') rematch(state, cfg, seed + ticks);
}

const wall = (performance.now() - started) / 1000;
lengths.sort((a, b) => a - b);
const at = (p: number) => lengths[Math.min(lengths.length - 1, Math.floor(p * lengths.length))];
const inTarget = lengths.filter((l) => l >= 60 && l <= 180).length;
console.log(`rounds ${rounds} · draws ${draws} · ticks ${ticks}`);
console.log(
  `round length (s): min ${lengths[0].toFixed(1)} · median ${at(0.5).toFixed(1)} · p90 ${at(0.9).toFixed(1)} · max ${lengths[lengths.length - 1].toFixed(1)}`,
);
console.log(`rounds inside 60–180 s: ${Math.round((100 * inTarget) / lengths.length)}%`);
console.log(`deaths: ${[...causes].map(([cause, n]) => `${cause} ${n}`).join(' · ')}`);
console.log(
  `per round: ${(collected / rounds).toFixed(1)} pickups · ${(explosions / rounds).toFixed(1)} explosions (${chained} chained in total)`,
);
console.log(`speed: ${(ticks / TICK_RATE / wall).toFixed(0)}× real time (${wall.toFixed(1)} s wall clock)`);
if (problems.length > 0) {
  console.error(`${problems.length} invariant problems; first: ${problems.slice(0, 5).join(' | ')}`);
  process.exit(1);
}
