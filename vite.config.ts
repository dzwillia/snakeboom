import { defineConfig } from 'vitest/config';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 5199, open: true },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
