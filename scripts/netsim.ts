import { botInput, createBot, DEFAULT_CONFIG, hashState } from '../src/sim';
import { createLinkedSessions, type FakeLinkOptions } from '../src/net/fakeRelay';
import { inputDelayFor } from '../src/net/room';
import type { NetSession } from '../src/net/session';

/**
 * Two bot sessions through the fake relay at a network profile: how often the game stalls and
 * rolls back, and how deep. `pnpm netsim --profile hotspot`, or explicit `--rtt 150 --jitter 60
 * --spike 300 --spike-every 7000 --hold 250 --hold-every 4000 --seconds 300 --delay 2 --window 30`.
 * RTT is each player's round trip to the relay; the one-way latency between them is about the same.
 */
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1] ?? '');
const PROFILES: Record<string, { rtt: number; jitter: number; spike?: number; spikeEvery?: number; hold?: number; holdEvery?: number }> = {
  good: { rtt: 40, jitter: 10 },
  hotspot: { rtt: 150, jitter: 60, spike: 300, spikeEvery: 7000 },
  far: { rtt: 250, jitter: 40 },
  lossy: { rtt: 120, jitter: 40, hold: 300, holdEvery: 3000 },
};
const profile = PROFILES[args.get('profile') ?? 'good'] ?? PROFILES.good;
const num = (key: string, fallback: number | undefined) => (args.has(key) ? Number(args.get(key)) : fallback);
const rtt = num('rtt', profile.rtt)!;
const link: FakeLinkOptions = {
  latencyMs: rtt,
  jitterMs: num('jitter', profile.jitter)!,
  seed: num('seed', 1)!,
  spikeMs: num('spike', profile.spike),
  spikeEveryMs: num('spike-every', profile.spikeEvery),
  holdMs: num('hold', profile.hold),
  holdEveryMs: num('hold-every', profile.holdEvery),
};
const seconds = num('seconds', 300)!;
const players = Math.min(8, Math.max(2, num('players', 2)!));
const inputDelay = num('delay', inputDelayFor(rtt, rtt))!;
const maxRollback = num('window', undefined);
const cfg = { ...DEFAULT_CONFIG, winsToWin: 50 };

const hashes: Map<number, number>[] = Array.from({ length: players }, () => new Map());
const { link: fake, sessions } = createLinkedSessions(link, { seed: 7, cfg, players, inputDelay, ...(maxRollback ? { maxRollback } : {}) }, (side, tick, state) => {
  if (tick % 60 === 0) hashes[side].set(tick, hashState(state));
});
const bots = Array.from({ length: players }, (_, i) => createBot(3 + i));
const frames = Math.round(seconds * 60);
const depths: number[] = [];
const lastRollbacks = new Array<number>(players).fill(0);
const t0 = performance.now();
for (let f = 0; f < frames; f++) {
  sessions.forEach((s: NetSession, side) => {
    s.advance(botInput(bots[side], s.state, side, cfg));
    if (s.stats.rollbacks !== lastRollbacks[side]) {
      depths.push(s.stats.rollbackTicks);
      lastRollbacks[side] = s.stats.rollbacks;
    }
  });
  fake.advance(1000 / 60);
}
const wall = (performance.now() - t0) / 1000;

const shared = [...hashes[0].keys()].filter((t) => hashes.every((h) => h.has(t)));
const mismatches = shared.filter((t) => hashes.some((h) => h.get(t) !== hashes[0].get(t))).length;
const minutes = seconds / 60;
console.log(
  `profile: rtt ${rtt} ms ± ${link.jitterMs}` +
    (link.spikeMs ? `, spikes +${link.spikeMs} ms every ~${link.spikeEveryMs} ms` : '') +
    (link.holdMs ? `, holds ${link.holdMs} ms every ~${link.holdEveryMs} ms` : '') +
    ` · ${players} players · input delay ${inputDelay} · window ${sessions[0].maxRollback} · ${seconds} s (${wall.toFixed(1)} s wall)`,
);
sessions.forEach((s, side) => {
  const st = s.stats;
  const mean = st.rollbacks ? (st.rollbackTicks / st.rollbacks).toFixed(1) : '0';
  console.log(
    `side ${side}: stalls ${(st.stalledTicks / minutes).toFixed(1)} ticks/min (${st.stalledTicks} total) · rollbacks ${(st.rollbacks / minutes).toFixed(1)}/min, depth mean ${mean} max ${st.maxRollbackDepth} · late ${st.receivedLate}`,
  );
});
const ticksAtEnd = sessions.map((s) => s.tick);
console.log(`tick spread at the end: ${Math.max(...ticksAtEnd) - Math.min(...ticksAtEnd)} · hash checkpoints compared: ${shared.length}, mismatches: ${mismatches}`);
if (mismatches > 0) process.exit(1);
