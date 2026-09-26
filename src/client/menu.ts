/** The title screen's rows, top to bottom. */
export type MenuRow = 'local' | 'players' | 'wins' | 'create' | 'quick';

export const MENU_ROWS: readonly MenuRow[] = ['local', 'players', 'wins', 'create', 'quick'];

/** Moves the highlight up or down without wrapping. */
export function nextRow(row: MenuRow, delta: number): MenuRow {
  const i = Math.max(0, MENU_ROWS.indexOf(row));
  return MENU_ROWS[Math.min(MENU_ROWS.length - 1, Math.max(0, i + Math.sign(delta)))];
}
