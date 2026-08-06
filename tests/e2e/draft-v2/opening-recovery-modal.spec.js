import { expect, test } from '../fixtures/safeTest.js';

const localTest = process.env.E2E_BASE_URL ? test.skip : test;

test.afterEach(async ({ safetyCapture }) => {
  const network = safetyCapture.networkCapture.safeSummary();
  expect(network.unsafeRequestCount).toBe(0);
  expect(network.zapierRequestCount).toBe(0);
  expect(safetyCapture.blockedRequests.every((request) => (
    request.reason === 'writes-disabled'
    && request.url.includes('/analytics/track/batch')
  ))).toBe(true);
});

const open = async (page, scenario) => {
  await page.goto(`/tests/e2e/fixtures/pro-draft-entry.html?scenario=${encodeURIComponent(scenario)}`);
  await expect(page.getByRole('dialog')).toBeVisible();
};

localTest('[DR-MODAL-001] new email-associated draft displays and acknowledges its code', async ({ page }) => {
  await open(page, 'new-email');
  await page.getByRole('button', { name: 'Continue with an email' }).click();
  await expect(page.getByLabel('Email address (optional)')).toHaveValue('signed.owner@example.invalid');
  await page.getByRole('button', { name: 'Continue with this email' }).click();
  await expect(page.getByRole('heading', { name: 'Save your recovery code' })).toBeVisible();
  await expect(page.getByLabel('Recovery code', { exact: true })).toContainText('2345-6789-ABCD-EFGH-JKMN');
  await page.getByRole('button', { name: 'Copy recovery code' }).click();
  const acknowledgement = page.getByRole('checkbox');
  if (!(await acknowledgement.isChecked())) await acknowledgement.click();
  await page.getByRole('button', { name: 'Continue to questionnaire' }).click();
  await expect(page.getByTestId('questionnaire-content')).toBeVisible();
  expect(page.url()).not.toContain('2345-6789-ABCD-EFGH-JKMN');
});

localTest('[DR-MODAL-001] anonymous flow requires acknowledgement and warns on blocked storage', async ({ page }) => {
  await open(page, 'storage-blocked');
  await page.getByRole('button', { name: 'Continue without an email' }).click();
  const continueButton = page.getByRole('button', { name: 'Continue without an email' });
  await expect(continueButton).toBeDisabled();
  await page.getByRole('checkbox').click();
  await continueButton.click();
  await expect(page.getByRole('alert')).toContainText('This browser is not allowing persistent storage');
  await expect(page.getByRole('button', { name: 'Continue to questionnaire' })).toBeDisabled();
});

localTest('[DR-REC-002] explicit recovery-code flow reaches welcome-back state', async ({ page }) => {
  await open(page, 'code');
  await page.getByRole('button', { name: 'Recover with a recovery code' }).click();
  await page.getByRole('textbox', { name: 'Recovery code' }).fill('2345 6789 abcd efgh jkmn');
  await page.getByRole('button', { name: 'Recover questionnaire' }).click();
  await expect(page.getByRole('heading', { name: 'Your saved questionnaire is ready' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to questionnaire' }).click();
  await expect(page.getByTestId('questionnaire-content')).toBeVisible();
});

localTest('[DR-REC-001] explicit email recovery and CAPTCHA retry are transient', async ({ page }) => {
  await open(page, 'captcha');
  await page.getByRole('button', { name: 'Continue with an email' }).click();
  await page.getByRole('button', { name: 'Recover saved answers using this email' }).click();
  await expect(page.getByText('Complete the security check to try recovery again.')).toBeVisible();
  const retry = page.getByRole('button', { name: 'Try email recovery again' });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(page.getByRole('heading', { name: 'Your saved questionnaire is ready' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('staging-test-valid');
});

localTest('[DR-ID-002] changed signed email warns and starts a new association', async ({ page }) => {
  await open(page, 'changed-email');
  await page.getByRole('button', { name: 'Continue with an email' }).click();
  await page.getByLabel('Email address (optional)').fill('replacement@example.invalid');
  await expect(page.getByText(/It will not open drafts that already belong/)).toBeVisible();
  await page.getByRole('button', { name: 'Continue with this email' }).click();
  await expect(page.getByRole('heading', { name: 'Save your recovery code' })).toBeVisible();
});

localTest('[DR-REC-002] stored resume still shows welcome back', async ({ page }) => {
  await open(page, 'stored');
  await expect(page.getByText('Synthetic Business')).toBeVisible();
  await expect(page.getByText('Access:')).toBeVisible();
  await expect(page.getByTestId('questionnaire-content')).not.toBeVisible();
});

localTest('[DR-PDF-001] submitted recovery opens questionnaire controls read-only', async ({ page }) => {
  await open(page, 'submitted');
  await expect(page.getByRole('heading', { name: 'Your submitted questionnaire is ready' })).toBeVisible();
  await page.getByRole('button', { name: 'View submitted questionnaire' }).click();
  await expect(page.getByRole('button', { name: 'Synthetic questionnaire control' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /submit/i })).toHaveCount(0);
});
