import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The rules engine and the shared netcode must both run unchanged in browsers, Node and any relay runtime. */
const PURE_DIRS = ['.', '../net'].map((rel) => fileURLToPath(new URL(rel, import.meta.url))).filter((dir) => existsSync(dir));

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

describe('sim and net purity', () => {
  it('uses no browser, clock, or engine-dependent math APIs', () => {
    const problems: string[] = [];
    for (const file of PURE_DIRS.flatMap(simSources)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const [pattern, label] of FORBIDDEN) {
        if (pattern.test(code)) problems.push(`${file}: ${label}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
