import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: [path.resolve(root, 'test/setupTests.js')],
    globals: true,
    restoreMocks: true,
    clearMocks: true,
    css: false,
    testTimeout: 20000,
  },
  resolve: {
    alias: {
      '@': path.resolve(root, '.'),
    },
  },
});