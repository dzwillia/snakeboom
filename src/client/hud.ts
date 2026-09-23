import { TICK_RATE, type Config, type MatchState } from '../sim';
import { PLAYER_NAMES, describeItem, formatClock } from './text';

interface Side {
  pips: HTMLElement;
  fill: HTMLElement;
  slot: HTMLElement;
  lastSlot: string;
}

/** Top bar: names, score pips, boost meters, item slots and the round clock. */
export class Hud {
  private readonly sides: Side[];
  private readonly clock: HTMLElement;
  private lastPips = '';
  private lastClock = '';

  constructor(private readonly root: HTMLElement) {
    const side = (i: number) =>
      `<div class="side p${i + 1}"><span class="name">${PLAYER_NAMES[i]}</span><span class="pips"></span>` +
      `<span class="boost"><span class="fill" style="display:block"></span></span><span class="slot"></span></div>`;
    root.innerHTML = `${side(0)}<div class="clock">0:00</div>${side(1)}`;
    this.sides = [...root.querySelectorAll<HTMLElement>('.side')].map((el) => ({
      pips: el.querySelector<HTMLElement>('.pips')!,
      fill: el.querySelector<HTMLElement>('.fill')!,
      slot: el.querySelector<HTMLElement>('.slot')!,
      lastSlot: '-',
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
      const label = describeItem(s.item);
      if (label !== side.lastSlot) {
        side.lastSlot = label;
        side.slot.textContent = label || 'NO ITEM';
        side.slot.dataset.kind = s.item?.kind ?? '';
        side.slot.classList.toggle('full', s.item !== null);
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
