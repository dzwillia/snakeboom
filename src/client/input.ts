import type { PlayerInput } from '../sim';
import { BINDINGS, GAME_KEYS, inputFromKeys } from './keys';

/** Tracks held keys and latches Use presses between sim ticks. */
export class KeyboardInput {
  private readonly down = new Set<string>();
  private readonly useLatched = BINDINGS.map(() => false);
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

  /** Inputs for one sim tick; consumes latched Use presses. */
  sample(): PlayerInput[] {
    const out = BINDINGS.map((b, i) => inputFromKeys(this.down, b, this.useLatched[i]));
    this.useLatched.fill(false);
    return out;
  }

  private onKeyDown(e: KeyboardEvent): void {
    const tag = (e.target as { tagName?: string } | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    BINDINGS.forEach((b, i) => {
      if (e.code === b.use) this.useLatched[i] = true;
    });
    for (const handler of this.keyHandlers) handler(e.code);
  }

  private releaseAll(): void {
    this.down.clear();
    this.useLatched.fill(false);
    for (const handler of this.blurHandlers) handler();
  }
}
