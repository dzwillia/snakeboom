import { TICK_RATE, type Config, type MatchState, type SnakeState } from '../sim';
import { PLAYER_NAMES, describeItem, formatClock } from './text';

interface Side {
  pips: HTMLElement;
  fill: HTMLElement;
  slots: HTMLElement;
  lastSlots: string;
}

/** Top bar: names, score pips, boost meters, item queues (plus Shield bubble) and the round clock. */
export class Hud {
  private readonly sides: Side[];
  private readonly clock: HTMLElement;
  private lastPips = '';
  private lastClock = '';

  constructor(private readonly root: HTMLElement) {
    const side = (i: number) =>
      `<div class="side p${i + 1}"><span class="name">${PLAYER_NAMES[i]}</span><span class="pips"></span>` +
      `<span class="boost"><span class="fill" style="display:block"></span></span><span class="slots"></span></div>`;
    root.innerHTML = `${side(0)}<div class="clock">0:00</div>${side(1)}`;
    this.sides = [...root.querySelectorAll<HTMLElement>('.side')].map((el) => ({
      pips: el.querySelector<HTMLElement>('.pips')!,
      fill: el.querySelector<HTMLElement>('.fill')!,
      slots: el.querySelector<HTMLElement>('.slots')!,
      lastSlots: '-',
    }));
    this.clock = root.querySelector<HTMLElement>('.clock')!;
  }

  update(state: MatchState | null, cfg: Config): void {
    this.root.classList.toggle('on', state !== null);
    if (!state) return;

    const pipsKey = `${cfg.winsToWin}:${state.scores.join(',')}`;
    if (pipsKey !== this.lastPips) {
      this.lastPips = pipsKey;
      this.sides.forEach((side, i) => {
        const score = state.scores[i] ?? 0;
        side.pips.innerHTML = Array.from(
          { length: Math.max(cfg.winsToWin, score) },
          (_, k) => `<span class="pip${k < score ? ' on' : ''}"></span>`,
        ).join('');
      });
    }

    state.snakes.forEach((s, i) => {
      const side = this.sides[i];
      if (!side) return;
      side.fill.style.width = `${Math.round(s.boostMeter * 100)}%`;
      const key = `${cfg.itemSlots}|${s.shield}|${s.items.map((it) => `${it.kind}:${it.charges}`).join(',')}`;
      if (key !== side.lastSlots) {
        side.lastSlots = key;
        side.slots.innerHTML = slotsHtml(s, cfg.itemSlots);
      }
    });

    const clock = state.overtime
      ? `OVERTIME ${formatClock(state.roundTicks, TICK_RATE)}`
      : formatClock(state.roundTicks, TICK_RATE);
    if (clock !== this.lastClock) {
      this.lastClock = clock;
      this.clock.textContent = clock;
      this.clock.classList.toggle('overtime', state.overtime);
    }
  }
}

/** The Shield bubble chip, then the item queue with the next item (front) highlighted. */
function slotsHtml(s: SnakeState, slotCount: number): string {
  const shield = s.shield ? '<span class="slot chip" data-kind="shield">SHIELD</span>' : '';
  const cells = Array.from({ length: Math.max(slotCount, s.items.length) }, (_, k) => {
    const item = s.items[k];
    if (!item) return '<span class="slot">—</span>';
    return `<span class="slot full${k === 0 ? ' next' : ''}" data-kind="${item.kind}">${describeItem(item)}</span>`;
  });
  return shield + cells.join('');
}
