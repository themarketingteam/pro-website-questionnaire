import { expect, test } from '../fixtures/safeTest.js';
import { installStorageFailureMode } from '../fixtures/storageFixtures.js';

const forbiddenEntityPath = /ProForm(?:DraftEvent|Draft|SubmissionIntake|RecoverySecurityEvent|EmailVerificationAttempt)/u;

test('[DR-ADMIN-UI-001] renders the accessible password gate without credential artifacts', async ({ page }) => {
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  const response = await page.goto('/admin/draft-recovery');
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole('heading', { name: 'Draft Recovery Access' })).toBeVisible();
  await expect(page.getByLabel('Recovery access password')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unlock Draft Recovery' })).toBeDisabled();
  await expect(page.getByText(/This device will remain authorized/)).toBeVisible();
  expect(page.url()).not.toMatch(/(?:adminGrant|recoveryGrant|password|token)=/iu);
  expect(await page.locator('body').innerText()).not.toMatch(/synthetic.raw-grant|adminGrant/iu);
  expect(requests.some((url) => forbiddenEntityPath.test(url))).toBe(false);
});

test('[DR-ADMIN-UI-002] remains usable and truthful when persistent storage is blocked', async ({ context, page }) => {
  await installStorageFailureMode(context, 'all_persistent_storage_unavailable');
  await page.goto('/admin/draft-recovery');
  await expect(page.getByRole('heading', { name: 'Draft Recovery Access' })).toBeVisible();
  await expect(page.getByText('This browser is not allowing persistent storage. You may need to enter the recovery password again after closing it.')).toBeVisible();
  await expect(page.getByLabel('Recovery access password')).toBeEditable();
});

test('[DR-ADMIN-UI-003] keeps the gate operable at mobile widths', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile layout assertion runs in mobile browser projects.');
  await page.goto('/admin/draft-recovery');
  const card = page.getByRole('heading', { name: 'Draft Recovery Access' }).locator('xpath=ancestor::div[contains(@class,"max-w-md")]');
  await expect(card).toBeVisible();
  const box = await card.boundingBox();
  expect(box.width).toBeLessThanOrEqual((await page.viewportSize()).width);
});

test('[DR-ADMIN-UI-004] marks credentialed live admin scenarios as staging-only', () => {
  test.fixme(true, 'Password, restart restore, wrong-password lockout, authorized list/search/detail/events/edit/conflict/lineage/retry/repair/forget and revocation require an explicitly configured synthetic staging admin password and write-safe Base44 corpus.');
});
