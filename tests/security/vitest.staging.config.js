import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    restoreMocks: true,
    clearMocks: true,
    testTimeout: 20_000,
    include: ['tests/security/staging/**/*.test.js'],
    maxConcurrency: 1,
    sequence: { concurrent: false },
    pool: 'forks',
  },
  resolve: {
    alias: { '@': path.resolve(repositoryRoot, 'src') },
  },
});
