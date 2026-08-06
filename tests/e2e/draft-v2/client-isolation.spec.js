import { expect, test } from '../fixtures/safeTest.js';
import { installStorageFailureMode } from '../fixtures/storageFixtures.js';
import {
  createQuestionnaireFixture,
  createSecondIsolatedClient,
} from '../fixtures/questionnaireFixtures.js';

const buildClientUrl = (client) => {
  const parameters = new URLSearchParams({
    userId: client.userId,
    userEmail: client.email,
    businessName: client.businessName,
    domainName: client.domain,
  });
  return `/?${parameters.toString()}`;
};

const openQuestionSix = async (page) => {
  const wrapper = page.getByTestId('question-wrapper-6');
  await expect(wrapper).toBeVisible();
  const textbox = wrapper.getByRole('textbox');
  if (await textbox.count() === 0) {
    await wrapper.locator(':scope > div').first().click();
  }
  await expect(textbox).toBeVisible();
  return textbox;
};

for (const storageMode of ['normal', 'indexeddb_unavailable']) {
  test(`[DR-LOCAL-002] isolates and restores two clients: ${storageMode}`, async ({
    context,
    page,
  }) => {
    await installStorageFailureMode(context, storageMode);
    const clientA = createQuestionnaireFixture();
    const clientB = createSecondIsolatedClient(clientA);
    const clientAAnswer = `Synthetic local answer ${clientA.testRunId}`;

    await page.goto(buildClientUrl(clientA));
    const clientAInput = await openQuestionSix(page);
    await clientAInput.fill(clientAAnswer);
    await expect(page.getByText('Progress saved in this browser.')).toBeVisible();

    await page.goto(buildClientUrl(clientB));
    await expect(await openQuestionSix(page)).toHaveValue('');

    await page.goto(buildClientUrl(clientA));
    await expect(await openQuestionSix(page)).toHaveValue(clientAAnswer);
  });
}

test('[DR-LOCAL-002] memory-only state is page-lifetime and labeled truthfully', async ({
  context,
  page,
}) => {
  await installStorageFailureMode(context, 'all_persistent_storage_unavailable');
  const client = createQuestionnaireFixture();

  await page.goto(buildClientUrl(client));
  const input = await openQuestionSix(page);
  await input.fill(`Synthetic page-lifetime answer ${client.testRunId}`);
  await expect(page.getByText('Progress is available for this page only.')).toBeVisible();

  await page.reload();
  await expect(await openQuestionSix(page)).toHaveValue('');
});

test('[DR-SEC-001] prevents cross-client recovery in independent contexts', () => {
  test.fixme(true, '[DR-SEC-001] Pending V2 recovery authorization boundary and staging corpus');
});
