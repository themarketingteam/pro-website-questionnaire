import { defineConfig, devices } from '@playwright/test';
import { resolveE2ETarget } from './tests/e2e/helpers/targetSafety.js';
import { createTestRunId } from './tests/e2e/helpers/testRunId.js';

const TRACE_MODES = new Set([
  'off',
  'on',
  'retain-on-failure',
  'on-first-retry',
  'retain-on-first-failure',
]);

const target = resolveE2ETarget(process.env);
const testRunId = createTestRunId(process.env.E2E_TEST_RUN_ID);
const traceMode = process.env.E2E_TRACE_MODE || 'retain-on-failure';

if (!TRACE_MODES.has(traceMode)) throw new Error('INVALID_E2E_TRACE_MODE');

// Workers inherit the resolved value, so every project in one invocation uses
// the same cleanable marker even when the caller did not supply one.
process.env.E2E_TEST_RUN_ID = testRunId;

const projects = [
  {
    name: 'chromium-desktop',
    use: { ...devices['Desktop Chrome'] },
  },
  {
    name: 'firefox-desktop',
    use: { ...devices['Desktop Firefox'] },
  },
  {
    name: 'webkit-desktop',
    use: { ...devices['Desktop Safari'] },
  },
  {
    name: 'mobile-chromium',
    use: { ...devices['Pixel 7'] },
  },
  {
    name: 'mobile-webkit',
    use: { ...devices['iPhone 15'] },
  },
];

if (target.edgeEnabled) {
  projects.push({
    name: 'msedge',
    use: {
      ...devices['Desktop Chrome'],
      channel: 'msedge',
    },
  });
}

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: `test-results/${testRunId}`,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: `playwright-report/${testRunId}` }],
  ],
  metadata: {
    targetEnvironment: target.environment,
    testRunId,
    writesEnabled: target.allowWrites,
  },
  use: {
    actionTimeout: 15_000,
    baseURL: target.baseURL,
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    trace: traceMode,
    video: 'retain-on-failure',
  },
  projects,
  webServer: target.usesLocalWebServer
    ? {
      command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
      url: target.baseURL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        VITE_APP_ENVIRONMENT: 'local',
        VITE_APP_BUILD_SHA: 'e2e-local',
        VITE_APP_BUILD_TIME: '2000-01-01T00:00:00Z',
        // Local preview has no Base44 URL bootstrap parameters. This synthetic
        // app ID permits client construction while the read-only fixture blocks
        // every cross-origin request and all writes.
        VITE_BASE44_APP_ID: 'e2e-local-synthetic-app',
        VITE_PRO_DRAFT_V2_ENABLED: 'false',
        VITE_PRO_DRAFT_V2_KILL_SWITCH: 'true',
        VITE_PRO_DRAFT_PUBLIC_EMAIL_RECOVERY_ENABLED: 'false',
        VITE_PRO_DRAFT_EMAIL_OTP_ENABLED: 'false',
        VITE_PRO_DRAFT_MAGIC_LINK_ENABLED: 'false',
        VITE_PRO_DRAFT_DIAGNOSTICS_ENABLED: 'false',
        VITE_STAGING_BANNER_ENABLED: 'false',
      },
    }
    : undefined,
});
