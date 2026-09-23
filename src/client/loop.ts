export interface Clock {
  now(): number;
  request(callback: (now: number) => void): void;
}

export const browserClock: Clock = {
  now: () => performance.now(),
  request: (callback) => requestAnimationFrame(callback),
};

/**
 * Fixed-timestep loop: calls `tick` at 1/dt per second of (scaled) time and `render` once per
 * frame with the interpolation alpha. Long gaps are clamped so a hidden tab never fast-forwards.
 */
export class FixedLoop {
  timeScale = 1;
  private acc = 0;
  private last = 0;

  constructor(
    private readonly tick: () => void,
    private readonly render: (alpha: number, frameSeconds: number) => void,
    private readonly clock: Clock = browserClock,
    private readonly dt = 1 / 60,
    private readonly maxSteps = 5,
    private readonly maxFrame = 0.25,
  ) {}

  start(): void {
    this.last = this.clock.now();
    this.clock.request(this.frame);
  }

  /** One animation frame. Public so tests can drive it with a fake clock. */
  readonly frame = (now: number): void => {
    const frameSeconds = Math.min(this.maxFrame, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.acc += frameSeconds * this.timeScale;
    let steps = 0;
    while (this.acc >= this.dt && steps < this.maxSteps) {
      this.tick();
      this.acc -= this.dt;
      steps++;
    }
    if (this.acc >= this.dt) this.acc = 0;
    this.render(this.acc / this.dt, frameSeconds);
    this.clock.request(this.frame);
  };
}
