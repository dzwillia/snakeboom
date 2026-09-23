/** Throttles rapid repeats of the same sound so chain reactions and scraping don't stack into noise. */
export class SoundGate {
  private readonly last = new Map<string, number>();

  constructor(
    private readonly gapsMs: Readonly<Record<string, number>> = {},
    private readonly defaultGapMs = 40,
  ) {}

  /** True if `name` may play at `nowMs` (and records the play). */
  allow(name: string, nowMs: number): boolean {
    const gap = this.gapsMs[name] ?? this.defaultGapMs;
    const prev = this.last.get(name);
    if (prev !== undefined && nowMs - prev < gap) return false;
    this.last.set(name, nowMs);
    return true;
  }
}
