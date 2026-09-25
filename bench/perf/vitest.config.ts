import { defineConfig } from 'vitest/config';

// Bench-only vitest config (W7.PERF.01). Run: npx vitest run --config bench/perf/vitest.config.ts
export default defineConfig({
  test: {
    root: new URL('../..', import.meta.url).pathname,
    include: ['bench/perf/**/*.test.ts'],
    environment: 'node',
    testTimeout: 300_000,
  },
});
