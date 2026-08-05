import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: [path.resolve(root, 'test/setupTests.js')],
    globals: true,
    restoreMocks: true,
    clearMocks: true,
    css: false,
    testTimeout: 20000,
    pool: 'forks',
    include: [
      'src/**/*.test.{js,jsx}',
      'scripts/**/*.test.{js,jsx}'
    ],
    // Temporary defect-characterization tests are opt-in through their own config.
    exclude: [
      ...configDefaults.exclude,
      '**/*.baseline-characterization.test.*',
      'tests/e2e/**'
    ]
  },
  resolve: {
    alias: {
      '@': path.resolve(root, '.'),
    },
  },
});
