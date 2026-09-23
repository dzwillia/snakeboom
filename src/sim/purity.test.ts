import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SIM_DIR = fileURLToPath(new URL('.', import.meta.url));

const FORBIDDEN: Array<[RegExp, string]> = [
  [/Math\.random\b/, 'Math.random'],
  [/\bDate\b/, 'Date'],
  [/\bperformance\b/, 'performance'],
  [
    /Math\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|hypot|pow|exp|expm1|log|log2|log10|log1p|cbrt)\b/,
    'engine-dependent Math function (use detmath)',
  ],
  [/\bwindow\b/, 'window'],
  [/\bdocument\b/, 'document'],
  [/from\s+['"]node:/, 'node: import'],
  [/\*\*/, 'exponent operator (use multiplication)'],
];

function simSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...simSources(path));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('sim purity', () => {
  it('uses no browser, clock, or engine-dependent math APIs', () => {
    const problems: string[] = [];
    for (const file of simSources(SIM_DIR)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const [pattern, label] of FORBIDDEN) {
        if (pattern.test(code)) problems.push(`${file}: ${label}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
