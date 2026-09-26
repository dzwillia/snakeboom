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
  type OpponentProfile,
  type OpponentState,
  type PlayerInput,
} from '../src/sim';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const rounds = Number(args.get('rounds') ?? 100);
const seed = Number(args.get('seed') ?? 1);
const cfg = structuredClone(DEFAULT_CONFIG);

/**
 * `--bots simple,hard` picks a driver per seat: the soak bot, or an AI opponent difficulty.
 * `--profile '{"aggression":0}'` overrides knobs on the first AI seat (to try tuning without editing code).
 */
type Driver = (state: MatchState, idx: number, cfg: Config) => PlayerInput;
/** `--players 8` seats that many; `--bots` names fill the seats in order and the last name repeats. */
const players = Math.min(8, Math.max(2, Number(args.get('players') ?? 2)));
const given = (args.get('bots') ?? 'simple,simple').split(',');
const names = Array.from({ length: players }, (_, i) => given[Math.min(i, given.length - 1)]);
const override = JSON.parse(args.get('profile') ?? '{}') as Partial<OpponentProfile>;
let overrideLeft = 1;
const ais: Array<OpponentState | null> = [];
const drivers: Driver[] = names.map((name, i): Driver => {
  if (name === 'simple') {
    const bot = createBot(seed + 1 + i);
    ais.push(null);
    return (state, idx, cfg) => botInput(bot, state, idx, cfg);
  }
  if (!(DIFFICULTIES as readonly string[]).includes(name)) {
    console.error(`unknown bot "${name}": use simple, ${DIFFICULTIES.join(', ')}`);
    process.exit(2);
  }
  const bot = createOpponent(name as Difficulty, seed + 1 + i, overrideLeft-- > 0 ? override : undefined);
  ais.push(bot);
  return (state, idx, cfg) => opponentInput(bot, state, idx, cfg);
});

const state = createMatch(cfg, seed, players);
const lengths: number[] = [];
const causes = new Map<string, number>();
const problems: string[] = [];
const wins = new Array<number>(players).fill(0);
/** Deaths and heart losses each seat inflicted on the other (body, head-on, missile, encircled). */
const kills = new Array<number>(players).fill(0);
const hits = new Array<number>(players).fill(0);
/** Deaths and heart losses each seat brought on itself (walls, blocks). */
const ownGoals = new Array<number>(players).fill(0);
let draws = 0;
let ticks = 0;
let missileHits = 0;
let missilesFired = 0;
let collected = 0;
const started = performance.now();

/** The first AI seat's plan-clear steps over the last 40 ticks, newest last (for --debug). */
const clearHistory: number[] = [];
while (lengths.length < rounds) {
  const events = step(state, drivers.map((drive, i) => drive(state, i, cfg)), cfg);
  ticks++;
  if (ais[0]) {
    clearHistory.push(ais[0].lastSteps);
    if (clearHistory.length > 40) clearHistory.shift();
  }
  for (const e of events) {
    if (e.type === 'death' || e.type === 'heartLost') {
      const key = `${names[e.player]}:${e.cause}`;
      causes.set(key, (causes.get(key) ?? 0) + 1);
      const byOpponent = e.type === 'death' ? e.killer === 1 : e.cause === 'body' || e.cause === 'headOn' || e.cause === 'missile';
      if (args.has('debug') && e.player === 0 && !byOpponent) {
        const s = state.snakes[0];
        const fx = Object.entries(s.effects).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`);
        const other = state.snakes[1];
        console.log(
          `  [round ${state.round} t=${state.roundTicks}] ${names[0]} ${e.type} ${e.cause} at (${Math.round(s.x)},${Math.round(s.y)}) ` +
            `${s.boosting ? 'boosting ' : ''}effects[${fx.join(' ')}] map ${state.mapIndex} (${state.mapName}) opp-dozer ${other.effects.dozer} ` +
            `plan-clear last 40 ticks: ${clearHistory.join(' ')}`,
        );
      }
    }
    if (e.type === 'death') {
      if (e.killer !== null && e.killer !== e.player) kills[e.killer]++;
      else ownGoals[e.player]++;
    }
    if (e.type === 'heartLost') {
      if (players === 2 && (e.cause === 'body' || e.cause === 'headOn' || e.cause === 'missile')) hits[1 - e.player]++;
      else ownGoals[e.player]++;
    }
    if (e.type === 'missileFired') missilesFired++;
    if (e.type === 'missileHit') {
      missileHits++;
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
console.log(`wins: ${names.map((n, i) => `${n}#${i} ${wins[i]}`).join(' · ')}`);
console.log(`points: ${state.scores.map((s, i) => `${names[i]}#${i} ${s}`).join(' · ')} (this match)`);
console.log(
  `kills inflicted: ${names.map((n, i) => `${n}#${i} ${kills[i]} (+${hits[i]} hearts)`).join(' · ')} · self-inflicted: ${ownGoals.join(' / ')}`,
);
console.log(
  `round length (s): min ${lengths[0].toFixed(1)} · median ${at(0.5).toFixed(1)} · p90 ${at(0.9).toFixed(1)} · max ${lengths[lengths.length - 1].toFixed(1)}`,
);
console.log(`rounds inside 60–180 s: ${Math.round((100 * inTarget) / lengths.length)}%`);
console.log(`hits taken (deaths + hearts): ${[...causes].sort().map(([cause, n]) => `${cause} ${n}`).join(' · ')}`);
console.log(
  `per round: ${(collected / rounds).toFixed(1)} pickups · ${(missilesFired / rounds).toFixed(1)} missiles fired, ${missileHits} hits in total`,
);
console.log(`speed: ${(ticks / TICK_RATE / wall).toFixed(0)}× real time (${wall.toFixed(1)} s wall clock)`);
if (problems.length > 0) {
  console.error(`${problems.length} invariant problems; first: ${problems.slice(0, 5).join(' | ')}`);
  process.exit(1);
}
