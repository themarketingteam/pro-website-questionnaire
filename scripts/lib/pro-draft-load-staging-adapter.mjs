import { createHash, createHmac } from 'node:crypto';
import { hashCanonicalDraftState } from '../../src/lib/questionnaireDraftState.js';
import { LoadHarnessError } from './pro-draft-load-harness.mjs';

const ALLOWED_FUNCTIONS = new Set([
  'appendProFormDraftEvents',
  'bootstrapProFormDraft',
  'cleanupDurableDraftTestData',
  'loadProFormDraft',
  'recoverProFormDraftByCode',
  'recoverProFormDraftByEmail',
  'saveProFormDraft',
]);
const CLEANUP_CONFIRMATION = 'DELETE_ONLY_THIS_TEST_RUN';

const digest = (value) => createHash('sha256').update(String(value)).digest('hex');
const deterministicBootstrapToken = (secret, testRunId, draftIndex) => (
  createHmac('sha256', secret)
    .update(`pro-draft-load-resume:v1:${testRunId}:${draftIndex}`)
    .digest('base64url')
);

const safeAdapterError = (error) => new LoadHarnessError(
  /^[A-Z0-9_]{1,96}$/u.test(String(error?.response?.data?.errorCode || ''))
    ? error.response.data.errorCode
    : 'LOAD_STAGING_INVOCATION_FAILED',
  {
    status: Number.isSafeInteger(error?.response?.status) ? error.response.status : 500,
    retryable: error?.response?.data?.retryable === true,
  },
);

const projected = (record, draft) => {
  const canonicalState = structuredClone(draft.canonicalState || record.canonicalState || {});
  const stateHash = typeof draft.stateHash === 'string'
    ? draft.stateHash
    : digest(JSON.stringify(canonicalState));
  return Object.freeze({
    draftFingerprint: record.draftFingerprint,
    stateHash,
    compatibilityHash: digest(JSON.stringify(canonicalState.compatibility || {})),
    serverRevision: Number(draft.serverRevision || 0),
    clientRevision: Number(draft.clientRevision || 0),
    status: String(draft.status || 'active'),
    eventRows: record.eventRows,
    duplicateEventRows: record.duplicateEventRows,
    testRunId: record.testRunId,
    createdOrder: record.createdOrder,
    credentials: record.credentials,
  });
};

export const createStagingBase44LoadAdapter = async ({
  appId = process.env.BASE44_STAGING_APP_ID,
  productionAppId = process.env.BASE44_PRODUCTION_APP_ID,
  accessToken = process.env.BASE44_ACCESS_TOKEN,
  adminGrant = process.env.PRO_FORM_ADMIN_GRANT,
  credentialSecret = process.env.PRO_DRAFT_LOAD_CREDENTIAL_SECRET,
} = {}) => {
  if (!appId) throw new LoadHarnessError('LOAD_STAGING_APP_ID_MISSING', { status: 400 });
  if (productionAppId && appId === productionAppId) {
    throw new LoadHarnessError('LOAD_PRODUCTION_APP_ID_DENIED', { status: 403 });
  }
  if (typeof credentialSecret !== 'string' || credentialSecret.length < 32) {
    throw new LoadHarnessError('LOAD_STAGING_CREDENTIAL_SECRET_MISSING', { status: 400 });
  }
  const { createClient } = await import('@base44/sdk');
  const client = createClient({ appId, ...(accessToken ? { token: accessToken } : {}) });
  const records = new Map();
  const bootstrapRecords = new Map();
  let createdOrder = 0;

  const invoke = async (functionName, payload) => {
    if (!ALLOWED_FUNCTIONS.has(functionName)) {
      throw new LoadHarnessError('LOAD_STAGING_FUNCTION_DENIED', { status: 403 });
    }
    try {
      const response = await client.functions.invoke(functionName, payload);
      if (!response?.data || response.data.success === false) {
        throw Object.assign(new Error('LOAD_STAGING_RESPONSE_FAILED'), { response });
      }
      return response.data;
    } catch (error) {
      throw safeAdapterError(error);
    }
  };

  const recordFor = (input) => {
    const record = records.get(input.draftFingerprint);
    if (!record) throw new LoadHarnessError('LOAD_STAGING_DRAFT_UNKNOWN', { status: 404 });
    return record;
  };

  const saveState = async (record, input, requestedStatus = 'active') => {
    const canonicalState = structuredClone(record.canonicalState);
    canonicalState.clientRevision = record.clientRevision + 1;
    canonicalState.serverRevision = record.serverRevision;
    canonicalState.draftStatus = requestedStatus;
    canonicalState.savedAtClient = new Date().toISOString();
    canonicalState.sourceTabId = `load-tab-${record.createdOrder}`;
    canonicalState.responses = {
      ...(canonicalState.responses || {}),
      load_probe: input.mutationFingerprint,
    };
    if (requestedStatus === 'submitted') {
      canonicalState.submission = {
        ...(canonicalState.submission || {}),
        finalSubmissionId: `load-submission-${record.draftFingerprint.slice(0, 16)}`,
        submittedAt: canonicalState.savedAtClient,
        submittedStateHash: '0'.repeat(64),
        pdfSourceStateHash: '0'.repeat(64),
        lastSubmissionErrorCode: null,
      };
      const submittedHash = await hashCanonicalDraftState(canonicalState);
      canonicalState.submission.submittedStateHash = submittedHash;
      canonicalState.submission.pdfSourceStateHash = submittedHash;
    }
    const body = await invoke('saveProFormDraft', {
      apiVersion: 1,
      authorization: { resumeToken: record.credentials.resumeToken },
      draftId: record.draftId,
      expectedServerRevision: record.serverRevision,
      idempotencyKey: `load-save-${digest(`${record.draftFingerprint}:${record.clientRevision}:${requestedStatus}`).slice(0, 48)}`,
      canonicalState,
      mappedPayload: { metadata: { synthetic_load_test: true }, userdata: {} },
      syncReason: requestedStatus === 'active' ? 'autosave' : requestedStatus,
      requestedStatus,
      testRunId: record.testRunId,
    });
    record.canonicalState = body.draft?.canonicalState || canonicalState;
    record.serverRevision = body.acceptedServerRevision;
    record.clientRevision = body.acceptedClientRevision;
    record.status = body.acceptedStatus;
    record.stateHash = body.stateHash;
    return body;
  };

  const adapter = {
    kind: 'staging',
    stagingAppFingerprint: digest(appId),
    async bootstrap(input) {
      const replayRecord = bootstrapRecords.get(input.idempotencyKey);
      const bootstrapToken = replayRecord?.credentials.resumeToken
        || deterministicBootstrapToken(credentialSecret, input.testRunId, input.draftIndex);
      const recoverySubject = input.draftIndex < 2
        ? `draft+${input.testRunId.toLowerCase()}-newest@example.test`
        : `draft+${input.testRunId.toLowerCase()}-${input.draftIndex}@example.test`;
      const body = await invoke('bootstrapProFormDraft', {
        apiVersion: 1,
        idempotencyKey: `load-bootstrap-${input.idempotencyKey.slice(0, 48)}`,
        authorization: {},
        clientBootstrapToken: bootstrapToken,
        testRunId: input.testRunId,
        clientContext: {
          formType: 'pro-questionnaire',
          identityContextVersion: 1,
          associationIntent: 'anonymous_start',
          anonymousRecoveryAcknowledged: true,
          sourceTabId: `load-tab-${input.draftIndex}`,
          environment: 'staging',
          recoveryEmail: recoverySubject,
          recoveryEmailSource: 'client_entered',
        },
      });
      createdOrder += 1;
      const draftFingerprint = digest(`${input.testRunId}:${body.draft.draftId}`);
      const record = {
        draftFingerprint,
        draftId: body.draft.draftId,
        canonicalState: structuredClone(body.draft.canonicalState),
        serverRevision: body.draft.serverRevision,
        clientRevision: body.draft.clientRevision,
        status: body.draft.status,
        stateHash: body.draft.stateHash,
        eventRows: 0,
        duplicateEventRows: 0,
        testRunId: input.testRunId,
        createdOrder,
        credentials: Object.freeze({
          resumeToken: bootstrapToken,
          recoveryCode: body.recoveryCode,
          recoverySubject,
        }),
      };
      records.set(draftFingerprint, record);
      bootstrapRecords.set(input.idempotencyKey, record);
      return projected(record, body.draft);
    },
    async save(input) {
      const record = recordFor(input);
      const body = await saveState(record, input, 'active');
      if ((input.eventIds || []).length > 0) {
        const eventBody = await invoke('appendProFormDraftEvents', {
          apiVersion: 1,
          authorization: { resumeToken: record.credentials.resumeToken },
          draftId: record.draftId,
          idempotencyKey: `load-events-${digest(input.eventIds.join(':')).slice(0, 48)}`,
          clientRevision: record.clientRevision,
          sourceTabId: `load-tab-${record.createdOrder}`,
          testRunId: record.testRunId,
          events: input.eventIds.map((eventId) => ({
            eventId,
            eventType: 'answer_changed',
            questionId: 'synthetic-load-probe',
          })),
        });
        record.eventRows += Number(eventBody.acceptedCount || 0);
        record.duplicateEventRows += Number(eventBody.duplicateCount || 0);
      }
      return projected(record, body.draft || record.canonicalState);
    },
    async load(input) {
      const record = recordFor(input);
      const body = await invoke('loadProFormDraft', {
        apiVersion: 1,
        authorization: { resumeToken: input.credentials.resumeToken },
        requestedDraftId: record.draftId,
        includeCanonicalState: true,
        upgradeLegacyOnLoad: false,
        testRunId: record.testRunId,
        clientContext: {
          formType: 'pro-questionnaire',
          identityContextVersion: 1,
          associationIntent: 'resume_current_draft',
          anonymousRecoveryAcknowledged: true,
          sourceTabId: `load-tab-${record.createdOrder}`,
          environment: 'staging',
        },
      });
      record.canonicalState = structuredClone(body.draft.canonicalState);
      record.serverRevision = body.draft.serverRevision;
      record.clientRevision = body.draft.clientRevision;
      record.status = body.draft.status;
      record.stateHash = body.draft.stateHash;
      return projected(record, body.draft);
    },
    async recoverByCode(input) {
      const record = recordFor(input);
      await invoke('recoverProFormDraftByCode', {
        apiVersion: 1,
        recoveryCode: input.credentials.recoveryCode,
        clientContext: {
          formType: 'pro-questionnaire',
          sourceTabId: `load-tab-${record.createdOrder}`,
          environment: 'staging',
        },
        testRunId: record.testRunId,
      });
      return projected(record, record.canonicalState);
    },
    async recoverByEmail(input) {
      const record = recordFor(input);
      const body = await invoke('recoverProFormDraftByEmail', {
        apiVersion: 1,
        email: input.credentials.recoverySubject,
        clientContext: {
          formType: 'pro-questionnaire',
          sourceTabId: `load-tab-${record.createdOrder}`,
          environment: 'staging',
        },
        testRunId: record.testRunId,
      });
      const selected = [...records.values()].find((candidate) => (
        candidate.draftId === body.draft?.draftId
      )) || record;
      return projected(selected, body.draft || selected.canonicalState);
    },
    async verifyNewestCreatedSelection(testRunId) {
      const candidates = [...records.values()]
        .filter((record) => record.testRunId === testRunId && record.createdOrder <= 2)
        .sort((left, right) => right.createdOrder - left.createdOrder);
      if (candidates.length < 2) return true;
      const selected = await adapter.recoverByEmail({
        draftFingerprint: candidates.at(-1).draftFingerprint,
        credentials: candidates.at(-1).credentials,
      });
      return selected.draftFingerprint === candidates[0].draftFingerprint;
    },
    async submit(input) {
      const record = recordFor(input);
      await saveState(record, {
        ...input,
        mutationFingerprint: digest(`${record.draftFingerprint}:submit-attempt`),
      }, 'submit_attempted');
      const body = await saveState(record, {
        ...input,
        mutationFingerprint: digest(`${record.draftFingerprint}:submitted`),
      }, 'submitted');
      return projected(record, body.draft || record.canonicalState);
    },
    async inspect(testRunId) {
      const selected = [...records.values()].filter((record) => record.testRunId === testRunId);
      const results = [];
      for (const record of selected) {
        results.push(await adapter.load({
          draftFingerprint: record.draftFingerprint,
          credentials: record.credentials,
        }));
      }
      return results.sort((left, right) => left.createdOrder - right.createdOrder);
    },
    async cleanup(testRunId) {
      if (!adminGrant) throw new LoadHarnessError('LOAD_CLEANUP_ADMIN_GRANT_MISSING', { status: 403 });
      await invoke('cleanupDurableDraftTestData', {
        action: 'preview', environment: 'staging', testRunId, adminGrant,
      });
      const deleted = await invoke('cleanupDurableDraftTestData', {
        action: 'delete', confirmation: CLEANUP_CONFIRMATION, environment: 'staging', testRunId, adminGrant,
      });
      const verified = await invoke('cleanupDurableDraftTestData', {
        action: 'verify', environment: 'staging', testRunId, adminGrant,
      });
      const unresolvedRecords = Object.values(verified.counts || {})
        .reduce((sum, count) => sum + Math.max(0, Number(count) || 0), 0);
      return Object.freeze({
        deletedRecords: Object.values(deleted.deletedCounts || {})
          .reduce((sum, count) => sum + Math.max(0, Number(count) || 0), 0),
        unresolvedRecords,
        verifiedZero: unresolvedRecords === 0,
      });
    },
  };
  return Object.freeze(adapter);
};
