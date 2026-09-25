import { describe, expect, it } from 'vitest';
import { botInput, createBot, DEFAULT_CONFIG, hashState, NO_INPUT, type BotState, type PlayerInput } from '../sim';
import { EventGate } from './events';
import { createLinkedSessions, type FakeLink, type FakeLinkOptions } from './fakeRelay';
import { emptyStats, NetSession, statsDelta } from './session';

const FRAME_MS = 1000 / 60;
const cfg = { ...DEFAULT_CONFIG, winsToWin: 2 };

interface Run {
  hashes: [Map<number, number>, Map<number, number>];
  roundOvers: [number, number];
  gated: [number, number];
  sends: [{ calls: number; ticks: Set<number> }, { calls: number; ticks: Set<number> }];
}

function makeRun(): Run {
  return {
    hashes: [new Map(), new Map()],
    roundOvers: [0, 0],
    gated: [0, 0],
    sends: [
      { calls: 0, ticks: new Set() },
      { calls: 0, ticks: new Set() },
    ],
  };
}

/** Both sides play one bot each, one tick per 60 Hz frame, recording confirmed hashes every second and at round ends. */
function runFrames(
  link: FakeLink,
  sessions: [NetSession, NetSession],
  bots: [BotState, BotState],
  frames: number,
  run: Run,
  gates: [EventGate, EventGate],
  onFrame?: (frame: number) => void,
): void {
  for (let f = 0; f < frames; f++) {
    onFrame?.(f);
    sessions.forEach((s, side) => {
      const input = botInput(bots[side], s.state, side, cfg);
      const events = s.advance(input);
      for (const e of events) if (e.event.type === 'roundOver' && e.confirmed) run.roundOvers[side]++;
      run.gated[side] += gates[side].filter(events).filter((e) => e.type === 'roundOver').length;
    });
    link.advance(FRAME_MS);
  }
}

function sharedTicks(run: Run): number[] {
  return [...run.hashes[0].keys()].filter((t) => run.hashes[1].has(t)).sort((a, b) => a - b);
}

function expectAgreement(run: Run, minShared: number): void {
  const shared = sharedTicks(run);
  expect(shared.length).toBeGreaterThanOrEqual(minShared);
  expect(shared.length).toBe(run.hashes[0].size);
  expect(shared.length).toBe(run.hashes[1].size);
  for (const t of shared) expect(run.hashes[0].get(t)?.toString(16)).toBe(run.hashes[1].get(t)?.toString(16));
}

function setup(latencyMs: number, jitterMs: number, inputDelay: number, seed = 1, extra: Partial<FakeLinkOptions> = {}) {
  const run = makeRun();
  const { link, sessions } = createLinkedSessions({ latencyMs, jitterMs, seed, ...extra }, { seed: 4242, cfg, inputDelay }, (side, tick, state, events) => {
    if (tick % 60 === 0 || events.some((e) => e.type === 'roundOver')) run.hashes[side].set(tick, hashState(state));
  });
  const wrapSend = (s: NetSession, side: number) => {
    const original = (s as unknown as { send: (tick: number, input: PlayerInput) => void }).send;
    (s as unknown as { send: (tick: number, input: PlayerInput) => void }).send = (tick, input) => {
      run.sends[side].calls++;
      run.sends[side].ticks.add(tick);
      original(tick, input);
    };
  };
  sessions.forEach(wrapSend);
  const bots: [BotState, BotState] = [createBot(7), createBot(8)];
  const gates: [EventGate, EventGate] = [new EventGate(), new EventGate()];
  return { run, link, sessions, bots, gates };
}

// Each of these simulates thousands of frames of two sessions with bots, 1–2 s on a laptop and
// several times that on a shared CI runner, so they get a timeout to match.
const RELAY_TEST_TIMEOUT = 60000;

describe('NetSession through a fake relay', () => {
  it('agrees on every confirmed hash at 40 ms ± 20 ms with two ticks of input delay', () => {
    const { run, link, sessions, bots, gates } = setup(40, 20, 2);
    runFrames(link, sessions, bots, 3000, run, gates);
    expectAgreement(run, 40);
    expect(sessions[0].stats.stalledTicks + sessions[1].stats.stalledTicks).toBe(0);
    expect(sessions[0].stats.rollbacks + sessions[1].stats.rollbacks).toBeGreaterThan(0);
    expect(run.roundOvers[0]).toBeGreaterThan(0);
    // Review Focus 4 (M8): the counters are consistent with each other.
    for (const s of sessions) {
      expect(s.stats.ticks).toBe(3000);
      // A rollback can have depth 0 (the mismatched tick was confirmed in the same reconcile).
      expect(s.stats.rollbackTicks).toBeLessThanOrEqual(s.stats.rollbacks * s.maxRollback);
      expect(s.stats.receivedLate).toBeGreaterThanOrEqual(s.stats.rollbacks);
      expect(s.stats.maxRollbackDepth).toBeGreaterThan(0);
    }
  }, RELAY_TEST_TIMEOUT);

  it('still agrees when packets overtake each other at 100 ms ± 60 ms', () => {
    const { run, link, sessions, bots, gates } = setup(100, 60, 3, 9);
    runFrames(link, sessions, bots, 3000, run, gates);
    expectAgreement(run, 30);
    for (const s of sessions) expect(s.stats.maxRollbackDepth).toBeLessThanOrEqual(s.maxRollback);
  }, RELAY_TEST_TIMEOUT);

  // M8 Review Focus 1: a hotspot (150 ± 60 ms one-way with 300 ms spikes) must not stall.
  it('rides out hotspot jitter spikes without stalling, within the rollback window', () => {
    const { run, link, sessions, bots, gates } = setup(150, 60, 2, 11, { spikeMs: 300, spikeEveryMs: 7000 });
    runFrames(link, sessions, bots, 3000, run, gates);
    expectAgreement(run, 30);
    for (const s of sessions) {
      expect(s.stats.stalledTicks).toBe(0);
      expect(s.stats.maxRollbackDepth).toBeLessThanOrEqual(s.maxRollback);
      expect(s.stats.maxRollbackDepth).toBeGreaterThan(12);
    }
  }, RELAY_TEST_TIMEOUT);

  it('survives TCP-style holds (packets bunched and released in order) with agreeing hashes', () => {
    const { run, link, sessions, bots, gates } = setup(80, 20, 2, 12, { holdMs: 250, holdEveryMs: 4000 });
    runFrames(link, sessions, bots, 3000, run, gates);
    expectAgreement(run, 30);
    for (const s of sessions) expect(s.stats.maxRollbackDepth).toBeLessThanOrEqual(s.maxRollback);
  }, RELAY_TEST_TIMEOUT);

  it('never rolls back or stalls when inputs arrive before they are needed', () => {
    const { run, link, sessions, bots, gates } = setup(0, 0, 2);
    runFrames(link, sessions, bots, 1200, run, gates);
    expectAgreement(run, 15);
    for (const s of sessions) {
      expect(s.stats.rollbacks).toBe(0);
      expect(s.stats.stalledTicks).toBe(0);
    }
  }, RELAY_TEST_TIMEOUT);

  // Review Focus 3: a quiet remote stalls the game within the rollback window, and play resumes cleanly.
  it('stalls while one side is silent, resumes, and sends each local tick exactly once', () => {
    const { run, link, sessions, bots, gates } = setup(40, 20, 2, 3);
    let stalledAt = -1;
    runFrames(link, sessions, bots, 2000, run, gates, (f) => {
      if (f === 600) link.pause(1, true);
      if (f === 780) link.pause(1, false);
      if (f > 600 && f < 780 && stalledAt < 0 && sessions[0].stalled) stalledAt = f;
    });
    expect(stalledAt).toBeGreaterThan(600);
    // Packets already in flight when the pause starts still arrive, so allow a few frames of slack.
    expect(stalledAt).toBeLessThanOrEqual(600 + sessions[0].maxRollback + 4);
    expect(sessions[0].stats.stalledTicks).toBeGreaterThan(100);
    expect(sessions[0].stalled).toBe(false);
    expect(sessions[1].stalled).toBe(false);
    expectAgreement(run, 25);
    for (const side of [0, 1]) expect(run.sends[side].calls).toBe(run.sends[side].ticks.size);
    // The silent side kept stepping until it ran out of inputs, so it ends up ahead; the client's
    // time sync (slowing the side with a positive lead) is what closes that gap, not the session.
    expect(sessions[1].tick).toBeGreaterThan(sessions[0].tick);
    expect(sessions[1].lead(2)).toBeGreaterThanOrEqual(1);
  }, RELAY_TEST_TIMEOUT);

  // Review Focus 2: flow events reach the gate once, and only when confirmed.
  it('lets each round end through the gate exactly once', () => {
    const { run, link, sessions, bots, gates } = setup(60, 30, 2, 5);
    runFrames(link, sessions, bots, 3000, run, gates);
    expect(run.roundOvers[0]).toBeGreaterThan(0);
    expect(run.gated).toEqual(run.roundOvers);
  }, RELAY_TEST_TIMEOUT);
});

describe('NetSession bookkeeping', () => {
  const make = (inputDelay: number, sends: number[] = []) =>
    new NetSession({ seed: 1, cfg, local: 0, inputDelay, send: (tick) => sends.push(tick) });

  it('schedules local inputs inputDelay ticks ahead and pre-fills the gap', () => {
    const sends: number[] = [];
    const s = make(3, sends);
    s.advance(NO_INPUT);
    s.advance(NO_INPUT);
    expect(sends).toEqual([3, 4]);
    expect(s.tick).toBe(2);
  });

  it('estimates its lead over the peer', () => {
    const s = make(2);
    for (let t = 1; t <= 100; t++) s.receive(t, NO_INPUT);
    for (let i = 0; i < 102; i++) s.advance(NO_INPUT);
    expect(s.tick).toBe(102);
    expect(s.confirmedTick).toBe(100);
    expect(s.remoteTickSeen).toBe(100);
    expect(s.lead(2)).toBe(2);
    expect(make(2).lead(2)).toBe(0);
  });

  it('ignores duplicates and inputs for ticks it has already confirmed', () => {
    const s = make(1);
    s.receive(1, { turn: 1, boost: false, use: false });
    s.receive(1, { turn: -1, boost: false, use: false });
    s.advance(NO_INPUT);
    expect(s.confirmedTick).toBe(0);
    expect(s.tick).toBe(1);
    s.advance(NO_INPUT);
    expect(s.confirmedTick).toBe(1);
    expect(s.confirmedState.snakes[1].heading).toBe(s.state.snakes[1].heading);
    s.receive(1, { turn: -1, boost: true, use: true });
    s.receive(0, NO_INPUT);
    s.receive(-5, NO_INPUT);
    s.advance(NO_INPUT);
    expect(s.stats.rollbacks).toBe(0);
  });

  // M8 Task 4: a wrong guess about the remote reports a head correction for that seat only.
  it('reports a correction for the remote head after a misprediction, not the local one', () => {
    const s = make(1);
    for (let t = 1; t <= 240; t++) s.receive(t, NO_INPUT);
    for (let i = 0; i < 250; i++) s.advance(NO_INPUT);
    expect(s.confirmedTick).toBe(240);
    expect(s.state.phase).toBe('playing');
    expect(s.takeCorrections()).toEqual([]);
    s.receive(245, { turn: 1, boost: true, use: false });
    s.advance(NO_INPUT);
    const corrections = s.takeCorrections();
    expect(corrections.map((c) => c.player)).toEqual([1]);
    expect(Math.hypot(corrections[0].dx, corrections[0].dy)).toBeGreaterThan(0.5);
    expect(s.takeCorrections()).toEqual([]);
  });

  it('rejects a bad seat or delay', () => {
    expect(() => new NetSession({ seed: 1, cfg, local: 2, inputDelay: 1, send: () => {} })).toThrow(RangeError);
    expect(() => new NetSession({ seed: 1, cfg, local: 0, inputDelay: 0, send: () => {} })).toThrow(RangeError);
  });
});

describe('statsDelta', () => {
  it('subtracts counters and keeps the later max depth', () => {
    const earlier = { ...emptyStats(), ticks: 100, rollbacks: 2, rollbackTicks: 5, stalledTicks: 3, receivedLate: 4, maxRollbackDepth: 3 };
    const later = { ticks: 160, rollbacks: 5, rollbackTicks: 12, stalledTicks: 3, receivedLate: 9, maxRollbackDepth: 6 };
    expect(statsDelta(later, earlier)).toEqual({ ticks: 60, rollbacks: 3, rollbackTicks: 7, stalledTicks: 0, receivedLate: 5, maxRollbackDepth: 6 });
  });
});
