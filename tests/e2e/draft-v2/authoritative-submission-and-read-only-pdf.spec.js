import { expect, test } from '../fixtures/safeTest.js';

const fixture = (query = '') => `/tests/e2e/fixtures/pro-draft-submission.html${query}`;
const submitValid = async (page, query = '') => {
  await page.goto(fixture(query));
  await page.getByLabel('Required answer').fill('Final immutable answer');
  await page.getByRole('button', { name: 'Submit Questionnaire' }).click();
};

test('[DR-SUBMIT-001] validation failure is persisted', async ({ page }) => {
  await page.goto(fixture());
  await page.getByRole('button', { name: 'Submit Questionnaire' }).click();
  await expect(page.getByTestId('validation')).toHaveText('saved-invalid');
});

test('[DR-SUBMIT-002] corrected valid questionnaire submits', async ({ page }) => {
  await page.goto(fixture());
  await page.getByRole('button', { name: 'Submit Questionnaire' }).click();
  await page.getByLabel('Required answer').fill('Corrected');
  await page.getByRole('button', { name: 'Submit Questionnaire' }).click();
  await expect(page.getByTestId('status')).toHaveText('submitted');
});

test('[DR-SUBMIT-003] submit_attempted is server acknowledged', async ({ page }) => {
  await submitValid(page);
  await expect(page.getByTestId('attempted')).toHaveText('server-acknowledged');
});

test('[DR-SUBMIT-004] staging external side effects remain disabled', async ({ page }) => {
  await submitValid(page);
  await expect(page.getByTestId('external-mode')).toHaveText('disabled');
});

test('[DR-SUBMIT-005] submitted questionnaire is read only', async ({ page }) => {
  await submitValid(page);
  await expect(page.getByLabel('Required answer')).toBeDisabled();
  await expect(page.getByTestId('read-only')).toHaveText('true');
});

test('[DR-SUBMIT-006] reload retains submitted read-only state', async ({ page }) => {
  await submitValid(page);
  await page.reload();
  await expect(page.getByTestId('status')).toHaveText('submitted');
  await expect(page.getByLabel('Required answer')).toBeDisabled();
});

test('[DR-SUBMIT-007] close and reopen retains submitted state', async ({ page, context }) => {
  await submitValid(page);
  const second = await context.newPage();
  await second.goto(fixture());
  await expect(second.getByTestId('status')).toHaveText('submitted');
});

test('[DR-SUBMIT-008] email recovery hydrates submitted read-only', async ({ page }) => {
  await page.goto(fixture('?recover=email'));
  await expect(page.getByTestId('recovery-method')).toHaveText('email');
  await expect(page.getByLabel('Required answer')).toBeDisabled();
});

test('[DR-SUBMIT-009] code recovery hydrates submitted read-only', async ({ page }) => {
  await page.goto(fixture('?recover=code'));
  await expect(page.getByTestId('recovery-method')).toHaveText('code');
  await expect(page.getByTestId('status')).toHaveText('submitted');
});

test('[DR-SUBMIT-010] initial PDF uses submitted hash', async ({ page }) => {
  await submitValid(page);
  await page.getByRole('button', { name: 'Download submitted responses (PDF)' }).click();
  await expect(page.getByTestId('pdf-hash')).toHaveText('a'.repeat(64));
});

test('[DR-SUBMIT-011] regenerated PDF uses the same submitted hash', async ({ page }) => {
  await submitValid(page);
  const original = await page.getByTestId('pdf-hash').textContent();
  await page.reload();
  await page.getByRole('button', { name: 'Download submitted responses (PDF)' }).click();
  await expect(page.getByTestId('pdf-hash')).toHaveText(original);
});

test('[DR-SUBMIT-012] Start New creates a separate draft', async ({ page }) => {
  await submitValid(page);
  await page.getByRole('button', { name: 'Start a New Questionnaire' }).click();
  await expect(page.getByTestId('draft-id')).toHaveText('draft-new-b');
});

test('[DR-SUBMIT-013] Start New leaves submitted record unchanged', async ({ page }) => {
  await submitValid(page);
  await page.getByRole('button', { name: 'Start a New Questionnaire' }).click();
  await expect(page.getByTestId('submitted-record')).toHaveText('unchanged');
});

test('[DR-SUBMIT-014] delayed save cannot revert submitted', async ({ page }) => {
  await submitValid(page);
  await expect(page.getByTestId('delayed-save')).toHaveText('rejected');
  await expect(page.getByTestId('status')).toHaveText('submitted');
});

test('[DR-SUBMIT-015] submission failure preserves exact answer', async ({ page }) => {
  await submitValid(page, '?failure=true');
  await expect(page.getByTestId('status')).toHaveText('submit_failed');
  await expect(page.getByLabel('Required answer')).toHaveValue('Final immutable answer');
});

test('[DR-SUBMIT-016] failed submission can retry without losing state', async ({ page }) => {
  await submitValid(page, '?failure=true');
  await page.getByRole('button', { name: 'Retry Submission' }).click();
  await expect(page.getByTestId('status')).toHaveText('submitted');
});

test('[DR-SUBMIT-017] submitted view has no Clear All control', async ({ page }) => {
  await submitValid(page);
  await expect(page.getByRole('button', { name: 'Clear All' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start a New Questionnaire' })).toBeVisible();
});
