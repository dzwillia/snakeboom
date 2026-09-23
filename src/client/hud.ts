import { TICK_RATE, type Config, type MatchState } from '../sim';
import { PLAYER_NAMES, formatClock } from './text';

interface Side {
  pips: HTMLElement;
  fill: HTMLElement;
}

/** Top bar: names, score pips, boost meters and the round clock. */
export class Hud {
  private readonly sides: Side[];
  private readonly clock: HTMLElement;
  private lastPips = '';
  private lastClock = '';

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = `
      <div class="side p1"><span class="name">${PLAYER_NAMES[0]}</span><span class="pips"></span><span class="boost"><span class="fill" style="display:block"></span></span></div>
      <div class="clock">0:00</div>
      <div class="side p2"><span class="name">${PLAYER_NAMES[1]}</span><span class="pips"></span><span class="boost"><span class="fill" style="display:block"></span></span></div>`;
    this.sides = [...root.querySelectorAll<HTMLElement>('.side')].map((side) => ({
      pips: side.querySelector<HTMLElement>('.pips')!,
      fill: side.querySelector<HTMLElement>('.fill')!,
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
      if (side) side.fill.style.width = `${Math.round(s.boostMeter * 100)}%`;
    });

    const clock = state.overtime ? `OVERTIME ${formatClock(state.roundTicks, TICK_RATE)}` : formatClock(state.roundTicks, TICK_RATE);
    if (clock !== this.lastClock) {
      this.lastClock = clock;
      this.clock.textContent = clock;
      this.clock.classList.toggle('overtime', state.overtime);
    }
  }
}
