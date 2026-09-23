import {
  botInput,
  checkInvariants,
  createBot,
  createMatch,
  createOpponent,
  DEFAULT_CONFIG,
  DIFFICULTIES,
  opponentInput,
  rematch,
  step,
  TICK_RATE,
  type Config,
  type Difficulty,
  type MatchState,
  type PlayerInput,
} from '../src/sim';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const rounds = Number(args.get('rounds') ?? 100);
const seed = Number(args.get('seed') ?? 1);
const cfg = structuredClone(DEFAULT_CONFIG);

/** `--bots simple,hard` picks a driver per seat: the soak bot, or an AI opponent difficulty. */
type Driver = (state: MatchState, idx: number, cfg: Config) => PlayerInput;
const names = (args.get('bots') ?? 'simple,simple').split(',');
const drivers: Driver[] = names.map((name, i): Driver => {
  if (name === 'simple') {
    const bot = createBot(seed + 1 + i);
    return (state, idx, cfg) => botInput(bot, state, idx, cfg);
  }
  if (!(DIFFICULTIES as readonly string[]).includes(name)) {
    console.error(`unknown bot "${name}": use simple, ${DIFFICULTIES.join(', ')}`);
    process.exit(2);
  }
  const bot = createOpponent(name as Difficulty, seed + 1 + i);
  return (state, idx, cfg) => opponentInput(bot, state, idx, cfg);
});

const state = createMatch(cfg, seed);
const lengths: number[] = [];
const causes = new Map<string, number>();
const problems: string[] = [];
const wins = [0, 0];
let draws = 0;
let ticks = 0;
let explosions = 0;
let chained = 0;
let collected = 0;
const started = performance.now();

while (lengths.length < rounds) {
  const events = step(state, drivers.map((drive, i) => drive(state, i, cfg)), cfg);
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
      else wins[e.winner]++;
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
console.log(`wins: ${names[0]} ${wins[0]} · ${names[1]} ${wins[1]}`);
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
