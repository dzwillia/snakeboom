import { PLAYER_CSS } from './colors';
import { PLAYER_NAMES } from './text';

/** Centered overlay messages. All strings are our own, never user input. */
export class Screens {
  private token = 0;

  constructor(private readonly root: HTMLElement) {}

  clear(): void {
    this.token++;
    this.root.innerHTML = '';
  }

  title(winsToWin: number): void {
    this.show(`
      <div class="panel">
        <div class="logo">SNAKEBOOM</div>
        <div class="controls">
          <div class="p1"><h3>${PLAYER_NAMES[0]}</h3>
            <p><kbd>A</kbd> <kbd>D</kbd> steer</p><p><kbd>W</kbd> boost</p><p><kbd>S</kbd> use item</p></div>
          <div class="p2"><h3>${PLAYER_NAMES[1]}</h3>
            <p><kbd>←</kbd> <kbd>→</kbd> steer</p><p><kbd>↑</kbd> boost</p><p><kbd>↓</kbd> use item</p></div>
        </div>
        <div class="hint">PRESS SPACE TO START</div>
        <div class="small">FIRST TO ${winsToWin} · <kbd>ESC</kbd> PAUSE · <kbd>M</kbd> MUTE · <kbd>\`</kbd> TUNING</div>
      </div>`);
  }

  countdown(n: number | 'GO'): void {
    const token = this.show(`<div class="big" style="color:var(--text)">${n}</div>`);
    if (n === 'GO') this.clearLater(token, 700);
  }

  roundOver(title: string, detail: string, winner: number | null): void {
    const color = winner === null ? 'var(--text)' : PLAYER_CSS[winner];
    this.show(`<div><div class="banner-title" style="color:${color}">${title}</div><div class="banner-detail">${detail}</div></div>`);
  }

  matchOver(winner: number, scores: readonly number[]): void {
    this.show(`
      <div class="panel">
        <div class="banner-title" style="color:${PLAYER_CSS[winner]}">${PLAYER_NAMES[winner]} WINS</div>
        <div class="banner-detail">${scores.join(' – ')}</div>
        <div class="hint">SPACE REMATCH · ESC MENU</div>
      </div>`);
  }

  paused(): void {
    this.show(`<div class="panel"><div class="banner-title" style="color:var(--text)">PAUSED</div><div class="hint">ESC TO RESUME</div></div>`);
  }

  private show(html: string): number {
    this.token++;
    this.root.innerHTML = html;
    return this.token;
  }

  private clearLater(token: number, ms: number): void {
    setTimeout(() => {
      if (token === this.token) this.clear();
    }, ms);
  }
}
