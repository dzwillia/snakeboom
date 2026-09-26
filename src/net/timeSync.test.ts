import { describe, expect, it } from 'vitest';
import { botInput, createBot, DEFAULT_CONFIG, NO_INPUT, type BotState } from '../sim';
import { createLinkedSessions } from './fakeRelay';
import { smoothLead, timeScaleFor } from './timeSync';

const cfg = { ...DEFAULT_CONFIG, winsToWin: 50 };
const FRAME_MS = 1000 / 60;

describe('timeScaleFor', () => {
  it('is exactly 1 inside the deadband and never beyond 2% either way', () => {
    expect(timeScaleFor(0)).toBe(1);
    expect(timeScaleFor(1)).toBe(1);
    expect(timeScaleFor(-1)).toBe(1);
    expect(timeScaleFor(2)).toBeCloseTo(0.99, 6);
    expect(timeScaleFor(-2)).toBeCloseTo(1.01, 6);
    expect(timeScaleFor(50)).toBe(0.98);
    expect(timeScaleFor(-50)).toBe(1.02);
  });

  it('smooths lead samples', () => {
    expect(smoothLead(null, 8)).toBe(8);
    expect(smoothLead(8, 0)).toBeCloseTo(7.2, 6);
  });
});

// M8 Review Focus 2: two peers started 8 ticks apart converge without oscillating.
describe('time sync between two sessions', () => {
  it('closes an 8-tick gap gently and keeps it closed', () => {
    const { link, sessions } = createLinkedSessions({ latencyMs: 40, jitterMs: 10, seed: 3 }, { seed: 5, cfg, inputDelay: 2, oneWayTicks: 40 / FRAME_MS });
    const bots: [BotState, BotState] = [createBot(1), createBot(2)];
    for (let i = 0; i < 8; i++) sessions[0].advance(NO_INPUT);
    const acc = [0, 0];
    const scales: number[] = [];
    let closedAt = -1;
    for (let f = 0; f < 2400; f++) {
      sessions.forEach((s, side) => {
        const scale = timeScaleFor(s.smoothedLead);
        scales.push(scale);
        acc[side] += FRAME_MS * scale;
        while (acc[side] >= FRAME_MS) {
          s.advance(botInput(bots[side], s.state, side, cfg));
          acc[side] -= FRAME_MS;
        }
      });
      link.advance(FRAME_MS);
      const gap = Math.abs(sessions[0].tick - sessions[1].tick);
      if (closedAt < 0 && gap <= 1) closedAt = f;
      if (closedAt >= 0 && f > closedAt + 120) expect(gap).toBeLessThanOrEqual(2);
    }
    expect(closedAt).toBeGreaterThan(0);
    expect(closedAt).toBeLessThan(600);
    expect(Math.min(...scales)).toBeGreaterThanOrEqual(0.98);
    expect(Math.max(...scales)).toBeLessThanOrEqual(1.02);
  });
});
