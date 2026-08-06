import { expect, test } from '../fixtures/safeTest.js';
import { installBroadcastChannelUnavailable } from '../fixtures/multiTabFixtures.js';

const fixture = (draft, tab) => (
  `/tests/e2e/fixtures/pro-draft-conflict.html?draft=${draft}&tab=${tab}`
);

const openPair = async (context, draft) => {
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  await Promise.all([tabA.goto(fixture(draft, 'a')), tabB.goto(fixture(draft, 'b'))]);
  return { tabA, tabB };
};

test('[DR-CONCUR-001] preserves non-overlapping edits from two tabs and reload', async ({ context }) => {
  const { tabA, tabB } = await openPair(context, 'draft-nonoverlap');
  await tabA.getByTestId('answer-qA').fill('Answer from A');
  await tabB.getByTestId('answer-qB').fill('Answer from B');
  await tabA.getByTestId('save').click();
  await expect(tabA.getByTestId('status')).toHaveText('saved');
  await tabB.getByTestId('save').click();
  await expect(tabB.getByTestId('status')).toHaveText('saved');
  await tabA.reload();
  await expect(tabA.getByTestId('answer-qA')).toHaveValue('Answer from A');
  await expect(tabA.getByTestId('answer-qB')).toHaveValue('Answer from B');
});

test('[DR-CONCUR-001] requires a choice and can keep the local same-field edit', async ({ context }) => {
  const { tabA, tabB } = await openPair(context, 'draft-local-choice');
  await tabA.getByTestId('answer-qA').fill('Saved A');
  await tabB.getByTestId('answer-qA').fill('Local B');
  await tabA.getByTestId('save').click();
  await tabB.getByTestId('save').click();
  await expect(tabB.getByRole('dialog')).toBeVisible();
  await tabB.getByRole('radio', { name: /This browser/u }).click();
  await tabB.getByRole('button', { name: 'Apply my choices' }).click();
  await tabA.reload();
  await expect(tabA.getByTestId('answer-qA')).toHaveValue('Local B');
});

test('[DR-CONCUR-001] can keep the other saved same-field version', async ({ context }) => {
  const { tabA, tabB } = await openPair(context, 'draft-server-choice');
  await tabA.getByTestId('answer-qA').fill('Saved A');
  await tabB.getByTestId('answer-qA').fill('Local B');
  await tabA.getByTestId('save').click();
  await tabB.getByTestId('save').click();
  await tabB.getByRole('radio', { name: /Other saved version/u }).click();
  await tabB.getByRole('button', { name: 'Apply my choices' }).click();
  await tabA.reload();
  await expect(tabA.getByTestId('answer-qA')).toHaveValue('Saved A');
});

test('[DR-CONCUR-001] pending edits cannot revert a submitted server draft', async ({ context }) => {
  const { tabA, tabB } = await openPair(context, 'draft-submit-lock');
  await tabB.getByTestId('answer-qB').fill('Pending B');
  await tabA.getByTestId('answer-qA').fill('Final A');
  await tabA.getByTestId('submit').click();
  await tabB.getByTestId('save').click();
  await expect(tabB.getByTestId('status')).toHaveText('submitted');
  await tabB.reload();
  await expect(tabB.getByTestId('answer-qA')).toHaveValue('Final A');
  await expect(tabB.getByTestId('answer-qB')).toHaveValue('');
});

test('[DR-CONCUR-001] server conflicts protect data when BroadcastChannel is disabled', async ({ context }) => {
  await installBroadcastChannelUnavailable(context);
  const { tabA, tabB } = await openPair(context, 'draft-storage-fallback');
  await tabA.getByTestId('answer-qA').fill('Saved A');
  await tabB.getByTestId('answer-qA').fill('Local B');
  await tabA.getByTestId('save').click();
  await tabB.getByTestId('save').click();
  await expect(tabB.getByRole('dialog')).toBeVisible();
});

test('[DR-CONCUR-001] different draft namespaces never coordinate', async ({ context }) => {
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  await Promise.all([
    tabA.goto(fixture('draft-isolated-a', 'a')),
    tabB.goto(fixture('draft-isolated-b', 'b')),
  ]);
  await tabA.getByTestId('answer-qA').fill('Only A');
  await tabA.getByTestId('save').click();
  await tabB.reload();
  await expect(tabB.getByTestId('answer-qA')).toHaveValue('');
  await expect(tabB.getByTestId('accepted-revision')).toHaveAttribute('data-accepted-revision', '0');
});
