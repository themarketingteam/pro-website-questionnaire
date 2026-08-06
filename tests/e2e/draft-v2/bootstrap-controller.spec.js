import { expect, test } from '../fixtures/safeTest.js';
import { createProDraftBootstrapCoordinator } from '../../../src/lib/proDraftBootstrapCoordinator.js';
import { createProDraftCredentialVault } from '../../../src/lib/proDraftCredentialVault.js';
import { createClientDraftIdentityContext } from '../../../src/lib/proDraftClientIdentityContext.js';
import { createEmptyCanonicalDraftState } from '../../../src/lib/questionnaireDraftState.js';
import { createResilientStorage } from '../../../src/lib/resilientStorage.js';

const namespace = `ns_${'e'.repeat(32)}`;
const recoverySessionToken = `${'a'.repeat(43)}.${'b'.repeat(43)}`;
const runtimeConfig = Object.freeze({
  environment: 'staging',
  environmentRecognized: true,
  configurationValid: true,
  durableDraftV2Enabled: true,
  publicEmailRecoveryEnabled: true,
  killSwitchEnabled: false,
});
const cryptoProvider = {
  getRandomValues(bytes) {
    bytes.fill(9);
    return bytes;
  },
};

const canonical = (draftStatus = 'active') => {
  const value = createEmptyCanonicalDraftState({
    draftId: 'draft-controller-synthetic',
    sessionId: 'session-controller-synthetic',
  });
  value.draftStatus = draftStatus;
  return value;
};

const serverResponse = (draftStatus = 'active', overrides = {}) => ({
  success: true,
  created: false,
  resumed: true,
  readOnly: draftStatus === 'submitted',
  authorizationMethod: 'resume_token',
  draft: {
    draftId: 'draft-controller-synthetic',
    sessionId: 'session-controller-synthetic',
    readOnly: draftStatus === 'submitted',
    canonicalState: canonical(draftStatus),
  },
  ...overrides,
});

const makeController = ({
  bootstrapResponse = { success: false },
  loadResponse = { success: false },
  emailResponse = { success: false },
  codeResponse = { success: false },
} = {}) => {
  const storage = createResilientStorage({
    indexedDB: null,
    localStorage: null,
    sessionStorage: null,
    timeoutMs: 20,
  });
  const vault = createProDraftCredentialVault({
    storage,
    environment: 'staging',
    browserNamespace: namespace,
  });
  const calls = { bootstrap: [], load: [], email: [], code: [], dispatch: [] };
  const coordinator = createProDraftBootstrapCoordinator({
    runtimeConfig,
    storage,
    credentialVault: vault,
    identityContext: createClientDraftIdentityContext({
      recoveryEmail: 'controller.synthetic@example.invalid',
      recoveryEmailSource: 'client_entered',
      recoveryEmailVerificationStatus: 'unverified',
      associationIntent: 'anonymous_start',
    }),
    browserNamespace: namespace,
    apiClient: {
      bootstrapProFormDraft: async (request) => {
        calls.bootstrap.push(request);
        return bootstrapResponse;
      },
      loadProFormDraft: async (request) => {
        calls.load.push(request);
        return loadResponse;
      },
    },
    recoveryApiClient: {
      recoverProFormDraftByEmail: async (request) => {
        calls.email.push(request);
        return emailResponse;
      },
      recoverProFormDraftByCode: async (request) => {
        calls.code.push(request);
        return codeResponse;
      },
    },
    canonicalCacheAdapter: {
      loadCanonicalDraftCache: async () => ({ ok: true, present: false, state: null }),
      saveCanonicalDraftCache: async () => ({ ok: true, written: true }),
    },
    dispatch: (action) => calls.dispatch.push(action),
    getDeviceId: async () => `pdd_${'D'.repeat(22)}`,
    cryptoProvider,
    now: () => Date.parse('2033-05-18T00:00:00.000Z'),
  });
  return { coordinator, storage, vault, calls };
};

const storedBundle = {
  version: 1,
  environment: 'staging',
  browserNamespace: namespace,
  draftId: 'draft-controller-synthetic',
  sessionId: 'session-controller-synthetic',
  resumeToken: 'R'.repeat(43),
  recoverySessionToken: null,
  recoverySessionExpiresAt: null,
  recoveryCode: null,
  recoveryCodeHint: null,
  recoveryCodeVersion: null,
  authorizationMethod: 'resume_token',
  storedAtClient: '2033-05-18T00:00:00.000Z',
  lastUsedAtClient: null,
};

test('[DR-MODAL-001] controller creates a new draft only after explicit choice', async () => {
  const subject = makeController({
    bootstrapResponse: serverResponse('active', {
      created: true,
      resumed: false,
      recoveryCode: '2345-6789-ABCD-EFGH-JKMN',
      authorizationMethod: 'new_anonymous_draft',
    }),
  });
  expect((await subject.coordinator.bootstrap()).phase).toBe('awaiting_client_choice');
  expect((await subject.coordinator.createNewDraftAssociation()).outcome)
    .toBe('new_draft_created');
  expect(subject.calls.bootstrap).toHaveLength(1);
});

test('[DR-REC-002] controller resumes a stored token on reload', async () => {
  const subject = makeController({ bootstrapResponse: serverResponse() });
  await subject.vault.saveDraftCredentialBundle(storedBundle);
  expect((await subject.coordinator.bootstrap()).outcome).toBe('stored_draft_resumed');
  expect(subject.calls.bootstrap[0].authorization).toEqual({ resumeToken: 'R'.repeat(43) });
});

test('[DR-REC-001] controller performs explicit email-recovery API handoff', async () => {
  const subject = makeController({
    emailResponse: {
      success: true,
      recoveryCompleted: true,
      recoverySessionToken,
      recoverySessionExpiresAt: '2033-05-19T00:00:00.000Z',
      otherEligibleDraftsAvailable: true,
      draft: { draftId: 'draft-controller-synthetic', recoveryCodeHint: 'JKMN' },
    },
    loadResponse: serverResponse(),
  });
  await subject.coordinator.bootstrap();
  const recovered = await subject.coordinator.recoverDraftByEmail(
    'Controller.Synthetic@Example.invalid',
  );
  expect(recovered).toMatchObject({
    outcome: 'email_draft_recovered', otherEligibleDraftsAvailable: true,
  });
  expect(subject.calls.load[0].authorization).toEqual({ recoverySessionToken });
});

test('[DR-REC-002] controller performs explicit code-recovery API handoff', async () => {
  const subject = makeController({
    codeResponse: {
      success: true,
      recoveryCompleted: true,
      recoverySessionToken,
      recoverySessionExpiresAt: '2033-05-19T00:00:00.000Z',
      draft: { draftId: 'draft-controller-synthetic', recoveryCodeHint: 'JKMN' },
    },
    loadResponse: serverResponse(),
  });
  await subject.coordinator.bootstrap();
  expect((await subject.coordinator.recoverDraftByCode(
    '2345 6789 abcd efgh jkmn',
  )).outcome).toBe('code_draft_recovered');
  expect(subject.calls.code[0].recoveryCode).toBe('2345-6789-ABCD-EFGH-JKMN');
});

test('[DR-PDF-001] controller hydrates submitted recovery read-only', async () => {
  const subject = makeController({ bootstrapResponse: serverResponse('submitted') });
  await subject.vault.saveDraftCredentialBundle(storedBundle);
  expect(await subject.coordinator.bootstrap()).toMatchObject({
    outcome: 'submitted_draft_loaded', readOnly: true,
  });
});

test('[DR-BOOT-001] controller keeps credentials page-local when storage is blocked', async () => {
  const subject = makeController({
    bootstrapResponse: serverResponse('active', {
      created: true,
      resumed: false,
      recoveryCode: '2345-6789-ABCD-EFGH-JKMN',
    }),
  });
  await subject.coordinator.bootstrap();
  const created = await subject.coordinator.createNewDraftAssociation();
  expect(created.memoryOnly).toBe(true);
  expect(subject.coordinator.getRecoveryCodeForDisplay())
    .toBe('2345-6789-ABCD-EFGH-JKMN');
  expect(subject.storage.getMode()).toBe('memory_only');
});
