import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/load/**/*.test.js',
      'tests/chaos/**/*.test.js',
    ],
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 2,
        minForks: 1,
      },
    },
    testTimeout: 20_000,
  },
});
