import { describe, expect, it } from 'vitest';
import {
  MAX_EVENT_BATCH_SIZE,
  PRO_DRAFT_API_ERROR_CODES,
  PRO_DRAFT_API_OPERATION_NAMES,
  PRO_DRAFT_API_VERSION,
  ProDraftApiError,
  buildDraftApiErrorResponse,
  buildDraftApiSuccessResponse,
  getSafeDraftApiDiagnostics,
  validateAppendEventsRequest,
  validateBootstrapDraftRequest,
  validateDraftAuthorizationInput,
  validateDraftClientContext,
  validateLoadDraftRequest,
  validateSaveDraftRequest,
} from '../../base44/functions/_shared/proDraftApi/entry.ts';

const TOKEN = 'A'.repeat(43);
const REQUEST_ID = `pdrq_${'R'.repeat(43)}`;
const HASH = 'a'.repeat(64);
const authorization = (overrides = {}) => ({ resumeToken: TOKEN, ...overrides });
const clientContext = (overrides = {}) => ({
  formType: 'pro-questionnaire',
  identityContextVersion: 1,
  associationIntent: 'resume_current_draft',
  anonymousRecoveryAcknowledged: false,
  sourceTabId: 'tab-synthetic-1',
  environment: 'staging',
  ...overrides,
});
const canonicalState = (overrides = {}) => ({
  schemaVersion: 4,
  formType: 'pro-questionnaire',
  draftId: 'draft-synthetic-1',
  sessionId: 'session-synthetic-1',
  draftStatus: 'active',
  clientRevision: 2,
  serverRevision: 5,
  savedAtClient: '2026-08-05T12:00:00.000Z',
  savedAtServer: '2026-08-05T12:00:01.000Z',
  sourceTabId: 'tab-synthetic-1',
  responses: { 6: 'Synthetic answer' },
  validationStatus: { 6: 'complete' },
  touchedQuestions: { 6: true },
  expandedQuestions: { 6: true },
  textValidationMeta: {},
  credentials: {},
  identityContext: {
    identityContextVersion: 1,
    recoveryEmailSource: 'anonymous',
    recoveryEmailVerificationStatus: 'unverified',
    identityAssociationIntent: 'resume_current_draft',
    anonymousRecoveryAcknowledged: false,
    signedInvitationEmailChanged: false,
  },
  uiDraftState: {},
  fieldChangeMetadata: {},
  currentQuestionId: '6',
  lastChangedQuestionId: '6',
  lastMutation: null,
  submission: {
    finalSubmissionId: null,
    submittedAt: null,
    submittedStateHash: null,
    pdfSourceStateHash: null,
    lastSubmissionErrorCode: null,
  },
  compatibility: {
    sourceType: 'canonical',
    sourceVersion: 4,
    migratedAtClient: null,
    migrationWarnings: [],
  },
  ...overrides,
});

const bootstrapRequest = (overrides = {}) => ({
  apiVersion: PRO_DRAFT_API_VERSION,
  idempotencyKey: 'bootstrap.synthetic.0001',
  authorization: authorization(),
  clientContext: clientContext(),
  localStateSummary: {
    schemaVersion: 4,
    clientRevision: 2,
    stateHash: HASH,
    byteSize: 1024,
    hasRecoverableState: true,
  },
  testRunId: 'test-run-synthetic-1',
  ...overrides,
});

const saveRequest = (overrides = {}) => ({
  apiVersion: 1,
  authorization: authorization(),
  draftId: 'draft-synthetic-1',
  expectedServerRevision: 5,
  idempotencyKey: 'save.synthetic.0001',
  canonicalState: canonicalState(),
  mappedPayload: { metadata: {}, userdata: {} },
  syncReason: 'autosave',
  requestedStatus: 'active',
  ...overrides,
});

const eventRequest = (overrides = {}) => ({
  apiVersion: 1,
  authorization: authorization(),
  draftId: 'draft-synthetic-1',
  idempotencyKey: 'events.synthetic.0001',
  clientRevision: 2,
  sourceTabId: 'tab-synthetic-1',
  events: [{
    eventId: 'event-synthetic-1',
    eventType: 'answer_changed',
    questionId: '6',
    mutationId: 'mutation-synthetic-1',
    value: 'synthetic',
    metadata: { origin: 'questionnaire' },
  }],
  ...overrides,
});

const expectCode = (operation, code) => {
  expect(operation).toThrowError(expect.objectContaining({ code }));
};

describe('authoritative draft API request contracts', () => {
  it('validates a bootstrap summary without accepting full canonical state', () => {
    const output = validateBootstrapDraftRequest(bootstrapRequest());
    expect(output.apiVersion).toBe(1);
    expect(output.authorization.method).toBe('resume_token');
    expect(output.localStateSummary).toEqual(bootstrapRequest().localStateSummary);
    expect(() => validateBootstrapDraftRequest({
      ...bootstrapRequest(),
      canonicalState: canonicalState(),
    })).toThrowError(expect.objectContaining({
      code: PRO_DRAFT_API_ERROR_CODES.UNKNOWN_FIELD,
    }));
  });

  it('rejects unknown API versions and unknown keys', () => {
    expectCode(
      () => validateBootstrapDraftRequest(bootstrapRequest({ apiVersion: 2 })),
      PRO_DRAFT_API_ERROR_CODES.UNSUPPORTED_VERSION,
    );
    expectCode(
      () => validateLoadDraftRequest({
        apiVersion: 1,
        authorization: authorization(),
        requestedDraftId: 'draft-synthetic-1',
        clientContext: clientContext(),
        unsafe: true,
      }),
      PRO_DRAFT_API_ERROR_CODES.UNKNOWN_FIELD,
    );
  });

  it('allows exactly one authorization method', () => {
    expect(validateDraftAuthorizationInput({ resumeToken: TOKEN }).method)
      .toBe('resume_token');
    expect(validateDraftAuthorizationInput({}).method).toBe('new_anonymous_draft');
    expectCode(
      () => validateDraftAuthorizationInput({
        resumeToken: TOKEN,
        recoverySessionToken: TOKEN,
      }),
      PRO_DRAFT_API_ERROR_CODES.AUTHORIZATION_INVALID,
    );
  });

  it('requires acknowledgement for no-email anonymous creation', () => {
    const request = bootstrapRequest({
      authorization: {},
      clientContext: clientContext({
        associationIntent: 'anonymous_start',
        recoveryEmailSource: 'anonymous',
      }),
    });
    expectCode(
      () => validateBootstrapDraftRequest(request),
      PRO_DRAFT_API_ERROR_CODES.ANONYMOUS_ACKNOWLEDGEMENT_REQUIRED,
    );
    expect(validateBootstrapDraftRequest({
      ...request,
      clientContext: {
        ...request.clientContext,
        anonymousRecoveryAcknowledged: true,
      },
    }).authorization.method).toBe('new_anonymous_draft');
  });

  it('requires a changed signed email to create an unverified association', () => {
    const changed = bootstrapRequest({
      authorization: { signedDraftAccessToken: TOKEN },
      clientContext: clientContext({
        associationIntent: 'changed_signed_email',
        recoveryEmail: 'changed@example.test',
        recoveryEmailSource: 'client_entered',
        recoveryEmailVerificationStatus: 'unverified',
      }),
    });
    expect(validateBootstrapDraftRequest(changed).clientContext.associationIntent)
      .toBe('changed_signed_email');
    expectCode(
      () => validateBootstrapDraftRequest({
        ...changed,
        clientContext: {
          ...changed.clientContext,
          associationIntent: 'resume_current_draft',
        },
      }),
      PRO_DRAFT_API_ERROR_CODES.ASSOCIATION_INVALID,
    );
  });

  it('rejects test-run IDs in production', () => {
    expectCode(
      () => validateBootstrapDraftRequest(bootstrapRequest({
        clientContext: clientContext({ environment: 'production' }),
      })),
      PRO_DRAFT_API_ERROR_CODES.TEST_RUN_ID_FORBIDDEN,
    );
    expectCode(
      () => validateSaveDraftRequest({ ...saveRequest(), testRunId: 'prod-test' }, {
        environment: 'production',
      }),
      PRO_DRAFT_API_ERROR_CODES.TEST_RUN_ID_FORBIDDEN,
    );
  });

  it('defaults load canonical state and rejects anonymous load', () => {
    const output = validateLoadDraftRequest({
      apiVersion: 1,
      authorization: authorization(),
      requestedDraftId: 'draft-synthetic-1',
      clientContext: clientContext(),
    });
    expect(output.includeCanonicalState).toBe(true);
    expectCode(
      () => validateLoadDraftRequest({
        apiVersion: 1,
        authorization: {},
        requestedDraftId: 'draft-synthetic-1',
        clientContext: clientContext(),
      }),
      PRO_DRAFT_API_ERROR_CODES.AUTHORIZATION_INVALID,
    );
  });

  it('validates the canonical save and exact draft/status bindings', () => {
    expect(validateSaveDraftRequest(saveRequest()).expectedServerRevision).toBe(5);
    expectCode(
      () => validateSaveDraftRequest(saveRequest({
        canonicalState: canonicalState({ draftId: 'draft-other' }),
      })),
      PRO_DRAFT_API_ERROR_CODES.CANONICAL_STATE_INVALID,
    );
    expectCode(
      () => validateSaveDraftRequest(saveRequest({ requestedStatus: 'submitted' })),
      PRO_DRAFT_API_ERROR_CODES.STATUS_INVALID,
    );
    expectCode(
      () => validateSaveDraftRequest(saveRequest({ expectedServerRevision: undefined })),
      PRO_DRAFT_API_ERROR_CODES.REVISION_INVALID,
    );
  });

  it('rejects raw authorization fields anywhere in save payloads', () => {
    expectCode(
      () => validateSaveDraftRequest(saveRequest({
        canonicalState: canonicalState({
          uiDraftState: { resumeToken: TOKEN },
        }),
      })),
      PRO_DRAFT_API_ERROR_CODES.AUTHORIZATION_FIELD_FORBIDDEN,
    );
    expectCode(
      () => validateSaveDraftRequest(saveRequest({
        mappedPayload: { metadata: { recoveryCode: 'synthetic-secret' } },
      })),
      PRO_DRAFT_API_ERROR_CODES.AUTHORIZATION_FIELD_FORBIDDEN,
    );
  });

  it('validates bounded event batches and rejects credential metadata', () => {
    expect(validateAppendEventsRequest(eventRequest()).events).toHaveLength(1);
    expectCode(
      () => validateAppendEventsRequest(eventRequest({ events: [] })),
      PRO_DRAFT_API_ERROR_CODES.EVENT_BATCH_INVALID,
    );
    expectCode(
      () => validateAppendEventsRequest(eventRequest({
        events: Array.from({ length: MAX_EVENT_BATCH_SIZE + 1 }, (_, index) => ({
          eventId: `event-${index}`,
          eventType: 'answer_changed',
        })),
      })),
      PRO_DRAFT_API_ERROR_CODES.EVENT_BATCH_INVALID,
    );
    expectCode(
      () => validateAppendEventsRequest(eventRequest({
        events: [{
          eventId: 'event-secret',
          eventType: 'answer_changed',
          metadata: { recoverySessionToken: TOKEN },
        }],
      })),
      PRO_DRAFT_API_ERROR_CODES.AUTHORIZATION_FIELD_FORBIDDEN,
    );
  });

  it('rejects oversized individual events and duplicate event IDs', () => {
    expectCode(
      () => validateAppendEventsRequest(eventRequest({
        events: [{
          eventId: 'event-large',
          eventType: 'answer_changed',
          value: 'x'.repeat(33 * 1024),
        }],
      })),
      PRO_DRAFT_API_ERROR_CODES.PAYLOAD_TOO_LARGE,
    );
    expectCode(
      () => validateAppendEventsRequest(eventRequest({
        events: [
          { eventId: 'event-duplicate', eventType: 'answer_changed' },
          { eventId: 'event-duplicate', eventType: 'answer_changed' },
        ],
      })),
      PRO_DRAFT_API_ERROR_CODES.EVENT_BATCH_INVALID,
    );
  });

  it('validates client context independently and fails closed', () => {
    expect(validateDraftClientContext(clientContext()).formType)
      .toBe('pro-questionnaire');
    expectCode(
      () => validateDraftClientContext({ ...clientContext(), extra: true }),
      PRO_DRAFT_API_ERROR_CODES.UNKNOWN_FIELD,
    );
  });
});

describe('safe API response envelopes', () => {
  it('includes a request ID and no-store headers on success', async () => {
    const response = buildDraftApiSuccessResponse(
      PRO_DRAFT_API_OPERATION_NAMES.LOAD_DRAFT,
      { draftId: 'draft-synthetic-1' },
      REQUEST_ID,
    );
    expect(response.headers.get('cache-control')).toContain('no-store');
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      requestId: REQUEST_ID,
      apiVersion: 1,
    });
  });

  it('refuses to serialize a sensitive projection', () => {
    for (const data of [
      { resumeTokenHash: HASH },
      { resumeToken: TOKEN },
      { idempotencyKey: 'raw-key-must-not-return' },
    ]) {
      expectCode(
        () => buildDraftApiSuccessResponse(
          PRO_DRAFT_API_OPERATION_NAMES.LOAD_DRAFT,
          data,
          REQUEST_ID,
        ),
        PRO_DRAFT_API_ERROR_CODES.INTERNAL_ERROR,
      );
    }
  });

  it('uses a generic public message and contains no supplied error details', async () => {
    const response = buildDraftApiErrorResponse(
      new ProDraftApiError(PRO_DRAFT_API_ERROR_CODES.AUTHORIZATION_INVALID, 401),
      REQUEST_ID,
    );
    const body = await response.json();
    expect(body).toEqual({
      success: false,
      apiVersion: 1,
      errorCode: PRO_DRAFT_API_ERROR_CODES.AUTHORIZATION_INVALID,
      message: 'Authorization could not be verified.',
      requestId: REQUEST_ID,
      retryable: false,
    });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('returns only safe static diagnostics', () => {
    const diagnostics = getSafeDraftApiDiagnostics();
    expect(diagnostics).toMatchObject({ version: 1, cachePolicy: 'no-store' });
    expect(JSON.stringify(diagnostics)).not.toMatch(/token.*value|secret.*value/iu);
  });
});
