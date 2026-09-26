/**
 * Replays a match from a relay desync report and prints the confirmed hash at every checkpoint,
 * so the reported hashes can be matched to "which client diverged, and when".
 *
 *   pnpm replay <desync.json>            # the JSON log line the relay wrote (event "desync")
 *   pnpm replay <desync.json> --every 60 # checkpoint spacing (default 60, like the clients)
 *
 * The report holds the seed, the seat map, the input delay and the base64 input log. The replay
 * uses the same neutral-input contract as the clients: ticks before the first scheduled input
 * are neutral, and a seat with no frame for a tick (a ghost before the room noticed) is neutral.
 */
import { readFileSync } from 'node:fs';
import { decodeRelayed, RELAYED_FRAME_BYTES } from '../src/net/codec';
import { createMatch, DEFAULT_CONFIG, hashState, NO_INPUT, step, type PlayerInput } from '../src/sim';

const file = process.argv[2];
if (!file) {
  console.error('usage: pnpm replay <desync.json> [--every N]');
  process.exit(2);
}
const args = new Map<string, string>();
for (let i = 3; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1] ?? '');
const every = Number(args.get('every') ?? 60);

const report = JSON.parse(readFileSync(file, 'utf8')) as {
  tick: number;
  lastAgreed?: number;
  hashes: number[];
  seats: number[];
  seed: number;
  match: { seed: number; winsToWin: number; players: number; seats: number[]; inputDelay: number } | null;
  log: string;
};
if (!report.match) {
  console.error('the report has no match parameters');
  process.exit(2);
}
const { winsToWin, players, seats, inputDelay } = report.match;
const bytes = Uint8Array.from(Buffer.from(report.log, 'base64'));
if (bytes.length % RELAYED_FRAME_BYTES !== 0) {
  console.error(`log length ${bytes.length} is not a whole number of frames`);
  process.exit(2);
}
// inputs[tick][player]
const inputs = new Map<number, PlayerInput[]>();
let maxTick = 0;
for (let at = 0; at < bytes.length; at += RELAYED_FRAME_BYTES) {
  const f = decodeRelayed(bytes.subarray(at, at + RELAYED_FRAME_BYTES));
  if (!f) continue;
  const player = seats[f.player] ?? -1;
  if (player < 0) continue;
  let row = inputs.get(f.tick);
  if (!row) {
    row = Array.from({ length: players }, () => NO_INPUT);
    inputs.set(f.tick, row);
  }
  row[player] = f.input;
  if (f.tick > maxTick) maxTick = f.tick;
}
const cfg = { ...DEFAULT_CONFIG, winsToWin };
const state = createMatch(cfg, report.seed, players);
console.log(`seed ${report.seed} · ${players} players · seats ${JSON.stringify(seats)} · delay ${inputDelay} · frames ${bytes.length / RELAYED_FRAME_BYTES} · last tick ${maxTick}`);
console.log(`reported: tick ${report.tick} hashes ${report.hashes.map((h) => h.toString(16)).join(' vs ')} (seats ${JSON.stringify(report.seats)}) · last agreed ${report.lastAgreed ?? '?'}`);
const wanted = report.hashes.map((h) => h.toString(16));
for (let t = 1; t <= maxTick; t++) {
  const row = inputs.get(t) ?? Array.from({ length: players }, () => NO_INPUT);
  step(state, row, cfg);
  if (t % every === 0 || t === report.tick) {
    const h = hashState(state).toString(16);
    const mark = t === report.tick ? (wanted.includes(h) ? `  ← matches seat ${report.seats[wanted.indexOf(h)]}` : '  ← matches neither client') : '';
    console.log(`tick ${t}: ${h}${mark}`);
  }
}
