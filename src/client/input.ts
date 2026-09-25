import type { PlayerInput } from '../sim';
import { BINDINGS, GAME_KEYS, inputFromKeys } from './keys';

/** Tracks held keys and latches Fire and Select presses between sim ticks. */
export class KeyboardInput {
  private readonly down = new Set<string>();
  private readonly useLatched = BINDINGS.map(() => false);
  private readonly selectLatched = BINDINGS.map(() => false);
  private readonly keyHandlers: Array<(code: string) => void> = [];
  private readonly blurHandlers: Array<() => void> = [];

  constructor(target: EventTarget) {
    target.addEventListener('keydown', (e) => this.onKeyDown(e as KeyboardEvent));
    target.addEventListener('keyup', (e) => this.down.delete((e as KeyboardEvent).code));
    target.addEventListener('blur', () => this.releaseAll());
  }

  /** Called for every fresh (non-repeat) key press. */
  onKey(handler: (code: string) => void): void {
    this.keyHandlers.push(handler);
  }

  /** Called when the window loses focus (after all keys are released). */
  onBlur(handler: () => void): void {
    this.blurHandlers.push(handler);
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** Inputs for one sim tick; consumes latched Fire and Select presses. */
  sample(): PlayerInput[] {
    const out = BINDINGS.map((b, i) => inputFromKeys(this.down, b, this.useLatched[i], this.selectLatched[i]));
    this.clearLatches();
    return out;
  }

  /**
   * Online, one person owns the keyboard: either hand steers the local snake. Both hands turning
   * different ways cancel out; Boost, Fire and Select come from either. Consumes both sets of latches.
   */
  sampleLocal(): PlayerInput {
    const a = inputFromKeys(this.down, BINDINGS[0], this.useLatched[0], this.selectLatched[0]);
    const b = inputFromKeys(this.down, BINDINGS[1], this.useLatched[1], this.selectLatched[1]);
    this.clearLatches();
    const turn = a.turn === 0 ? b.turn : b.turn === 0 || b.turn === a.turn ? a.turn : 0;
    return { turn, boost: a.boost || b.boost, use: a.use || b.use, select: a.select || b.select };
  }

  /** Forgets pending Fire and Select presses (pausing and resuming must not fire items). */
  clearLatches(): void {
    this.useLatched.fill(false);
    this.selectLatched.fill(false);
  }

  private onKeyDown(e: KeyboardEvent): void {
    const tag = (e.target as { tagName?: string } | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    BINDINGS.forEach((b, i) => {
      if (e.code === b.use) this.useLatched[i] = true;
      if (e.code === b.select) this.selectLatched[i] = true;
    });
    for (const handler of this.keyHandlers) handler(e.code);
  }

  private releaseAll(): void {
    this.down.clear();
    this.clearLatches();
    for (const handler of this.blurHandlers) handler();
  }
}
