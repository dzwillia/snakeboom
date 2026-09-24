import type { PlayerInput } from '../sim';

export interface Binding {
  left: string;
  right: string;
  boost: string;
  use: string;
}

/** Physical key codes (KeyboardEvent.code), so every keyboard layout works. */
export const BINDINGS: Binding[] = [
  { left: 'KeyA', right: 'KeyD', boost: 'KeyW', use: 'KeyS' },
  { left: 'ArrowLeft', right: 'ArrowRight', boost: 'ArrowUp', use: 'ArrowDown' },
];

/** Keys whose browser default action (scrolling, typing) is suppressed. */
export const GAME_KEYS: ReadonlySet<string> = new Set([
  ...BINDINGS.flatMap((b) => [b.left, b.right, b.boost, b.use]),
  'Space',
  'Backquote',
  'Slash',
]);

export function inputFromKeys(down: ReadonlySet<string>, b: Binding, usePressed: boolean): PlayerInput {
  const left = down.has(b.left);
  const right = down.has(b.right);
  return { turn: left === right ? 0 : left ? -1 : 1, boost: down.has(b.boost), use: usePressed };
}
