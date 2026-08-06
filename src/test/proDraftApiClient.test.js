import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  PRO_DRAFT_API_CLIENT_ERROR_CODES,
  PRO_DRAFT_API_FUNCTION_NAMES,
  bootstrapProFormDraft,
  createProDraftApiClient,
  generateClientBootstrapToken,
  generateDraftApiIdempotencyKey,
  getSafeDraftApiClientDiagnostics,
  normalizeDraftApiError,
} from '@/lib/proDraftApiClient';

const enabledConfig = Object.freeze({
  environment: 'staging',
  durableDraftV2Enabled: true,
});

const disabledStagingConfig = Object.freeze({
  environment: 'staging',
  durableDraftV2Enabled: false,
});

const createHarness = (runtimeConfig = enabledConfig) => {
  const invoke = vi.fn(async (_name, request) => ({
    status: 200,
    data: { success: true, request },
  }));
  const client = createProDraftApiClient({
    client: { functions: { invoke } },
    runtimeConfig,
  });
  return { client, invoke };
};

const authorization = { resumeToken: 'R'.repeat(43) };

const requestByOperation = Object.freeze({
  bootstrapProFormDraft: {
    idempotencyKey: 'bootstrap.synthetic.0001',
    authorization: {},
    clientContext: {
      formType: 'pro-questionnaire',
      identityContextVersion: 1,
      associationIntent: 'anonymous_start',
      anonymousRecoveryAcknowledged: true,
      environment: 'staging',
    },
    clientBootstrapToken: 'C'.repeat(43),
  },
  loadProFormDraft: {
    authorization,
    requestedDraftId: 'draft-synthetic-1',
    includeCanonicalState: true,
    upgradeLegacyOnLoad: false,
    clientContext: {
      formType: 'pro-questionnaire',
      identityContextVersion: 1,
      associationIntent: 'resume_current_draft',
      anonymousRecoveryAcknowledged: true,
      environment: 'staging',
    },
  },
  saveProFormDraft: {
    authorization,
    draftId: 'draft-synthetic-1',
    expectedServerRevision: 0,
    idempotencyKey: 'save.synthetic.0001',
    canonicalState: { synthetic: true },
    mappedPayload: { metadata: {}, userdata: {} },
    syncReason: 'autosave',
    requestedStatus: 'active',
  },
  appendProFormDraftEvents: {
    authorization,
    draftId: 'draft-synthetic-1',
    idempotencyKey: 'events.synthetic.0001',
    clientRevision: 1,
    sourceTabId: 'tab-synthetic-1',
    events: [{ eventId: 'event-synthetic-1', eventType: 'answer_changed' }],
  },
});

describe('frontend authoritative draft API client contract', () => {
  it.each([
    ['bootstrapProFormDraft', PRO_DRAFT_API_FUNCTION_NAMES.bootstrap],
    ['loadProFormDraft', PRO_DRAFT_API_FUNCTION_NAMES.load],
    ['saveProFormDraft', PRO_DRAFT_API_FUNCTION_NAMES.save],
    ['appendProFormDraftEvents', PRO_DRAFT_API_FUNCTION_NAMES.events],
  ])('invokes the exact %s function name with API version 1', async (method, name) => {
    const { client, invoke } = createHarness();
    const input = requestByOperation[method];
    const result = await client[method](input);

    expect(invoke).toHaveBeenCalledWith(name, { ...input, apiVersion: 1 });
    expect(result).toMatchObject({ success: true, request: { apiVersion: 1 } });
    expect(input).not.toHaveProperty('apiVersion');
  });

  it('preserves the exact bootstrap request contract', async () => {
    const { client, invoke } = createHarness();
    await client.bootstrapProFormDraft(requestByOperation.bootstrapProFormDraft);
    expect(invoke.mock.calls[0][1]).toEqual({
      ...requestByOperation.bootstrapProFormDraft,
      apiVersion: 1,
    });
  });

  it('preserves the exact load request contract', async () => {
    const { client, invoke } = createHarness();
    await client.loadProFormDraft(requestByOperation.loadProFormDraft);
    expect(invoke.mock.calls[0][1]).toEqual({
      ...requestByOperation.loadProFormDraft,
      apiVersion: 1,
    });
  });

  it('preserves the exact save request contract', async () => {
    const { client, invoke } = createHarness();
    await client.saveProFormDraft(requestByOperation.saveProFormDraft);
    expect(invoke.mock.calls[0][1]).toEqual({
      ...requestByOperation.saveProFormDraft,
      apiVersion: 1,
    });
  });

  it('preserves the exact event request contract', async () => {
    const { client, invoke } = createHarness();
    await client.appendProFormDraftEvents(requestByOperation.appendProFormDraftEvents);
    expect(invoke.mock.calls[0][1]).toEqual({
      ...requestByOperation.appendProFormDraftEvents,
      apiVersion: 1,
    });
  });

  it('generates bootstrap tokens from injected Web Crypto only', () => {
    const getRandomValues = vi.fn((bytes) => {
      bytes.fill(171);
      return bytes;
    });
    const token = generateClientBootstrapToken({ getRandomValues });
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it('generates bounded opaque idempotency keys from Web Crypto', () => {
    const getRandomValues = vi.fn((bytes) => {
      bytes.fill(29);
      return bytes;
    });
    const key = generateDraftApiIdempotencyKey({ getRandomValues });
    expect(key).toMatch(/^pdi_[A-Za-z0-9_-]{32}$/u);
    expect(key.length).toBeLessThanOrEqual(128);
  });

  it('fails closed while frontend durable draft V2 is disabled', async () => {
    const { client, invoke } = createHarness(disabledStagingConfig);
    await expect(client.bootstrapProFormDraft(
      requestByOperation.bootstrapProFormDraft,
    )).rejects.toMatchObject({ code: PRO_DRAFT_API_CLIENT_ERROR_CODES.DISABLED });
    expect(invoke).not.toHaveBeenCalled();
    await expect(bootstrapProFormDraft(requestByOperation.bootstrapProFormDraft))
      .rejects.toMatchObject({ code: PRO_DRAFT_API_CLIENT_ERROR_CODES.DISABLED });
  });

  it('permits an explicit test override only in staging with a test run ID', async () => {
    const { client, invoke } = createHarness(disabledStagingConfig);
    const request = {
      ...requestByOperation.bootstrapProFormDraft,
      testRunId: 'staging-api-cert-0001',
    };
    await expect(client.bootstrapProFormDraft(request, {
      stagingTestOverride: true,
    })).resolves.toMatchObject({ success: true });
    expect(invoke).toHaveBeenCalledOnce();

    const production = createHarness({
      environment: 'production', durableDraftV2Enabled: false,
    });
    await expect(production.client.bootstrapProFormDraft(request, {
      stagingTestOverride: true,
    })).rejects.toMatchObject({ code: PRO_DRAFT_API_CLIENT_ERROR_CODES.DISABLED });
  });

  it('normalizes Base44 errors without provider text or request data', () => {
    const normalized = normalizeDraftApiError({
      message: 'raw provider detail with token RRRR',
      response: {
        status: 409,
        data: {
          errorCode: 'REVISION_CONFLICT',
          requestId: `pdrq_${'Q'.repeat(43)}`,
          retryable: false,
          canonicalState: { answer: 'must not escape' },
        },
      },
    });
    expect(normalized).toMatchObject({
      code: 'REVISION_CONFLICT',
      status: 409,
      retryable: false,
      requestId: `pdrq_${'Q'.repeat(43)}`,
      message: 'The draft changed and must be refreshed before retrying.',
    });
    expect(JSON.stringify(normalized)).not.toMatch(/provider|RRRR|answer|canonical/u);
  });

  it('keeps only bounded conflict metadata and omits the remote canonical payload', () => {
    const normalized = normalizeDraftApiError({
      response: {
        status: 409,
        data: {
          errorCode: 'REVISION_CONFLICT',
          mergeRequired: true,
          conflict: {
            draftId: 'draft-synthetic-1',
            clientRevision: 3,
            serverRevision: 8,
            status: 'active',
            stateHash: 'a'.repeat(64),
            canonicalState: { responses: { '1': 'must remain private' } },
          },
        },
      },
    });
    expect(normalized).toMatchObject({
      mergeRequired: true,
      conflict: {
        draftId: 'draft-synthetic-1',
        clientRevision: 3,
        serverRevision: 8,
        status: 'active',
        stateHash: 'a'.repeat(64),
      },
    });
    expect(JSON.stringify(normalized)).not.toMatch(/canonicalState|must remain private/u);
  });

  it('normalizes a bounded retry-after value from response metadata', () => {
    expect(normalizeDraftApiError({
      response: {
        status: 503,
        headers: { 'retry-after': '17' },
        data: { errorCode: 'DRAFT_SAVE_FAILED', retryable: true },
      },
    })).toMatchObject({ retryAfterSeconds: 17, retryable: true });
  });

  it('exposes only safe diagnostics without tokens or client internals', () => {
    const { client } = createHarness(disabledStagingConfig);
    const diagnostics = getSafeDraftApiClientDiagnostics(client);
    expect(diagnostics).toMatchObject({
      version: 1,
      available: true,
      environment: 'staging',
      enabled: false,
      storesCredentials: false,
      dispatchesReduxActions: false,
    });
    expect(JSON.stringify(diagnostics)).not.toMatch(
      /RRRR|resumeToken|clientBootstrapToken|signedDraftAccessToken|secret/iu,
    );
  });

  it('does not write browser storage or dispatch Redux actions', async () => {
    const { client } = createHarness();
    const localSet = vi.spyOn(localStorage, 'setItem');
    const sessionSet = vi.spyOn(sessionStorage, 'setItem');
    await client.bootstrapProFormDraft(requestByOperation.bootstrapProFormDraft);
    expect(localSet).not.toHaveBeenCalled();
    expect(sessionSet).not.toHaveBeenCalled();
  });

  it('has no current questionnaire integration or insecure API aliases', () => {
    const clientSource = readFileSync('src/lib/proDraftApiClient.js', 'utf8');
    const questionnaireSource = readFileSync('src/pages/ProQuestionnaire.jsx', 'utf8');
    expect(clientSource).not.toMatch(/functions\.(?:call|run)\s*\(/u);
    expect(clientSource).not.toMatch(/Math\.random|localStorage|sessionStorage|dispatch\s*\(/u);
    expect(questionnaireSource).not.toMatch(/proDraftApiClient|bootstrapProFormDraft|saveProFormDraft/u);
  });
});
