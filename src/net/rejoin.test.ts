import { describe, expect, it } from 'vitest';
import { botInput, createBot, DEFAULT_CONFIG, hashState, type BotState } from '../sim';
import { createLinkedSessions, type FakeLink } from './fakeRelay';
import { NetSession } from './session';

const FRAME_MS = 1000 / 60;
const cfg = { ...DEFAULT_CONFIG, winsToWin: 2 };

/** One bot tick per side per frame, recording confirmed hashes every second. */
function run(link: FakeLink, sessions: NetSession[], bots: BotState[], frames: number): void {
  for (let f = 0; f < frames; f++) {
    sessions.forEach((s, side) => s.advance(botInput(bots[side], s.state, side, cfg)));
    link.advance(FRAME_MS);
  }
}

// Review Focus 1: a session rebuilt from the log is the session.
describe('rejoin from the relay log', () => {
  it('rebuilds seat 1 from the log to the same hashes, then keeps agreeing live', () => {
    const hashes: Map<number, number>[] = [new Map(), new Map()];
    const { link, sessions } = createLinkedSessions({ latencyMs: 40, jitterMs: 20, seed: 4 }, { seed: 99, cfg, inputDelay: 2 }, (side, tick, state) => {
      if (tick % 60 === 0) hashes[side].set(tick, hashState(state));
    });
    const bots: BotState[] = [createBot(1), createBot(2)];
    run(link, sessions, bots, 1500);
    const original = sessions[1];

    // Seat 1's tab refreshes: a fresh session fed only from the relay's log.
    const rebuiltHashes = new Map<number, number>();
    const fresh = new NetSession({
      seed: 99,
      cfg,
      local: 1,
      inputDelay: 2,
      send: (tick, input) => link.enqueue(1, tick, input),
      onConfirmed: (tick, state) => {
        if (tick % 60 === 0) rebuiltHashes.set(tick, hashState(state));
      },
    });
    for (const entry of link.sent) {
      if (entry.from === 1) fresh.restoreLocal(entry.tick, entry.input);
      else fresh.receive(entry.from, entry.tick, entry.input);
    }
    expect(fresh.behind).toBe(true);
    let slices = 0;
    while (fresh.catchUp(300) > 0) slices++;
    expect(slices).toBeGreaterThan(3);
    expect(fresh.confirmedTick).toBeGreaterThanOrEqual(original.confirmedTick - 2);
    expect(fresh.tick).toBe(fresh.confirmedTick);
    expect(fresh.behind).toBe(false);
    // The log also holds packets still in flight to the old session, so the rebuild may know a
    // little more than the original did; compare every tick both of them recorded.
    const shared0 = [...rebuiltHashes.keys()].filter((t) => hashes[1].has(t));
    expect(shared0.length).toBeGreaterThan(20);
    for (const tick of shared0) expect(rebuiltHashes.get(tick)?.toString(16)).toBe(hashes[1].get(tick)?.toString(16));
    expect(link.sent.length).toBeGreaterThan(0);
    const sentBefore = link.sent.length;

    // Back in the game: the fresh session replaces the old one on the link.
    const live: [NetSession, NetSession] = [sessions[0], fresh];
    link.attach(live);
    const after: [Map<number, number>, Map<number, number>] = [new Map(), new Map()];
    (sessions[0] as unknown as { onConfirmed: (t: number, s: unknown) => void }).onConfirmed = (t, s) => {
      if (t % 60 === 0) after[0].set(t, hashState(s as Parameters<typeof hashState>[0]));
    };
    (fresh as unknown as { onConfirmed: (t: number, s: unknown) => void }).onConfirmed = (t, s) => {
      if (t % 60 === 0) after[1].set(t, hashState(s as Parameters<typeof hashState>[0]));
    };
    run(link, live, [bots[0], createBot(3)], 600);
    expect(link.sent.length).toBeGreaterThan(sentBefore);
    const shared = [...after[0].keys()].filter((t) => after[1].has(t));
    expect(shared.length).toBeGreaterThan(5);
    for (const t of shared) expect(after[0].get(t)?.toString(16)).toBe(after[1].get(t)?.toString(16));
    expect(fresh.stats.stalledTicks).toBe(0);
  });

  it('restores local inputs without sending and ignores confirmed ticks', () => {
    const sends: number[] = [];
    const s = new NetSession({ seed: 1, cfg, local: 0, inputDelay: 2, send: (t) => sends.push(t) });
    s.restoreLocal(2, { turn: 1, boost: false, use: false, select: false });
    s.restoreLocal(3, { turn: 1, boost: false, use: false, select: false });
    s.receive(1, 1, { turn: 0, boost: false, use: false, select: false });
    s.receive(1, 2, { turn: 0, boost: false, use: false, select: false });
    expect(s.catchUp(10)).toBe(2);
    expect(sends).toEqual([]);
    expect(s.confirmedTick).toBe(2);
    s.restoreLocal(1, { turn: -1, boost: true, use: true, select: false });
    expect(s.catchUp(10)).toBe(0);
    s.advance({ turn: 0, boost: false, use: false, select: false });
    expect(sends).toEqual([4]);
  });
});
