import type { PlayerInput } from '../sim';

export interface Binding {
  left: string;
  right: string;
  boost: string;
  /** Fire: uses the selected item. */
  use: string;
  /** Select: moves the selection to the next carried item. */
  select: string;
}

/** Physical key codes (KeyboardEvent.code), so every keyboard layout works. */
export const BINDINGS: Binding[] = [
  { left: 'KeyA', right: 'KeyD', boost: 'KeyW', use: 'KeyS', select: 'KeyQ' },
  { left: 'ArrowLeft', right: 'ArrowRight', boost: 'ArrowUp', use: 'ArrowDown', select: 'ShiftRight' },
];

/** Keys whose browser default action (scrolling, typing) is suppressed. */
export const GAME_KEYS: ReadonlySet<string> = new Set([
  ...BINDINGS.flatMap((b) => [b.left, b.right, b.boost, b.use, b.select]),
  'Space',
  'Backquote',
  'Slash',
]);

export function inputFromKeys(down: ReadonlySet<string>, b: Binding, usePressed: boolean, selectPressed: boolean): PlayerInput {
  const left = down.has(b.left);
  const right = down.has(b.right);
  return { turn: left === right ? 0 : left ? -1 : 1, boost: down.has(b.boost), use: usePressed, select: selectPressed };
}
