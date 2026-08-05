import { test, expect } from '../fixtures/safeTest.js';
import { assertSafeNavigation, resolveE2ETarget } from '../helpers/targetSafety.js';
import { isValidTestRunId } from '../helpers/testRunId.js';

const target = resolveE2ETarget(process.env);

test('loads the questionnaire shell without write-capable side effects', async ({
  page,
  safetyCapture,
}) => {
  expect(isValidTestRunId(process.env.E2E_TEST_RUN_ID)).toBe(true);

  const response = await page.goto('/');
  expect(response?.ok()).toBe(true);
  expect(assertSafeNavigation(page.url(), target)).toBe(true);

  const shell = page.getByTestId('application-runtime-shell');
  await expect(shell).toBeVisible();
  await expect(
    page.getByRole('heading', { name: /Pro \| Website Content Questionnaire/i }),
  ).toBeVisible();
  await expect(page.getByTestId('question-wrapper-1')).toBeVisible();

  await expect(shell).toHaveAttribute('data-draft-v2-enabled', 'false');
  await expect(shell).toHaveAttribute('data-draft-v2-kill-switch', 'true');

  if (target.environment === 'staging') {
    await expect(shell).toHaveAttribute('data-app-environment', 'staging');
    await expect(page.getByTestId('staging-environment-banner')).toBeVisible();
  } else {
    await expect(shell).toHaveAttribute('data-app-environment', 'local');
    await expect(page.getByTestId('staging-environment-banner')).toHaveCount(0);
  }

  expect(safetyCapture.consoleCapture.pageErrors).toEqual([]);
  expect(safetyCapture.consoleCapture.consoleErrors).toEqual([]);
  expect(safetyCapture.networkCapture.zapierRequests).toEqual([]);
  expect(safetyCapture.networkCapture.unsafeRequests).toEqual([]);
});
