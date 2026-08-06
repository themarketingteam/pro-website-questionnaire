import { expect, test } from '../fixtures/safeTest.js';

const localTest = process.env.E2E_BASE_URL ? test.skip : test;
const fixture = (scenario, view = 'recovery') => (
  `/tests/e2e/fixtures/pro-draft-recovery.html?scenario=${scenario}&view=${view}`
);

test.afterEach(async ({ safetyCapture }) => {
  const network = safetyCapture.networkCapture.safeSummary();
  expect(network.unsafeRequestCount).toBe(0);
  expect(network.zapierRequestCount).toBe(0);
  expect(safetyCapture.blockedRequests.every((request) => (
    request.reason === 'writes-disabled'
    && request.url.includes('/analytics/track/batch')
  ))).toBe(true);
});

localTest('[DR-PAGE-001] direct public route is responsive and keyboard accessible', async ({ page }) => {
  await page.goto(fixture('direct'));
  await expect(page).toHaveURL(/\/recover-draft$/u);
  await expect(page.getByRole('heading', { name: 'Recover your questionnaire' })).toBeVisible();
  await expect(page.getByText('Email recovery does not verify ownership of the email address.')).toBeVisible();
  const emailTab = page.getByRole('tab', { name: 'Recover with email' });
  await emailTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Recover with code' })).toBeFocused();
  await expect(page.getByRole('tabpanel')).toHaveAccessibleName('Recover with code');
});

localTest('[DR-REC-001] email recovery authorizes transient older-draft choices', async ({ page }) => {
  await page.goto(fixture('email'));
  await page.getByLabel('Email address').fill('synthetic.owner@example.invalid');
  await page.getByRole('button', { name: 'Recover questionnaire' }).click();
  await expect(page.getByText(/Newest Synthetic Questionnaire/u)).toBeVisible();
  await expect(page.locator('body')).not.toContainText('synthetic.owner@example.invalid');
  await page.getByRole('button', { name: 'Recover a different questionnaire' }).click();
  await expect(page.getByText('Older Active Synthetic Questionnaire')).toBeVisible();
  await page.getByRole('button', { name: 'Open this questionnaire' }).first().click();
  await expect(page.getByText(/Older Active Synthetic Questionnaire/u).first()).toBeVisible();
  await expect(page).toHaveURL(/\/recover-draft$/u);
});

localTest('[DR-REC-002] code recovery opens only the exact draft without listing others', async ({ page }) => {
  await page.goto(fixture('code'));
  await page.getByRole('tab', { name: 'Recover with code' }).click();
  await page.getByLabel('Recovery code').fill('2345 6789 abcd efgh jkmn');
  await page.getByRole('button', { name: 'Recover questionnaire' }).click();
  await expect(page.getByText(/Exact Synthetic Questionnaire/u)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recover a different questionnaire' })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('2345-6789-ABCD-EFGH-JKMN');
  await expect(page).toHaveURL(/\/recover-draft$/u);
});

localTest('[DR-CHOICE-001] submitted older choice opens read-only', async ({ page }) => {
  await page.goto(fixture('submitted'));
  await page.getByLabel('Email address').fill('synthetic.owner@example.invalid');
  await page.getByRole('button', { name: 'Recover questionnaire' }).click();
  await page.getByRole('button', { name: 'Recover a different questionnaire' }).click();
  await page.getByRole('button', { name: 'Open this questionnaire' }).nth(1).click();
  await expect(page.getByRole('heading', { name: 'Your submitted questionnaire is ready' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View submitted questionnaire' })).toBeVisible();
});

localTest('[DR-PANEL-001] recovery panel precedes Q1, stays out of header, and copies vault code', async ({ page }) => {
  await page.goto(fixture('panel-full', 'panel'));
  const panel = page.getByTestId('pro-draft-recovery-panel');
  const question = page.getByTestId('question-wrapper-1');
  expect(await panel.evaluate((node, q1) => Boolean(
    node.compareDocumentPosition(q1) & Node.DOCUMENT_POSITION_FOLLOWING
  ), await question.elementHandle())).toBe(true);
  await expect(page.getByTestId('site-header')).not.toContainText('Draft recovery');
  await expect(panel).toContainText('s***@example.invalid');
  await page.getByRole('button', { name: 'Copy recovery code' }).click();
  await expect(panel.getByRole('status')).toContainText(/copied|not available/u);
  await page.getByText('Draft recovery information').click();
  await expect(page.getByTestId('pro-draft-recovery-footer')).not.toContainText('2345-6789-ABCD-EFGH-JKMN');
  await expect(page).toHaveURL(/\/recover-draft$/u);
});

localTest('[DR-PANEL-002] hint-only, storage-blocked, and CAPTCHA states expose no secrets', async ({ page }) => {
  await page.goto(fixture('panel-hint', 'panel'));
  await expect(page.getByTestId('pro-draft-recovery-panel')).toContainText('JKMN');
  await expect(page.getByRole('button', { name: 'Copy recovery code' })).toHaveCount(0);

  await page.goto(fixture('storage-blocked'));
  await expect(page.getByRole('heading', { name: 'Recover your questionnaire' })).toBeVisible();

  await page.goto(fixture('captcha'));
  await page.getByLabel('Email address').fill('synthetic.owner@example.invalid');
  await page.getByRole('button', { name: 'Recover questionnaire' }).click();
  await expect(page.getByText('Security check ready.')).toBeVisible();
  await page.getByRole('button', { name: 'Recover questionnaire' }).click();
  await expect(page.getByText(/Newest Synthetic Questionnaire/u)).toBeVisible();
  await expect(page.locator('body')).not.toContainText('staging-test-valid');
  await expect(page.locator('body')).not.toContainText('recoverySessionToken');
});
