import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['scripts/lib/base44-deployment-target.test.js'],
    restoreMocks: true,
    clearMocks: true
  }
});
