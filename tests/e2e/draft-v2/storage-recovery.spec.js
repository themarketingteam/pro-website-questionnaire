import { expect, test } from '../fixtures/safeTest.js';
import { installStorageFailureMode } from '../fixtures/storageFixtures.js';

const ACTIVE_BOOT_STORAGE_MODES = Object.freeze([
  'normal',
  'localstorage_getter_throws',
  'localstorage_read_throws',
  'localstorage_write_throws',
  'localstorage_quota_exceeded',
  'indexeddb_unavailable',
  'all_persistent_storage_unavailable',
]);

for (const storageMode of ACTIVE_BOOT_STORAGE_MODES) {
  test(`[DR-BOOT-001][DR-BOOT-002] boots within five seconds: ${storageMode}`, async ({
    context,
    page,
    safetyCapture,
  }) => {
    await installStorageFailureMode(context, storageMode);
    const startedAt = Date.now();
    const deadline = startedAt + 5_000;
    const remaining = () => Math.max(1, deadline - Date.now());

    const response = await page.goto('/', {
      timeout: remaining(),
      waitUntil: 'domcontentloaded',
    });
    expect(response?.ok()).toBe(true);

    const shell = page.getByTestId('application-runtime-shell');
    await expect(shell).toBeVisible({ timeout: remaining() });
    await expect(
      page.getByRole('heading', { name: /Pro \| Website Content Questionnaire/i }),
    ).toBeVisible({ timeout: remaining() });
    await expect(page.getByTestId('question-wrapper-1')).toBeVisible({ timeout: remaining() });

    expect(Date.now() - startedAt).toBeLessThanOrEqual(5_000);
    expect(safetyCapture.consoleCapture.pageErrors).toEqual([]);
    expect(safetyCapture.consoleCapture.consoleErrors).toEqual([]);
    expect(safetyCapture.networkCapture.zapierRequests).toEqual([]);
    expect(safetyCapture.networkCapture.unsafeRequests).toEqual([]);

    const safeConsoleText = JSON.stringify(safetyCapture.consoleCapture.safeSummary());
    expect(safeConsoleText).not.toContain('access_token');
  });
}

test('[DR-LOCAL-001] restores the last good local snapshot after a failed write', () => {
  test.fixme(true, '[DR-LOCAL-001] Pending V2 local persistence and last-good-snapshot implementation');
});

test('[DR-SAVE-001] round-trips the canonical questionnaire state after reload', () => {
  test.fixme(true, '[DR-SAVE-001] Pending V2 canonical server draft contract and staging write authorization');
});
