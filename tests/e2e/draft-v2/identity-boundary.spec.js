import { expect, test } from '../fixtures/safeTest.js';
import { installStorageFailureMode } from '../fixtures/storageFixtures.js';
import {
  createClientDraftIdentityContext,
  getSafeClientIdentityContextDiagnostics,
} from '../../../src/lib/proDraftClientIdentityContext.js';
import {
  buildQuestionnaireStorageKey,
  deriveQuestionnaireBrowserNamespace,
} from '../../../src/lib/questionnaireBrowserNamespace.js';
import {
  createEmptyCanonicalDraftState,
  hashCanonicalDraftState,
  serializeCanonicalDraftState,
} from '../../../src/lib/questionnaireDraftState.js';

const openQuestionSix = async (page) => {
  const wrapper = page.getByTestId('question-wrapper-6');
  await expect(wrapper).toBeVisible();
  const textbox = wrapper.getByRole('textbox');
  if (await textbox.count() === 0) await wrapper.locator(':scope > div').first().click();
  await expect(textbox).toBeVisible();
  return textbox;
};

const identityMetadata = (context) => ({
  identityContextVersion: context.identityVersion,
  recoveryEmailSource: context.recoveryEmailSource,
  recoveryEmailVerificationStatus: context.recoveryEmailVerificationStatus,
  identityAssociationIntent: context.associationIntent,
  anonymousRecoveryAcknowledged: context.anonymousRecoveryAcknowledged,
  signedInvitationEmailChanged: context.signedInvitationEmailChanged,
});

const buildCacheEnvelope = async (state) => {
  const canonicalStateJson = serializeCanonicalDraftState(state);
  return JSON.stringify({
    cacheVersion: 1,
    namespaceVersion: 'v5',
    canonicalStateJson,
    canonicalStateHash: await hashCanonicalDraftState(state),
    canonicalStateSchemaVersion: 4,
    savedAtClient: '2000-01-01T00:00:00.000Z',
    storageMode: 'localstorage',
    byteSize: new TextEncoder().encode(canonicalStateJson).byteLength,
  });
};

test('[DR-IDENTITY-001] signed-style URL claims stay unverified in browser state', async ({
  context,
  page,
}) => {
  await installStorageFailureMode(context, 'indexeddb_unavailable');
  const url = '/?signedInvitationId=untrusted-claim&signedInvitationEmail=person%40example.test&userEmail=person%40example.test';
  await page.goto(url);
  const textbox = await openQuestionSix(page);
  await textbox.fill('Synthetic untrusted identity answer');
  await expect(page.getByText('Progress saved in this browser.')).toBeVisible();

  const canonicalStates = await page.evaluate(() => Object.entries(localStorage)
    .filter(([key]) => key.endsWith(':draft-cache'))
    .map(([, value]) => {
      const stored = JSON.parse(value);
      const envelope = JSON.parse(typeof stored.value === 'string' ? stored.value : value);
      return JSON.parse(envelope.canonicalStateJson);
    }));
  expect(canonicalStates).toHaveLength(1);
  expect(canonicalStates[0].identityContext).toMatchObject({
    recoveryEmailSource: 'client_entered',
    recoveryEmailVerificationStatus: 'unverified',
  });
  expect(canonicalStates[0].credentials.recoveryEmail).toBe('person@example.test');
});

test('[DR-IDENTITY-002] verified signed fixture selects the signed namespace only', async ({ page }) => {
  const verified = createClientDraftIdentityContext({
    recoveryEmail: 'verified@example.test',
    signedInvitationEmail: 'verified@example.test',
    signedInvitationId: 'verified-invitation-fixture',
    recoveryEmailSource: 'signed_invitation',
    recoveryEmailVerificationStatus: 'verified_signed_invitation',
    associationIntent: 'resume_current_draft',
  }, { trustedBackendResult: true });
  const namespace = deriveQuestionnaireBrowserNamespace(verified);
  const key = buildQuestionnaireStorageKey({ namespace, purpose: 'draft-cache' });

  await page.goto('/');
  await page.evaluate(({ storageKey }) => localStorage.setItem(storageKey, 'synthetic'), {
    storageKey: key,
  });
  await page.reload();
  expect(await page.evaluate(({ storageKey }) => localStorage.getItem(storageKey), {
    storageKey: key,
  })).toBe('synthetic');
  expect(key).not.toContain('verified@example.test');
  expect(getSafeClientIdentityContextDiagnostics(verified)).toMatchObject({
    identitySource: 'signed_invitation',
    verificationState: 'verified_signed_invitation',
  });
});

test('[DR-IDENTITY-003] changed signed email cannot hydrate the old signed cache', async ({
  context,
  page,
}) => {
  await installStorageFailureMode(context, 'indexeddb_unavailable');
  const verified = createClientDraftIdentityContext({
    recoveryEmail: 'old@example.test',
    signedInvitationEmail: 'old@example.test',
    signedInvitationId: 'old-signed-invitation',
    recoveryEmailSource: 'signed_invitation',
    recoveryEmailVerificationStatus: 'verified_signed_invitation',
    associationIntent: 'resume_current_draft',
  }, { trustedBackendResult: true });
  const oldState = {
    ...createEmptyCanonicalDraftState(),
    responses: { 6: 'Synthetic old signed answer' },
    credentials: { recoveryEmail: verified.normalizedRecoveryEmail },
    identityContext: identityMetadata(verified),
  };
  const oldNamespace = deriveQuestionnaireBrowserNamespace(verified);
  const changed = createClientDraftIdentityContext({
    recoveryEmail: 'new@example.test',
    signedInvitationEmail: 'old@example.test',
    signedInvitationId: 'old-signed-invitation',
  });
  const changedNamespace = deriveQuestionnaireBrowserNamespace(changed);
  expect(changed.associationIntent).toBe('changed_signed_email');
  expect(changedNamespace).not.toBe(oldNamespace);
  const oldKey = buildQuestionnaireStorageKey({ namespace: oldNamespace, purpose: 'draft-cache' });
  const oldEnvelope = await buildCacheEnvelope(oldState);
  await context.addInitScript(({ storageKey, storageValue }) => {
    localStorage.setItem(storageKey, storageValue);
  }, { storageKey: oldKey, storageValue: oldEnvelope });

  await page.goto('/?signedInvitationId=old-signed-invitation&signedInvitationEmail=old%40example.test&userEmail=new%40example.test');
  await expect(await openQuestionSix(page)).toHaveValue('');
  expect(await page.evaluate(({ storageKey }) => localStorage.getItem(storageKey), {
    storageKey: oldKey,
  })).toBe(oldEnvelope);
});

test('[DR-IDENTITY-004] acknowledged anonymous test state is session-stable', async ({
  context,
  page,
}) => {
  await installStorageFailureMode(context, 'indexeddb_unavailable');
  const anonymous = createClientDraftIdentityContext({
    recoveryEmail: '',
    recoveryEmailSource: 'anonymous',
    associationIntent: 'anonymous_start',
    anonymousRecoveryAcknowledged: true,
  });
  const anonymousLaunchId = 'synthetic-anonymous-browser-session';
  const namespace = deriveQuestionnaireBrowserNamespace(anonymous, { anonymousLaunchId });
  await context.addInitScript(({ launchId }) => {
    sessionStorage.setItem('pro-questionnaire:anonymous-launch:v1', launchId);
  }, { launchId: anonymousLaunchId });

  await page.goto('/');
  const answer = 'Synthetic anonymous session answer';
  await (await openQuestionSix(page)).fill(answer);
  await expect(page.getByText('Progress saved in this browser.')).toBeVisible();
  await page.reload();
  await expect(await openQuestionSix(page)).toHaveValue(answer);
  expect(namespace).toMatch(/^ns_[a-f\d]{32}$/);
  expect(getSafeClientIdentityContextDiagnostics(anonymous)).toMatchObject({
    identitySource: 'anonymous',
    hasRecoveryEmail: false,
    anonymousRecoveryAcknowledged: true,
  });
});
