import { vi } from 'vitest';
import {
  REPLACEMENT_OPERATION_TYPES,
  createReplacementFunctionHandler,
} from '../../base44/functions/_shared/proDraftReplacement/entry.ts';
import {
  SECURITY_SECRET_NAMES,
  hashResumeToken,
} from '../../base44/functions/_shared/proDraftSecurity/entry.ts';

export const REPLACEMENT_NOW = new Date('2033-05-18T03:33:20.000Z');
export const SOURCE_RESUME_TOKEN = 'R'.repeat(43);
export const CLIENT_REPLACEMENT_TOKEN = 'N'.repeat(43);
export const SOURCE_HASH = 'a'.repeat(64);
export const REPLACEMENT_ENV = Object.freeze({
  PRO_DRAFT_ENVIRONMENT: 'staging',
  PRO_DRAFT_V2_SERVER_ENABLED: 'true',
  PRO_DRAFT_V2_KILL_SWITCH: 'false',
  PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE: 'staging_redirect',
  PRO_DRAFT_EMAIL_MODE: 'staging_redirect',
  PRO_DRAFT_SES_FROM_EMAIL: 'noreply@mspsuccesswebsites.com',
  PRO_DRAFT_RECOVERY_BASE_URL: 'https://questionnaire.example.test/recover',
  STAGING_EMAIL_REDIRECT_TO: 'internal@example.invalid',
  PRO_FORM_DRAFT_TOKEN_SECRET: 'r'.repeat(32),
  PRO_FORM_RECOVERY_CODE_SECRET: 'c'.repeat(32),
  PRO_FORM_DRAFT_LINK_SECRET: 'l'.repeat(32),
  PRO_FORM_RECOVERY_SESSION_SECRET: 's'.repeat(32),
  PRO_FORM_IDEMPOTENCY_SECRET: 'i'.repeat(32),
});

const matches = (record, query) => Object.entries(query)
  .every(([field, value]) => record[field] === value);

export async function replacementHarness(options = {}) {
  let tick = 0;
  const resumeHash = await hashResumeToken(SOURCE_RESUME_TOKEN, {
    name: SECURITY_SECRET_NAMES.RESUME_TOKEN,
    value: REPLACEMENT_ENV.PRO_FORM_DRAFT_TOKEN_SECRET,
  });
  const source = {
    id: 'draft-source-synthetic',
    session_id: 'session-source-synthetic',
    status: options.status ?? 'active',
    server_revision: options.serverRevision ?? 3,
    state_hash: SOURCE_HASH,
    updated_date: REPLACEMENT_NOW.toISOString(),
    created_date: new Date(REPLACEMENT_NOW.getTime() - 60_000).toISOString(),
    resume_token_hash: resumeHash,
    recovery_session_version: 1,
    recovery_code_version: 1,
    draft_generation: options.generation ?? 1,
    business_name: 'Synthetic Business',
    domain: 'synthetic.example.test',
    final_submission_id: options.status === 'submitted'
      ? 'submission-synthetic-final' : undefined,
    ...(options.recoveryEmail ? {
      recovery_email: 'owner@example.test',
      recovery_email_source: 'client_entered',
      recovery_email_verification_status: 'unverified',
    } : {}),
    ...(options.source ?? {}),
  };
  const records = [source];
  const events = [];
  const controls = {
    failCreate: options.failCreate === true,
    sourceConflictCount: options.sourceConflictCount ?? 0,
    commitFailureCount: options.commitFailureCount ?? 0,
  };
  const drafts = {
    filter: vi.fn(async (query) => records.filter((record) => matches(record, query))
      .map((record) => ({ ...record }))),
    get: vi.fn(async (id) => {
      const record = records.find((candidate) => candidate.id === id);
      if (!record) throw new Error('synthetic not found');
      return { ...record };
    }),
    create: vi.fn(async (data) => {
      if (controls.failCreate) throw new Error('synthetic create failure');
      const record = {
        ...data,
        id: `draft-replacement-${records.length}`,
        created_date: new Date(REPLACEMENT_NOW.getTime() + ++tick).toISOString(),
        updated_date: new Date(REPLACEMENT_NOW.getTime() + tick).toISOString(),
      };
      records.push(record);
      return { ...record };
    }),
    update: vi.fn(),
    updateMany: vi.fn(async (query, operators) => {
      const sourceTransition = operators?.$set?.status === 'cleared_superseded';
      const commitMarker = operators?.$set?.replacement_transaction_status === 'committed';
      if (sourceTransition && controls.sourceConflictCount > 0) {
        controls.sourceConflictCount -= 1;
        return { updated: 0 };
      }
      if (commitMarker && controls.commitFailureCount > 0) {
        controls.commitFailureCount -= 1;
        throw new Error('synthetic commit failure');
      }
      const index = records.findIndex((record) => matches(record, query));
      if (index < 0) return { updated: 0 };
      const next = {
        ...records[index],
        ...(operators.$set ?? {}),
      };
      for (const [field, amount] of Object.entries(operators.$inc ?? {})) {
        next[field] = Number(next[field] ?? 0) + Number(amount);
      }
      next.updated_date = new Date(REPLACEMENT_NOW.getTime() + ++tick).toISOString();
      records[index] = next;
      return { updated: 1 };
    }),
    bulkCreate: vi.fn(),
  };
  const draftEvents = {
    filter: vi.fn(async () => []),
    get: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
    bulkCreate: vi.fn(async (rows) => {
      events.push(...rows.map((row) => ({ ...row })));
      return rows;
    }),
  };
  const sdk = {
    asServiceRole: {
      entities: { ProFormDraft: drafts, ProFormDraftEvent: draftEvents },
    },
  };
  const environment = { ...REPLACEMENT_ENV, ...(options.environment ?? {}) };
  const sendEmail = options.sendEmail ?? vi.fn(async () => ({
    success: true,
    delivered: true,
    suppressed: false,
    redirected: true,
    mode: 'staging_redirect',
    destinationClass: 'staging_internal',
    providerMessageId: 'message-synthetic',
    providerStatus: 200,
    errorCode: null,
    requestId: `pdrq_${'Q'.repeat(43)}`,
  }));
  const operation = options.operation ?? REPLACEMENT_OPERATION_TYPES.CLEAR_ALL;
  const dependencies = {
    createClientFromRequest: vi.fn(() => sdk),
    getEnvironmentValue: vi.fn((name) => environment[name]),
    createRequestId: () => `pdrq_${'Q'.repeat(43)}`,
    now: () => new Date(REPLACEMENT_NOW),
    generateSessionId: () => `pds_${'S'.repeat(43)}`,
    generateResumeToken: () => CLIENT_REPLACEMENT_TOKEN,
    generateTransactionId: () => `pdrt_${'T'.repeat(43)}`,
    tokenIdGenerator: () => `pdti_${'I'.repeat(43)}`,
    sendEmail,
  };
  return {
    records,
    events,
    controls,
    drafts,
    sendEmail,
    handler: createReplacementFunctionHandler(operation, dependencies),
  };
}

export const replacementBody = (overrides = {}) => ({
  apiVersion: 1,
  authorization: { resumeToken: SOURCE_RESUME_TOKEN },
  sourceDraftId: 'draft-source-synthetic',
  expectedServerRevision: 3,
  idempotencyKey: 'replacement.synthetic.0001',
  testRunId: 'replacement-synthetic-1',
  ...overrides,
});

export const replacementRequest = (body, overrides = {}) => new Request(
  'https://synthetic.invalid/functions/replacement',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...overrides,
  },
);

export async function invokeReplacement(harness, body = replacementBody(), overrides) {
  const response = await harness.handler(replacementRequest(body, overrides));
  return { response, json: await response.json() };
}
