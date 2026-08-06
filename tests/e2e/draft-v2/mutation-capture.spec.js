import { expect, test } from '../fixtures/safeTest.js';

const fixture = (name) => `/tests/e2e/fixtures/pro-draft-mutations.html?draft=${name}`;

test('[DR-MUT-001] partial numeric, geography, person, and confirmation editors restore', async ({ page }) => {
  await page.goto(fixture('partial-editors'));
  await page.getByTestId('numeric-small').fill('12');
  await page.getByTestId('numeric-large').fill('');
  await page.getByTestId('manual-location').fill('Austin draft');
  await page.getByTestId('person-name').fill('Jordan Client');
  await page.getByTestId('business-name').fill('Client Business');
  await page.getByTestId('domain').fill('invalid domain');
  await page.reload();
  await expect(page.getByTestId('numeric-small')).toHaveValue('12');
  await expect(page.getByTestId('manual-location')).toHaveValue('Austin draft');
  await expect(page.getByTestId('person-name')).toHaveValue('Jordan Client');
  await expect(page.getByTestId('business-name')).toHaveValue('Client Business');
  await expect(page.getByTestId('domain')).toHaveValue('invalid domain');
});

test('[DR-MUT-001] Q5 structural operations, cleanup, reset, and metadata persist atomically', async ({ page }) => {
  await page.goto(fixture('structural'));
  await page.getByTestId('manual-location').fill('Austin');
  await page.getByTestId('add-location').click();
  await page.getByTestId('update-location').click();
  await page.getByTestId('set-primary').click();
  await page.getByTestId('metadata-only').click();
  await page.getByTestId('seed-child').click();
  await page.getByTestId('hide-child').click();
  await page.reload();
  await expect(page.getByTestId('draft-json')).toContainText('isGreaterArea');
  await expect(page.getByTestId('draft-json')).not.toContainText('Draft cert');
  await expect(page.getByTestId('draft-json')).toContainText('"validation":{"6":"complete"}');
  await page.getByTestId('reset-q5').click();
  await expect(page.getByTestId('draft-json')).not.toContainText('Austin');
});

test('[DR-MUT-001] offline edits reconnect and survive browser close/reopen', async ({ context, page }) => {
  await page.goto(fixture('offline-close'));
  await page.getByTestId('offline').click();
  await page.getByTestId('numeric-small').fill('33');
  await expect(page.getByTestId('sync-status')).toHaveText('offline_local_only');
  await page.getByTestId('online').click();
  await expect(page.getByTestId('sync-status')).toHaveText('server_saved');
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(fixture('offline-close'));
  await expect(reopened.getByTestId('numeric-small')).toHaveValue('33');
});

test('[DR-MUT-001] file selection persists metadata and never serializes a raw File', async ({ page }) => {
  await page.goto(fixture('file-metadata'));
  await page.getByTestId('file').setInputFiles({
    name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from('synthetic'),
  });
  await expect(page.getByTestId('draft-json')).toContainText('"originalFileName":"logo.png"');
  await expect(page.getByTestId('draft-json')).toContainText('"uploadStatus":"uploaded"');
  await expect(page.getByTestId('raw-file-present')).toHaveText('no');
  await page.reload();
  await expect(page.getByTestId('draft-json')).toContainText('logo.png');
});
