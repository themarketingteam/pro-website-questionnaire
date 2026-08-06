import { expect, test } from '../fixtures/safeTest.js';
import {
  hasVisibleFocusIndicator,
  scanAccessibility,
} from '../helpers/accessibility.js';

const localTest = process.env.E2E_BASE_URL ? test.skip : test;
const entry = (scenario) => `/tests/e2e/fixtures/pro-draft-entry.html?scenario=${scenario}`;
const recovery = (scenario, view = 'recovery') => `/tests/e2e/fixtures/pro-draft-recovery.html?scenario=${scenario}&view=${view}`;

localTest('[DR-A11Y-001] opening modal has no serious/critical violations and visible keyboard focus', async ({ page }, testInfo) => {
  await page.goto(entry('new-email'));
  const firstChoice = page.getByRole('button', { name: 'Continue with an email' });
  await expect(firstChoice).toBeVisible();
  expect(await hasVisibleFocusIndicator(firstChoice)).toBe(true);
  await scanAccessibility(page, testInfo);
});

localTest('[DR-A11Y-002] questionnaire form is accessible on desktop and mobile projects', async ({ page }, testInfo) => {
  await page.goto(recovery('panel-hint', 'panel'));
  await expect(page.getByLabel('Business name')).toBeVisible();
  await scanAccessibility(page, testInfo);
});

localTest('[DR-A11Y-003] recovery panel is accessible', async ({ page }, testInfo) => {
  await page.goto(recovery('panel-full', 'panel'));
  await expect(page.getByTestId('pro-draft-recovery-panel')).toBeVisible();
  await scanAccessibility(page, testInfo, { include: '[data-testid="pro-draft-recovery-panel"]' });
});

localTest('[DR-A11Y-004] public recovery page is accessible', async ({ page }, testInfo) => {
  await page.goto(recovery('direct'));
  await expect(page.getByRole('heading', { name: 'Recover your questionnaire' })).toBeVisible();
  await scanAccessibility(page, testInfo);
});

localTest('[DR-A11Y-005] conflict choice dialog is accessible', async ({ context }, testInfo) => {
  const first = await context.newPage();
  const second = await context.newPage();
  const url = '/tests/e2e/fixtures/pro-draft-conflict.html?draft=a11y-conflict&tab=';
  await Promise.all([first.goto(`${url}a`), second.goto(`${url}b`)]);
  await first.getByTestId('answer-qA').fill('Saved answer');
  await second.getByTestId('answer-qA').fill('Local answer');
  await first.getByTestId('save').click();
  await second.getByTestId('save').click();
  await expect(second.getByRole('dialog')).toBeVisible();
  await scanAccessibility(second, testInfo, { include: '[role="dialog"]' });
});

localTest('[DR-A11Y-006] Clear All dialog is accessible', async ({ page }, testInfo) => {
  await page.goto('/tests/e2e/fixtures/pro-draft-replacement.html');
  await page.getByRole('button', { name: 'Clear All' }).click();
  await expect(page.getByRole('dialog', { name: 'Start over with a new questionnaire?' })).toBeVisible();
  await scanAccessibility(page, testInfo, { include: '[role="dialog"]' });
});

localTest('[DR-A11Y-007] new recovery-code dialog is accessible', async ({ page }, testInfo) => {
  await page.goto('/tests/e2e/fixtures/pro-draft-replacement.html');
  await page.getByRole('button', { name: 'Clear All' }).click();
  await page.getByRole('button', { name: 'Create a new blank draft' }).click();
  await expect(page.getByRole('dialog', { name: 'Save your new recovery code' })).toBeVisible();
  await scanAccessibility(page, testInfo, { include: '[role="dialog"]' });
});

localTest('[DR-A11Y-008] submitted read-only view is accessible', async ({ page }, testInfo) => {
  await page.goto(entry('submitted'));
  await page.getByRole('button', { name: 'View submitted questionnaire' }).click();
  await expect(page.getByRole('button', { name: 'Synthetic questionnaire control' })).toBeDisabled();
  await scanAccessibility(page, testInfo);
});

localTest('[DR-A11Y-009] admin password gate is accessible', async ({ page }, testInfo) => {
  await page.goto('/admin/draft-recovery');
  await expect(page.getByRole('heading', { name: 'Draft Recovery Access' })).toBeVisible();
  await scanAccessibility(page, testInfo);
});

localTest('[DR-A11Y-010] admin list, detail, edit, and pagination controls are accessible', async ({ page }, testInfo) => {
  await page.goto('/tests/e2e/fixtures/pro-draft-admin.html');
  await expect(page.getByRole('heading', { name: 'Pro Form Draft Recovery' })).toBeVisible();
  await page.getByRole('button', { name: /Synthetic Accessibility Business/u }).click();
  await expect(page.getByText('Server revision:')).toBeVisible();
  await page.getByRole('button', { name: 'Edit Draft' }).click();
  await expect(page.getByRole('region', { name: 'Edit draft' })).toBeVisible();
  await scanAccessibility(page, testInfo);
});

localTest('[DR-A11Y-011] CAPTCHA state is accessible', async ({ page }, testInfo) => {
  await page.goto(recovery('captcha'));
  await page.getByLabel('Email address').fill('synthetic.owner@example.invalid');
  await page.getByRole('button', { name: 'Recover questionnaire' }).click();
  await expect(page.getByText('Security check ready.')).toBeVisible();
  await scanAccessibility(page, testInfo);
});

localTest('[DR-A11Y-012] error and maintenance state is accessible', async ({ page }, testInfo) => {
  await page.goto('/tests/e2e/fixtures/pro-draft-maintenance.html');
  await expect(page.getByRole('heading', { name: 'Questionnaire Saving Is Temporarily Unavailable' })).toBeVisible();
  await scanAccessibility(page, testInfo);
});
