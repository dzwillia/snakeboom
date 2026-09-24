import { describe, expect, it } from 'vitest';
import { Hud } from './hud';

/** Just enough DOM for the HUD: innerHTML is parsed into named elements by class. */
function fakeRoot(): HTMLElement {
  const els = new Map<string, { textContent: string; className: string; innerHTML: string; style: Record<string, string> }>();
  const el = (cls: string) => {
    if (!els.has(cls)) els.set(cls, { textContent: '', className: cls, innerHTML: '', style: {} });
    return els.get(cls)!;
  };
  return {
    innerHTML: '',
    classList: { toggle: () => false },
    querySelector: (sel: string) => el(sel.replace('.', '')),
    querySelectorAll: (sel: string) =>
      sel === '.side' ? [{ querySelector: (s: string) => el(`side0${s}`) }, { querySelector: (s: string) => el(`side1${s}`) }] : [el('name0'), el('name1')],
  } as unknown as HTMLElement;
}

describe('Hud net readout', () => {
  // Review Focus 4 (M8): the readout shows exactly the numbers it is given.
  it('renders the readout line and hides on null', () => {
    const root = fakeRoot();
    const hud = new Hud(root);
    const net = root.querySelector('.net')!;
    hud.setNet({ inputDelay: 2, rollbacksPerMin: 3.25, maxRollbackDepth: 6, stallsPerMin: 0, lead: 0.42, timeScale: 1 });
    expect(net.textContent).toBe('delay 2 · rb 3.3/min (max 6) · stall 0.0/min · lead +0.4 · ×1.000');
    hud.setNet({ inputDelay: 2, rollbacksPerMin: 0, maxRollbackDepth: 6, stallsPerMin: 12, lead: -1.5, timeScale: 0.99 });
    expect(net.textContent).toContain('lead -1.5 · ×0.990');
    hud.setNet(null);
    expect(net.textContent).toBe('');
  });
});
