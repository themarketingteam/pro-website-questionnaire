import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: [
      path.resolve(root, 'test/setupTests.js'),
      path.resolve(root, 'test/baseline-characterization/setupBaselineNetworkGuard.js')
    ],
    globals: true,
    restoreMocks: true,
    clearMocks: true,
    css: false,
    testTimeout: 20000,
    pool: 'forks',
    include: [
      'src/test/baseline-characterization/**/*.baseline-characterization.test.{js,jsx}',
      'src/test/baseline-characterization/**/*.baseline-characterization.spec.{js,jsx}'
    ],
    exclude: [...configDefaults.exclude]
  },
  resolve: {
    alias: {
      '@': path.resolve(root, '.'),
    },
  },
});
