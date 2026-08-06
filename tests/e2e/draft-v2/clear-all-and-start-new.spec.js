import { expect, test } from '../fixtures/safeTest.js';

const fixture = (query = '') => `/tests/e2e/fixtures/pro-draft-replacement.html${query}`;
const replace = async (page, { submitted = false } = {}) => {
  await page.goto(fixture(submitted ? '?status=submitted' : ''));
  await page.getByRole('button', { name: submitted ? 'Start a New Questionnaire' : 'Clear All' }).click();
  await page.getByRole('dialog', {
    name: submitted ? 'Create a new questionnaire?' : 'Start over with a new questionnaire?',
  }).getByRole('button', {
    name: submitted ? 'Start a New Questionnaire' : 'Create a new blank draft',
  }).click();
  await expect(page.getByRole('dialog', { name: 'Save your new recovery code' })).toBeVisible();
};

test('[DR-REPLACE-001] Active draft Clear All commits a replacement', async ({ page }) => {
  await replace(page);
  await expect(page.getByTestId('draft-id')).toHaveText('draft-new-a');
});

test('[DR-REPLACE-002] old active record becomes superseded but remains retained', async ({ page }) => {
  await replace(page);
  await expect(page.getByTestId('source-status')).toHaveText('cleared_superseded');
  await expect(page.getByTestId('source-retained')).toHaveText('true');
});

test('[DR-REPLACE-003] replacement form is blank and editable', async ({ page }) => {
  await replace(page);
  await expect(page.getByLabel('Question 1')).toHaveValue('');
  await page.getByLabel('Question 1').fill('New answer');
  await expect(page.getByLabel('Question 1')).toHaveValue('New answer');
});

test('[DR-REPLACE-004] new one-time recovery code is visible', async ({ page }) => {
  await replace(page);
  await expect(page.getByTestId('new-draft-recovery-code')).toHaveText('ABCD-EFGH-JKMP');
});

test('[DR-REPLACE-005] email success is reported truthfully', async ({ page }) => {
  await replace(page);
  await expect(page.getByText('A copy of this new recovery code was sent to your recovery email.')).toBeVisible();
});

test('[DR-REPLACE-006] old answers are absent after replacement', async ({ page }) => {
  await replace(page);
  await expect(page.getByLabel('Question 1')).not.toHaveValue('Old active answer');
});

test('[DR-REPLACE-007] old answers stay absent after reload', async ({ page }) => {
  await replace(page);
  await page.reload();
  await expect(page.getByLabel('Question 1')).toHaveValue('');
});

test('[DR-REPLACE-008] email recovery selection points at the replacement', async ({ page }) => {
  await replace(page);
  await expect(page.getByTestId('recovery-selection')).toHaveText('draft-new-a');
});

test('[DR-REPLACE-009] old cleared draft is excluded from automatic recovery', async ({ page }) => {
  await replace(page);
  await expect(page.getByTestId('recovery-selection')).not.toHaveText('draft-old-a');
});

test('[DR-REPLACE-010] unrelated Client B browser state is untouched', async ({ page }) => {
  await replace(page);
  await expect(page.getByTestId('client-b')).toHaveText('Client B untouched');
});

test('[DR-REPLACE-011] replacement works in memory-only storage mode', async ({ page }) => {
  await page.goto(fixture('?memory=true'));
  await page.getByRole('button', { name: 'Clear All' }).click();
  await page.getByRole('button', { name: 'Create a new blank draft' }).click();
  await expect(page.getByTestId('storage-mode')).toHaveText('memory_only');
  await expect(page.getByTestId('draft-id')).toHaveText('draft-new-a');
});

test('[DR-REPLACE-012] partial email failure does not block the new draft', async ({ page }) => {
  await page.goto(fixture('?delivery=failure'));
  await page.getByRole('button', { name: 'Clear All' }).click();
  await page.getByRole('button', { name: 'Create a new blank draft' }).click();
  await expect(page.getByText(/new draft was created, but we could not send/u)).toBeVisible();
  await expect(page.getByTestId('draft-id')).toHaveText('draft-new-a');
});

test('[DR-REPLACE-013] submitted view exposes Start New instead of Clear All', async ({ page }) => {
  await page.goto(fixture('?status=submitted'));
  await expect(page.getByRole('button', { name: 'Start a New Questionnaire' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear All' })).toHaveCount(0);
});

test('[DR-REPLACE-014] Start New retains the submitted record and credentials', async ({ page }) => {
  await replace(page, { submitted: true });
  await expect(page.getByTestId('source-status')).toHaveText('submitted');
  await expect(page.getByTestId('source-retained')).toHaveText('true');
  await expect(page.getByTestId('old-credentials')).toHaveText('true');
});

test('[DR-REPLACE-015] submitted Start New opens an editable blank draft', async ({ page }) => {
  await replace(page, { submitted: true });
  await expect(page.getByLabel('Question 1')).toHaveValue('');
  await page.getByLabel('Question 1').fill('Editable replacement');
  await expect(page.getByLabel('Question 1')).toHaveValue('Editable replacement');
});

test('[DR-REPLACE-016] browser Back resolves old source to a safe read-only view', async ({ page }) => {
  await replace(page, { submitted: true });
  await page.goBack();
  await expect(page.getByTestId('history-view')).toHaveText('submitted');
});

test('[DR-REPLACE-017] a stale old save never updates the replacement', async ({ page }) => {
  await replace(page);
  await expect(page.getByTestId('stale-save-applied')).toHaveText('false');
});

test('[DR-REPLACE-018] replacement uses internal history with no reload race or URL credentials', async ({ page }) => {
  await replace(page);
  await expect(page.getByTestId('hard-reloads')).toHaveText('0');
  expect(page.url()).not.toMatch(/(?:recoveryCode|resumeToken|recoverySessionToken)=/u);
});
