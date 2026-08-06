import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  AUTHORIZATION_SECRET_NAMES,
  SIGNED_TOKEN_SCOPES,
  issueRecoverySessionToken,
} from '../../base44/functions/_shared/proDraftAuthorization/entry.ts';
import {
  createSendProFormDraftRecoveryCodeEmailHandler,
} from '../../base44/functions/_shared/proDraftRecoveryEmailDelivery/entry.ts';
import {
  SECURITY_SECRET_NAMES,
  hashRecoveryCode,
  sha256Hex,
} from '../../base44/functions/_shared/proDraftSecurity/entry.ts';

const NOW_SECONDS = 2_000_000_000;
const CODE = '2345-6789-ABCD-EFGH-JKMN';
const DRAFT_ID = 'draft-synthetic-new';
const PREVIOUS_ID = 'draft-synthetic-previous';
const SESSION_ID = 'session-synthetic-new';
const EMAIL = 'synthetic.owner@example.test';
const IDEMPOTENCY_KEY = 'recovery-email.synthetic.0001';
const REQUEST_ID = `pdrq_${'Q'.repeat(43)}`;
const SECRET_VALUES = Object.freeze({
  PRO_DRAFT_ENVIRONMENT: 'staging',
  PRO_DRAFT_V2_SERVER_ENABLED: 'true',
  PRO_DRAFT_V2_KILL_SWITCH: 'false',
  PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE: 'staging_redirect',
  PRO_DRAFT_EMAIL_MODE: 'staging_redirect',
  PRO_DRAFT_SES_FROM_EMAIL: 'noreply@mspsuccesswebsites.com',
  PRO_DRAFT_RECOVERY_BASE_URL: 'https://questionnaire.example.test/recover',
  STAGING_EMAIL_REDIRECT_TO: 'internal-allowlist@example.invalid',
  PRO_FORM_DRAFT_TOKEN_SECRET: 'r'.repeat(32),
  PRO_FORM_RECOVERY_CODE_SECRET: 'c'.repeat(32),
  PRO_FORM_DRAFT_LINK_SECRET: 'l'.repeat(32),
  PRO_FORM_RECOVERY_SESSION_SECRET: 's'.repeat(32),
  PRO_FORM_IDEMPOTENCY_SECRET: 'i'.repeat(32),
});

const successTransport = (overrides = {}) => Object.freeze({
  success: true,
  delivered: true,
  suppressed: false,
  redirected: true,
  mode: 'staging_redirect',
  destinationClass: 'staging_internal',
  providerMessageId: 'synthetic-provider-message-id',
  providerStatus: 200,
  errorCode: null,
  requestId: REQUEST_ID,
  ...overrides,
});

function queryMatches(record, query) {
  return Object.entries(query).every(([field, expected]) => record[field] === expected);
}

async function makeHarness(options = {}) {
  let nowMs = NOW_SECONDS * 1000;
  let updateTick = 0;
  const tokenEnvironment = options.environment?.PRO_DRAFT_ENVIRONMENT ?? 'staging';
  const codeHash = await hashRecoveryCode(CODE, {
    name: SECURITY_SECRET_NAMES.RECOVERY_CODE,
    value: SECRET_VALUES.PRO_FORM_RECOVERY_CODE_SECRET,
  });
  const records = [
    {
      id: DRAFT_ID,
      session_id: SESSION_ID,
      status: 'active',
      server_revision: 7,
      updated_date: new Date(nowMs - 60_000).toISOString(),
      recovery_session_version: 1,
      recovery_code_version: 1,
      recovery_code_hash: codeHash,
      recovery_email: EMAIL,
      business_name: 'Synthetic Business',
      draft_generation: 2,
      previous_draft_id: PREVIOUS_ID,
      recovery_email_delivery_attempt_count: 0,
      ...(options.draft ?? {}),
    },
    {
      id: PREVIOUS_ID,
      session_id: 'session-synthetic-previous',
      status: 'cleared_superseded',
      server_revision: 9,
      updated_date: new Date(nowMs - 120_000).toISOString(),
      replacement_draft_id: DRAFT_ID,
      superseded_reason: 'clear_all',
      ...(options.previous ?? {}),
    },
  ];
  const eventRecords = [];
  const controls = {
    metadataUpdateCount: 0,
    failMetadataUpdateAt: options.failMetadataUpdateAt ?? null,
    failEvents: false,
  };
  const drafts = {
    filter: vi.fn(async (query) => records.filter((record) => queryMatches(record, query))),
    get: vi.fn(async (id) => {
      const record = records.find((candidate) => candidate.id === id);
      if (!record) throw new Error('synthetic not found');
      return { ...record };
    }),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(async (query, operators) => {
      controls.metadataUpdateCount += 1;
      if (controls.failMetadataUpdateAt === controls.metadataUpdateCount) {
        throw new Error('synthetic metadata failure');
      }
      const index = records.findIndex((record) => queryMatches(record, query));
      if (index < 0) return { updated: 0 };
      updateTick += 1;
      records[index] = {
        ...records[index],
        ...(operators.$set ?? {}),
        updated_date: new Date(nowMs + updateTick).toISOString(),
      };
      return { updated: 1 };
    }),
    bulkCreate: vi.fn(),
  };
  const events = {
    filter: vi.fn(async () => []),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    bulkCreate: vi.fn(async (rows) => {
      if (controls.failEvents) throw new Error('synthetic event failure');
      const created = rows.map((row, index) => ({
        ...row,
        id: `event-synthetic-${eventRecords.length + index + 1}`,
      }));
      eventRecords.push(...created);
      return created.map((record) => ({ ...record }));
    }),
  };
  const sdk = {
    auth: {
      me: vi.fn(async () => options.user ?? { role: 'admin', id: 'admin-synthetic' }),
    },
    asServiceRole: {
      entities: { ProFormDraft: drafts, ProFormDraftEvent: events },
    },
  };
  const environment = { ...SECRET_VALUES, ...(options.environment ?? {}) };
  const sendEmail = options.sendEmail ?? vi.fn(async () => successTransport());
  const dependencies = {
    createClientFromRequest: vi.fn(() => sdk),
    getEnvironmentValue: vi.fn((name) => environment[name]),
    createRequestId: () => REQUEST_ID,
    now: () => new Date(nowMs),
    sendEmail,
  };
  const sessionIdHash = await sha256Hex(`pro-draft:session-id:v1:${SESSION_ID}`);
  const recoverySessionToken = await issueRecoverySessionToken({
    environment: tokenEnvironment,
    draftId: DRAFT_ID,
    sessionIdHash,
    authorizationMethod: 'recovery_code',
    authorizedScopes: [
      SIGNED_TOKEN_SCOPES.DRAFT_READ,
      SIGNED_TOKEN_SCOPES.DRAFT_WRITE,
      SIGNED_TOKEN_SCOPES.DRAFT_EVENTS,
    ],
    recoveryCodeVersion: 1,
    recoverySessionVersion: 1,
    grantVersion: 1,
  }, {
    secret: {
      name: AUTHORIZATION_SECRET_NAMES.RECOVERY_SESSION,
      value: SECRET_VALUES.PRO_FORM_RECOVERY_SESSION_SECRET,
    },
    clock: () => Math.floor(nowMs / 1000),
    tokenIdGenerator: () => `pdti_${'T'.repeat(43)}`,
  });
  return {
    records,
    eventRecords,
    controls,
    drafts,
    events,
    sdk,
    sendEmail,
    handler: createSendProFormDraftRecoveryCodeEmailHandler(dependencies),
    recoverySessionToken,
    advance(seconds) { nowMs += seconds * 1000; },
  };
}

const body = (token, overrides = {}) => ({
  apiVersion: 1,
  authorization: { recoverySessionToken: token },
  draftId: DRAFT_ID,
  recoveryCode: CODE,
  purpose: 'clear_all_replacement',
  idempotencyKey: IDEMPOTENCY_KEY,
  testRunId: 'email-delivery-synthetic-1',
  ...overrides,
});

const httpRequest = (value, overrides = {}) => new Request(
  'https://synthetic.invalid/functions/sendProFormDraftRecoveryCodeEmail',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
    ...overrides,
  },
);

async function call(harness, value, overrides) {
  const response = await harness.handler(httpRequest(value, overrides));
  return { response, json: await response.json() };
}

describe('sendProFormDraftRecoveryCodeEmail request and authorization', () => {
  it('fails closed when durable draft or email runtime is disabled', async () => {
    for (const environment of [
      { PRO_DRAFT_V2_SERVER_ENABLED: 'false' },
      { PRO_DRAFT_EMAIL_MODE: 'disabled' },
    ]) {
      const harness = await makeHarness({ environment });
      const result = await call(harness, body(harness.recoverySessionToken));
      expect(result.response.status).toBe(503);
      expect(result.json.errorCode).toBe('FEATURE_DISABLED');
      expect(harness.sendEmail).not.toHaveBeenCalled();
    }
  });

  it('requires POST, JSON, and a bounded body with no-store headers', async () => {
    const harness = await makeHarness();
    const wrongMethod = await call(
      harness,
      body(harness.recoverySessionToken),
      { method: 'PUT' },
    );
    expect(wrongMethod.response.status).toBe(405);
    expect(wrongMethod.response.headers.get('allow')).toBe('POST');
    expect(wrongMethod.response.headers.get('cache-control')).toContain('no-store');

    const wrongType = await call(
      harness,
      body(harness.recoverySessionToken),
      { headers: { 'content-type': 'text/plain' } },
    );
    expect(wrongType.response.status).toBe(415);

    const tooLarge = await call(harness, {
      ...body(harness.recoverySessionToken),
      unknownPadding: 'x'.repeat(33 * 1024),
    });
    expect(tooLarge.response.status).toBe(413);
  });

  it('rejects wrong purposes and explicitly rejects manual resend', async () => {
    for (const purpose of ['manual_resend', 'arbitrary_send']) {
      const harness = await makeHarness();
      const result = await call(harness, body(harness.recoverySessionToken, { purpose }));
      expect(result.json.errorCode).toBe('PURPOSE_NOT_ALLOWED');
      expect(harness.sendEmail).not.toHaveBeenCalled();
    }
  });

  it('rejects missing authorization and wrong exact-draft binding', async () => {
    const missing = await makeHarness();
    const missingResult = await call(missing, body(missing.recoverySessionToken, {
      authorization: {},
    }));
    expect(missingResult.json.errorCode).toBe('AUTHORIZATION_DENIED');

    const wrong = await makeHarness();
    const wrongResult = await call(wrong, body(wrong.recoverySessionToken, {
      draftId: 'draft-synthetic-wrong',
    }));
    expect(wrongResult.json.errorCode).toBe('AUTHORIZATION_DENIED');
    expect(wrong.sendEmail).not.toHaveBeenCalled();
  });

  it('generically rejects a recovery-code mismatch and never sends', async () => {
    const harness = await makeHarness();
    const result = await call(harness, body(harness.recoverySessionToken, {
      recoveryCode: '2345-6789-ABCD-EFGH-JKMP',
    }));
    expect(result.response.status).toBe(403);
    expect(result.json.errorCode).toBe('RECOVERY_EMAIL_DELIVERY_DENIED');
    expect(JSON.stringify(result.json)).not.toContain(CODE);
    expect(harness.sendEmail).not.toHaveBeenCalled();
  });

  it('returns recovery-email unavailable without invalidating the draft', async () => {
    const harness = await makeHarness({ draft: { recovery_email: '' } });
    const result = await call(harness, body(harness.recoverySessionToken));
    expect(result.json.errorCode).toBe('RECOVERY_EMAIL_UNAVAILABLE');
    expect(harness.records[0]).toMatchObject({
      status: 'active',
      recovery_code_hash: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(harness.sendEmail).not.toHaveBeenCalled();
  });

  it('authorizes a structurally valid Clear All replacement only', async () => {
    const harness = await makeHarness();
    const result = await call(harness, body(harness.recoverySessionToken));
    expect(result.json).toMatchObject({ success: true, delivered: true });

    const invalid = await makeHarness({ previous: { superseded_reason: 'other' } });
    const denied = await call(invalid, body(invalid.recoverySessionToken));
    expect(denied.json.errorCode).toBe('DRAFT_RELATIONSHIP_INVALID');
    expect(invalid.sendEmail).not.toHaveBeenCalled();
  });

  it('authorizes Start New only when the linked previous draft is submitted', async () => {
    const harness = await makeHarness({
      previous: { status: 'submitted', superseded_reason: undefined },
    });
    const result = await call(harness, body(harness.recoverySessionToken, {
      purpose: 'start_new_after_submission',
    }));
    expect(result.json).toMatchObject({ success: true, delivered: true });

    const invalid = await makeHarness();
    const denied = await call(invalid, body(invalid.recoverySessionToken, {
      purpose: 'start_new_after_submission',
    }));
    expect(denied.json.errorCode).toBe('DRAFT_RELATIONSHIP_INVALID');
  });

  it('uses the stored draft email in production and forbids staging self-check there', async () => {
    const sendEmail = vi.fn(async () => successTransport({
      redirected: false,
      mode: 'production',
      destinationClass: 'production_approved',
    }));
    const harness = await makeHarness({
      sendEmail,
      environment: {
        PRO_DRAFT_ENVIRONMENT: 'production',
        PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE: 'production',
        PRO_DRAFT_EMAIL_MODE: 'production',
      },
    });
    const sent = await call(harness, body(harness.recoverySessionToken, {
      testRunId: undefined,
    }));
    expect(sent.json).toMatchObject({ success: true, redirected: false });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      intendedRecipient: EMAIL,
      environment: 'production',
    }));

    const selfCheck = await makeHarness({
      environment: {
        PRO_DRAFT_ENVIRONMENT: 'production',
        PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE: 'production',
        PRO_DRAFT_EMAIL_MODE: 'production',
      },
    });
    const denied = await call(selfCheck, body(selfCheck.recoverySessionToken, {
      authorization: {},
      purpose: 'staging_self_check',
      testRunId: undefined,
    }));
    expect(denied.json.errorCode).toBe('AUTHORIZATION_DENIED');
    expect(selfCheck.sendEmail).not.toHaveBeenCalled();
  });

  it('permits staging self-check only for an authenticated admin or app owner', async () => {
    const admin = await makeHarness();
    const adminResult = await call(admin, body(admin.recoverySessionToken, {
      authorization: {},
      purpose: 'staging_self_check',
    }));
    expect(adminResult.json.success).toBe(true);

    const publicCaller = await makeHarness({ user: { role: 'user' } });
    const denied = await call(publicCaller, body(publicCaller.recoverySessionToken, {
      authorization: {},
      purpose: 'staging_self_check',
    }));
    expect(denied.json.errorCode).toBe('AUTHORIZATION_DENIED');
    expect(publicCaller.sendEmail).not.toHaveBeenCalled();
  });

  it('rejects recipient, sender, subject, HTML, and SES-region overrides', async () => {
    for (const override of [
      { recipient: 'override@example.test' },
      { sender: 'override@example.test' },
      { subject: 'override' },
      { html: '<p>override</p>' },
      { sesRegion: 'us-west-2' },
    ]) {
      const harness = await makeHarness();
      const result = await call(
        harness,
        body(harness.recoverySessionToken, override),
      );
      expect(result.json.errorCode).toBe('INVALID_REQUEST');
      expect(harness.sendEmail).not.toHaveBeenCalled();
    }
  });
});

describe('sendProFormDraftRecoveryCodeEmail idempotency and delivery metadata', () => {
  it('sends initially to the stored address through staging redirection', async () => {
    const harness = await makeHarness();
    const result = await call(harness, body(harness.recoverySessionToken));
    expect(result.json).toMatchObject({
      success: true,
      delivered: true,
      redirected: true,
      suppressed: false,
      idempotent: false,
      deliveryUncertain: false,
      status: 'sent',
    });
    expect(harness.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      intendedRecipient: EMAIL,
      recipientAuthorized: true,
      environment: 'staging',
    }));
    expect(harness.records[0]).toMatchObject({
      status: 'active',
      server_revision: 7,
      recovery_email_delivery_status: 'sent',
      recovery_email_delivery_attempt_count: 1,
      recovery_email_delivery_purpose: 'clear_all_replacement',
      recovery_email_provider_message_id: 'synthetic-provider-message-id',
    });
  });

  it('returns idempotent success without a duplicate SES call', async () => {
    const harness = await makeHarness();
    const requestBody = body(harness.recoverySessionToken);
    expect((await call(harness, requestBody)).json.success).toBe(true);
    const replay = await call(harness, requestBody);
    expect(replay.json).toMatchObject({
      success: true,
      delivered: true,
      idempotent: true,
    });
    expect(harness.sendEmail).toHaveBeenCalledOnce();
  });

  it('stores safe failure metadata and permits a bounded retry', async () => {
    const sendEmail = vi.fn(async () => successTransport({
      success: false,
      delivered: false,
      providerMessageId: null,
      providerStatus: 503,
      errorCode: 'EMAIL_SES_PROVIDER_ERROR',
    }));
    const harness = await makeHarness({ sendEmail });
    const result = await call(harness, body(harness.recoverySessionToken));
    expect(result.response.status).toBe(502);
    expect(result.json).toMatchObject({
      success: false,
      delivered: false,
      canRetry: true,
      retryAfterSeconds: 30,
    });
    expect(harness.records[0]).toMatchObject({
      status: 'active',
      server_revision: 7,
      recovery_email_delivery_status: 'failed',
      recovery_email_delivery_error_code: 'EMAIL_SES_PROVIDER_ERROR',
      recovery_email_delivery_attempt_count: 1,
    });
    expect(harness.eventRecords.map((event) => event.event_type)).toEqual([
      'recovery_email_attempted',
      'recovery_email_failed',
    ]);
  });

  it('rejects retry before backoff and permits it after backoff', async () => {
    const sendEmail = vi.fn(async () => successTransport({
      success: false,
      delivered: false,
      providerMessageId: null,
      providerStatus: 503,
      errorCode: 'EMAIL_SES_PROVIDER_ERROR',
    }));
    const harness = await makeHarness({ sendEmail });
    const requestBody = body(harness.recoverySessionToken);
    await call(harness, requestBody);
    const early = await call(harness, requestBody);
    expect(early.json).toMatchObject({
      errorCode: 'RETRY_BACKOFF',
      canRetry: true,
      retryAfterSeconds: 30,
    });
    expect(sendEmail).toHaveBeenCalledOnce();

    harness.advance(31);
    const retry = await call(harness, requestBody);
    expect(retry.json.errorCode).toBe('RECOVERY_EMAIL_DELIVERY_FAILED');
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(harness.records[0].recovery_email_delivery_attempt_count).toBe(2);
  });

  it('enforces the configured maximum attempt count across keys', async () => {
    const harness = await makeHarness({
      draft: { recovery_email_delivery_attempt_count: 3 },
    });
    const result = await call(harness, body(harness.recoverySessionToken, {
      idempotencyKey: 'recovery-email.synthetic.different',
    }));
    expect(result.json).toMatchObject({ errorCode: 'MAX_ATTEMPTS', canRetry: false });
    expect(harness.sendEmail).not.toHaveBeenCalled();
  });

  it('rejects reuse of the same key for a different purpose', async () => {
    const harness = await makeHarness();
    await call(harness, body(harness.recoverySessionToken));
    const result = await call(harness, body(harness.recoverySessionToken, {
      authorization: {},
      purpose: 'staging_self_check',
    }));
    expect(result.json.errorCode).toBe('IDEMPOTENCY_CONFLICT');
    expect(harness.sendEmail).toHaveBeenCalledOnce();
  });

  it('returns delivery uncertain when SES succeeds but the sent metadata write fails', async () => {
    const harness = await makeHarness({ failMetadataUpdateAt: 2 });
    const result = await call(harness, body(harness.recoverySessionToken));
    expect(result.json).toMatchObject({
      success: true,
      delivered: true,
      deliveryUncertain: true,
      status: 'delivery_uncertain',
      canRetry: false,
    });
    expect(harness.sendEmail).toHaveBeenCalledOnce();
    expect(harness.eventRecords.map((event) => event.event_type)).toContain(
      'recovery_email_delivery_uncertain',
    );
  });

  it('records attempted and sent events with only allowlisted metadata', async () => {
    const harness = await makeHarness();
    const result = await call(harness, body(harness.recoverySessionToken));
    expect(result.json.success).toBe(true);
    expect(harness.eventRecords.map((event) => event.event_type)).toEqual([
      'recovery_email_attempted',
      'recovery_email_sent',
    ]);
    const serialized = JSON.stringify(harness.eventRecords);
    expect(serialized).not.toContain(CODE);
    expect(serialized).not.toContain(EMAIL);
    expect(serialized).not.toContain('synthetic-provider-message-id');
    expect(serialized).toContain('clear_all_replacement');
    expect(serialized).toContain(REQUEST_ID);
  });

  it('never persists or returns the raw recovery code and never alters canonical status/revision', async () => {
    const harness = await makeHarness();
    const result = await call(harness, body(harness.recoverySessionToken));
    expect(JSON.stringify(result.json)).not.toContain(CODE);
    expect(JSON.stringify(harness.records)).not.toContain(CODE);
    expect(harness.records[0]).toMatchObject({ status: 'active', server_revision: 7 });
    expect(result.json).not.toHaveProperty('providerMessageId');
    expect(result.json).not.toHaveProperty('email');
    const source = readFileSync(
      'base44/functions/_shared/proDraftRecoveryEmailDelivery/entry.ts',
      'utf8',
    );
    expect(source).not.toMatch(/console\.|localStorage|sessionStorage|indexedDB/gu);
  });
});
