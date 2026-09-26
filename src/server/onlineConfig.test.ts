import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OnlineConfigStore } from './onlineConfig';

describe('OnlineConfigStore', () => {
  const dirs: string[] = [];
  const dir = () => {
    const d = mkdtempSync(join(tmpdir(), 'snakeboom-rules-'));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('starts empty, validates what it is given, and reports the rest', () => {
    const store = new OnlineConfigStore(null);
    expect(store.get()).toEqual({});
    expect(store.updated).toBeNull();
    const { overrides, problems } = store.set({ hearts: 3, baseSpeed: 5, nope: 1 });
    expect(overrides).toEqual({ hearts: 3 });
    expect(problems).toHaveLength(2);
    expect(store.get()).toEqual({ hearts: 3 });
    expect(store.updated).toMatch(/^\d{4}-/);
    store.clear();
    expect(store.get()).toEqual({});
  });

  it('persists to its file and reads it back on the next start, ignoring junk in it', () => {
    const path = join(dir(), 'nested', 'config.json');
    const a = new OnlineConfigStore(path);
    a.set({ hearts: 2, maps: 'random' });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ overrides: { hearts: 2, maps: 'random' } });
    const b = new OnlineConfigStore(path);
    expect(b.get()).toEqual({ hearts: 2, maps: 'random' });
    expect(b.updated).toBe(a.updated);
    // Junk written by hand is dropped, not fatal.
    const logs: Record<string, unknown>[] = [];
    const c = new OnlineConfigStore(path, (e) => logs.push(e));
    c.set({ hearts: 9 });
    expect(c.get()).toEqual({});
    expect(logs.at(-1)).toMatchObject({ event: 'houseRules', rejected: 1 });
  });

  it('copies on get, so callers cannot edit the rules in place', () => {
    const store = new OnlineConfigStore(null);
    store.set({ hearts: 3 });
    const got = store.get();
    got.hearts = 5;
    expect(store.get()).toEqual({ hearts: 3 });
  });
});
