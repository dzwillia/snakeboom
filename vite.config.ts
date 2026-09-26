import { defineConfig } from 'vitest/config';
import pkg from './package.json' with { type: 'json' };

// The deploy passes the git tag (v0.15.0) in as APP_VERSION; anything else is a dev build of the package version.
const version = process.env.APP_VERSION?.trim() || `v${pkg.version}-dev`;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: { port: 5199, open: true },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Simulation-heavy tests take a few seconds; a loaded runner (CI or a busy laptop) needs the headroom.
    testTimeout: 30000,
  },
});
