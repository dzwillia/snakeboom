import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { port: 5199, open: true },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
