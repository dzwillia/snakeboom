/**
 * AI vs AI over a few seeds: `pnpm duel 45 hard,normal`. Prints wins, how many rounds the border
 * decided, and who died of what. For tuning the opponent against rule changes.
 */
import { createMatch, createOpponent, DEFAULT_CONFIG, opponentInput, rematch, step, TICK_RATE, type Difficulty } from '../src/sim';
const cap = Number(process.argv[2] ?? 40);
const kinds = (process.argv[3] ?? 'hard,normal').split(',') as Difficulty[];
const cfg = { ...DEFAULT_CONFIG, roundMaxSeconds: cap, countdownSeconds: 1, roundOverSeconds: 1 };
for (const seed of [33, 34, 35]) {
  const state = createMatch(cfg, seed);
  const bots = kinds.map((k, i) => createOpponent(k, seed + 1 + i));
  const wins = [0, 0]; const causes: Record<string, number> = {}; let played = 0; let byBorder = 0;
  for (let t = 0; t < 8 * (cap + 15) * TICK_RATE && played < 8; t++) {
    const ev = step(state, bots.map((b, i) => opponentInput(b, state, i, cfg)), cfg);
    for (const e of ev) {
      if (e.type === 'death') causes[`${kinds[e.player]}:${e.cause}`] = (causes[`${kinds[e.player]}:${e.cause}`] ?? 0) + 1;
      if (e.type === 'roundOver') { played++; if (e.winner !== null) wins[e.winner]++; if (state.inset > 0) byBorder++; }
    }
    if (state.phase === 'matchOver') rematch(state, cfg, seed + t);
  }
  console.log(`seed ${seed} cap ${cap}: ${kinds[0]} ${wins[0]} – ${wins[1]} ${kinds[1]} · rounds ended during closing: ${byBorder}/${played} · deaths ${JSON.stringify(causes)}`);
}
