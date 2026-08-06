import { expect, test } from '../fixtures/safeTest.js';
import {
  installRuntimePersistentWriteFailure,
  installStorageFailureMode,
  readCanonicalDraftCache,
  replaceCanonicalDraftCacheWithMalformed,
} from '../fixtures/storageFixtures.js';
import { createQuestionnaireFixture } from '../fixtures/questionnaireFixtures.js';
import { openFreshContextWithStorageState } from '../fixtures/lifecycleFixtures.js';
import { installReadOnlyNetworkPolicy } from '../helpers/networkCapture.js';
import { resolveE2ETarget } from '../helpers/targetSafety.js';

const buildClientUrl = (client) => {
  const parameters = new URLSearchParams({
    userId: client.userId,
    userEmail: client.email,
    businessName: client.businessName,
    domainName: client.domain,
  });
  return `/?${parameters.toString()}`;
};

const openQuestion = async (page, questionId) => {
  const wrapper = page.getByTestId(`question-wrapper-${questionId}`);
  await expect(wrapper).toBeVisible();
  const controls = wrapper.locator('input, textarea');
  if (await controls.count() === 0) await wrapper.locator(':scope > div').first().click();
  return wrapper;
};

const openQuestionSix = async (page) => {
  const wrapper = await openQuestion(page, '6');
  const textbox = wrapper.getByRole('textbox');
  await expect(textbox).toBeVisible();
  return textbox;
};

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

test('[DR-LOCAL-001] restores the last good local snapshot after a failed write', async ({
  page,
  safetyCapture,
}) => {
  const client = createQuestionnaireFixture();
  const committedValue = `Synthetic committed value ${client.testRunId}`;
  const failedValue = `Synthetic failed-write value ${client.testRunId}`;
  await page.goto(buildClientUrl(client));
  const input = await openQuestionSix(page);
  await input.fill(committedValue);
  await expect(page.getByText('Progress saved in this browser.')).toBeVisible();
  await expect.poll(async () => (
    (await readCanonicalDraftCache(page))?.state?.responses?.['6']
  )).toBe(committedValue);

  await installRuntimePersistentWriteFailure(page);
  await input.fill(failedValue);
  await expect(page.getByText('Progress is available for this page only.')).toBeVisible();
  await page.reload();
  await expect(await openQuestionSix(page)).toHaveValue(committedValue);
  expect(safetyCapture.consoleCapture.pageErrors).toEqual([]);
});

test('[DR-LOCAL-003] round-trips canonical values and browser context storage after reload', async ({
  browser,
  context,
  page,
  safetyCapture,
}) => {
  const client = createQuestionnaireFixture();
  const answer = `Synthetic canonical reload value ${client.testRunId}`;
  await page.goto(buildClientUrl(client));
  await (await openQuestionSix(page)).fill(answer);
  await expect(page.getByText('Progress saved in this browser.')).toBeVisible();
  await expect.poll(async () => readCanonicalDraftCache(page)).not.toBeNull();
  const canonicalCache = await readCanonicalDraftCache(page);
  expect(canonicalCache.state.responses['6']).toBe(answer);
  expect(canonicalCache.state.touchedQuestions['6']).toBe(true);
  expect(canonicalCache.state.expandedQuestions['6']).toBe(true);

  const storageState = await context.storageState({ indexedDB: true });
  const origin = new URL(page.url()).origin;
  expect(storageState.origins.some((entry) => entry.origin === origin)).toBe(true);

  await page.reload();
  await expect(await openQuestionSix(page)).toHaveValue(answer);

  const freshContext = await openFreshContextWithStorageState(browser, storageState);
  try {
    const freshPage = await freshContext.newPage();
    const freshPageErrors = [];
    freshPage.on('pageerror', (error) => freshPageErrors.push(error.name));
    await installReadOnlyNetworkPolicy(freshPage, resolveE2ETarget(process.env));
    await freshPage.goto(`${origin}${buildClientUrl(client)}`);
    await expect(await openQuestionSix(freshPage)).toHaveValue(answer);
    expect(freshPageErrors).toEqual([]);
  } finally {
    await freshContext.close();
  }
  expect(safetyCapture.consoleCapture.pageErrors).toEqual([]);
});

test('[DR-LOCAL-003] restores validation, touched, and expanded state', async ({
  page,
  safetyCapture,
}) => {
  const client = createQuestionnaireFixture();
  await page.goto(buildClientUrl(client));
  const wrapper = await openQuestion(page, '1');
  await wrapper.locator('label[for="q_1_no"]').click({ force: true });
  await expect(page.getByText('Progress saved in this browser.')).toBeVisible();
  await expect.poll(async () => {
    const state = (await readCanonicalDraftCache(page))?.state;
    return {
      expanded: state?.expandedQuestions?.['1'],
      response: state?.responses?.['1'],
      touched: state?.touchedQuestions?.['1'],
      validation: state?.validationStatus?.['1'],
    };
  }).toEqual({ expanded: true, response: 'no', touched: true, validation: 'complete' });

  await page.reload();
  const restored = await openQuestion(page, '1');
  await expect(restored.getByLabel('No')).toBeChecked();
  expect(safetyCapture.consoleCapture.pageErrors).toEqual([]);
});

test('[DR-LOCAL-004] malformed canonical cache never overwrites valid Redux state', async ({
  page,
  safetyCapture,
}) => {
  const client = createQuestionnaireFixture();
  const answer = `Synthetic Redux fallback value ${client.testRunId}`;
  await page.goto(buildClientUrl(client));
  await (await openQuestionSix(page)).fill(answer);
  await expect(page.getByText('Progress saved in this browser.')).toBeVisible();
  await expect.poll(async () => (
    (await readCanonicalDraftCache(page))?.state?.responses?.['6']
  )).toBe(answer);
  expect(await replaceCanonicalDraftCacheWithMalformed(page)).toBe(true);

  await page.reload();
  await expect(await openQuestionSix(page)).toHaveValue(answer);
  expect((await readCanonicalDraftCache(page))?.state).toBeNull();
  expect(safetyCapture.consoleCapture.pageErrors).toEqual([]);
});

test('[DR-SAVE-001] round-trips the canonical server draft after reload', () => {
  test.fixme(true, '[DR-SAVE-001] Pending V2 canonical server draft contract and staging write authorization');
});
