import type { SimEvent } from '../sim';
import type { TaggedEvent } from './session';

/** Events that drive the death beat, banners and scores: played only once their tick is confirmed. */
export const FLOW_EVENTS: ReadonlySet<SimEvent['type']> = new Set<SimEvent['type']>([
  'countdown',
  'go',
  'overtime',
  'death',
  'roundOver',
  'matchOver',
]);

export function isFlowEvent(event: SimEvent): boolean {
  return FLOW_EVENTS.has(event.type);
}

function eventKey(event: SimEvent): string {
  const e = event as Record<string, unknown>;
  const parts: string[] = [event.type];
  for (const field of ['player', 'id', 'n', 'effect', 'kind', 'x', 'y']) {
    if (field in e) parts.push(String(e[field]));
  }
  return parts.join(':');
}

const KEEP_TICKS = 600;

/**
 * Decides which tagged events to act on. Cosmetic events (sparks, sounds) play the first time
 * their tick is simulated, so a rollback never replays them. Flow events wait for confirmation,
 * so a mispredicted death is never shown.
 */
export class EventGate {
  private readonly seen = new Map<number, Set<string>>();

  /** The events to play, in order. Remembers them so a re-simulation returns nothing new. */
  filter(events: readonly TaggedEvent[]): SimEvent[] {
    const out: SimEvent[] = [];
    for (const { tick, event, confirmed } of events) {
      if (isFlowEvent(event) && !confirmed) continue;
      let keys = this.seen.get(tick);
      if (!keys) {
        keys = new Set();
        this.seen.set(tick, keys);
      }
      const key = eventKey(event);
      if (keys.has(key)) continue;
      keys.add(key);
      out.push(event);
    }
    return out;
  }

  /** Forgets ticks older than `tick − 600`. */
  prune(tick: number): void {
    const cutoff = tick - KEEP_TICKS;
    for (const t of this.seen.keys()) if (t < cutoff) this.seen.delete(t);
  }
}
