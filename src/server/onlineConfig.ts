import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { validateOverrides, type Overrides } from '../sim/configSchema';

/**
 * The house rules: overrides on the defaults that every new online match starts with. Kept in
 * memory and, when a path is given, in a JSON file that survives restarts (written atomically).
 * Nothing is set until an admin publishes something.
 */
export class OnlineConfigStore {
  private overrides: Overrides = {};
  private updatedAt: string | null = null;

  constructor(
    private readonly path: string | null,
    private readonly log: (entry: Record<string, unknown>) => void = () => {},
  ) {
    this.load();
  }

  get(): Overrides {
    return { ...this.overrides };
  }

  get updated(): string | null {
    return this.updatedAt;
  }

  /** Replaces the house rules with `raw` (validated); returns what was rejected. */
  set(raw: unknown): { overrides: Overrides; problems: string[] } {
    const { overrides, problems } = validateOverrides(raw);
    this.overrides = overrides;
    this.updatedAt = new Date().toISOString();
    this.save();
    this.log({ event: 'houseRules', keys: Object.keys(overrides), rejected: problems.length });
    return { overrides: this.get(), problems };
  }

  clear(): void {
    this.set({});
  }

  private load(): void {
    if (!this.path) return;
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as { overrides?: unknown; updatedAt?: unknown };
      const { overrides, problems } = validateOverrides(raw.overrides ?? {});
      this.overrides = overrides;
      this.updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : null;
      if (problems.length > 0) this.log({ event: 'houseRulesFileProblems', problems });
    } catch (err) {
      // No file yet is the normal first run; anything else is worth a line.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.log({ event: 'houseRulesFileUnreadable', message: err instanceof Error ? err.message : String(err) });
    }
  }

  private save(): void {
    if (!this.path) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify({ overrides: this.overrides, updatedAt: this.updatedAt }, null, 2));
      renameSync(tmp, this.path);
    } catch (err) {
      this.log({ event: 'houseRulesFileWriteFailed', message: err instanceof Error ? err.message : String(err) });
    }
  }
}
