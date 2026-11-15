// Spike-only vitest config: the project config (vite.config.ts) only includes tests/**. Used with --config.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['spike/sqlite/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
