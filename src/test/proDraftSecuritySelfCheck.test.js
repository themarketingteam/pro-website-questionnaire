import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  PRO_DRAFT_SECURITY_SELF_CHECK_REQUEST_LIMIT_BYTES,
  PRO_DRAFT_SECURITY_SELF_CHECK_SECRET_NAMES,
  createProDraftSecuritySelfCheckHandler,
} from '../../base44/functions/proDraftSecuritySelfCheck/core.ts';

const REQUEST_ID = `pdrq_${'R'.repeat(43)}`;
const SECRET_VALUES = Object.freeze({
  PRO_FORM_DRAFT_TOKEN_SECRET: 't'.repeat(48),
  PRO_FORM_DRAFT_LINK_SECRET: 'l'.repeat(48),
  PRO_FORM_RECOVERY_CODE_SECRET: 'c'.repeat(48),
  PRO_FORM_EMAIL_LOOKUP_SECRET: 'e'.repeat(48),
  PRO_FORM_RECOVERY_SESSION_SECRET: 's'.repeat(48),
  PRO_FORM_ADMIN_GRANT_SECRET: 'a'.repeat(48),
});
const SAFE_TOP_LEVEL_KEYS = Object.freeze([
  'authorizationVersion',
  'checks',
  'configuredSecrets',
  'environment',
  'persistenceVersion',
  'requestId',
  'securityVersion',
  'success',
]);
const SAFE_CHECK_KEYS = Object.freeze([
  'adminGrantToken',
  'crossPurposeRejection',
  'emailLookupHash',
  'environmentRejection',
  'idempotentRevision',
  'opaqueToken',
  'recoveryCodeGeneration',
  'recoveryCodeHash',
  'recoverySessionToken',
  'requestLimit',
  'resumeTokenHash',
  'secretLengths',
  'secretSeparation',
  'signedInvitationToken',
  'staleRevisionRejection',
  'submittedRegressionRejection',
  'tamperRejection',
]);

function request(body = '{}', options = {}) {
  return new Request('https://self-check.invalid/', {
    method: options.method ?? 'POST',
    headers: {
      'Content-Type': options.contentType ?? 'application/json',
      ...(options.headers ?? {}),
    },
    body: (options.method ?? 'POST') === 'GET' ? undefined : body,
  });
}

function createHarness(overrides = {}) {
  const environment = {
    PRO_DRAFT_ENVIRONMENT: 'staging',
    PRO_DRAFT_DIAGNOSTICS_ENABLED: 'true',
    ...SECRET_VALUES,
    ...(overrides.environment ?? {}),
  };
  const createClientFromRequest = vi.fn(() => ({
    auth: {
      me: vi.fn().mockResolvedValue(overrides.user === undefined
        ? { id: 'synthetic-admin', role: 'admin' }
        : overrides.user),
    },
  }));
  const getEnvironmentValue = vi.fn((name) => environment[name]);
  const handler = createProDraftSecuritySelfCheckHandler({
    createClientFromRequest,
    getEnvironmentValue,
    createRequestId: () => REQUEST_ID,
  });
  return { createClientFromRequest, environment, getEnvironmentValue, handler };
}

async function responseBody(response) {
  return response.json();
}

function expectSafeShape(body) {
  expect(Object.keys(body).sort()).toEqual([...SAFE_TOP_LEVEL_KEYS].sort());
  expect(Object.keys(body.configuredSecrets).sort()).toEqual(
    Object.keys(PRO_DRAFT_SECURITY_SELF_CHECK_SECRET_NAMES).sort(),
  );
  expect(Object.keys(body.checks).sort()).toEqual([...SAFE_CHECK_KEYS].sort());
  expect(Object.values(body.configuredSecrets).every((value) => typeof value === 'boolean'))
    .toBe(true);
  expect(Object.values(body.checks).every((value) => typeof value === 'boolean'))
    .toBe(true);
}

describe('proDraftSecuritySelfCheck request and environment gates', () => {
  it('rejects the wrong method', async () => {
    const { handler } = createHarness();
    const response = await handler(request(undefined, { method: 'GET' }));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expectSafeShape(await responseBody(response));
  });

  it('rejects the wrong content type', async () => {
    const { handler } = createHarness();
    const response = await handler(request('{}', { contentType: 'text/plain' }));
    expect(response.status).toBe(415);
    expectSafeShape(await responseBody(response));
  });

  it('rejects a declared or streamed request over 16 KB', async () => {
    const { handler } = createHarness();
    const response = await handler(request('x'.repeat(
      PRO_DRAFT_SECURITY_SELF_CHECK_REQUEST_LIMIT_BYTES + 1,
    )));
    expect(response.status).toBe(413);
    expectSafeShape(await responseBody(response));
  });

  it('returns 404 for an unknown environment without authenticating or reading secrets', async () => {
    const harness = createHarness({
      environment: { PRO_DRAFT_ENVIRONMENT: 'preview' },
    });
    const response = await harness.handler(request());
    expect(response.status).toBe(404);
    expect(harness.createClientFromRequest).not.toHaveBeenCalled();
    expect(harness.getEnvironmentValue).not.toHaveBeenCalledWith(
      'PRO_FORM_DRAFT_TOKEN_SECRET',
    );
  });

  it('returns 404 in production without authenticating or reading secrets', async () => {
    const harness = createHarness({
      environment: { PRO_DRAFT_ENVIRONMENT: 'production' },
    });
    const response = await harness.handler(request());
    expect(response.status).toBe(404);
    expect((await responseBody(response)).environment).toBe('production');
    expect(harness.createClientFromRequest).not.toHaveBeenCalled();
    expect(harness.getEnvironmentValue).not.toHaveBeenCalledWith(
      'PRO_FORM_DRAFT_TOKEN_SECRET',
    );
  });

  it('returns 404 when diagnostics are disabled', async () => {
    const harness = createHarness({
      environment: { PRO_DRAFT_DIAGNOSTICS_ENABLED: 'false' },
    });
    const response = await harness.handler(request());
    expect(response.status).toBe(404);
    expect(harness.createClientFromRequest).not.toHaveBeenCalled();
  });
});

describe('proDraftSecuritySelfCheck authentication and configuration', () => {
  it('rejects an unauthenticated request', async () => {
    const { handler } = createHarness({ user: null });
    const response = await handler(request());
    expect(response.status).toBe(401);
    expectSafeShape(await responseBody(response));
  });

  it('rejects an authenticated non-admin request', async () => {
    const { handler } = createHarness({ user: { id: 'member', role: 'user' } });
    const response = await handler(request());
    expect(response.status).toBe(403);
    expectSafeShape(await responseBody(response));
  });

  it('accepts the verified Base44 admin role and performs the full check', async () => {
    const harness = createHarness();
    const response = await harness.handler(request());
    expect(response.status).toBe(200);
    expect(harness.createClientFromRequest).toHaveBeenCalledOnce();
    expect((await responseBody(response)).success).toBe(true);
  });

  it('reports a missing secret by approved boolean only', async () => {
    const { handler } = createHarness({
      environment: { PRO_FORM_DRAFT_LINK_SECRET: undefined },
    });
    const response = await handler(request());
    const body = await responseBody(response);
    expect(response.status).toBe(503);
    expect(body.configuredSecrets.linkSigning).toBe(false);
    expect(body.checks.secretLengths).toBe(false);
    expectSafeShape(body);
  });

  it('reports a short secret without returning its length or value', async () => {
    const { handler } = createHarness({
      environment: { PRO_FORM_RECOVERY_CODE_SECRET: 'too-short' },
    });
    const response = await handler(request());
    const body = await responseBody(response);
    expect(response.status).toBe(503);
    expect(body.configuredSecrets.recoveryCode).toBe(true);
    expect(body.checks.secretLengths).toBe(false);
    expect(JSON.stringify(body)).not.toContain('too-short');
  });

  it('rejects duplicate purpose secrets', async () => {
    const { handler } = createHarness({
      environment: {
        PRO_FORM_DRAFT_LINK_SECRET: SECRET_VALUES.PRO_FORM_DRAFT_TOKEN_SECRET,
      },
    });
    const response = await handler(request());
    const body = await responseBody(response);
    expect(response.status).toBe(503);
    expect(body.checks.secretLengths).toBe(true);
    expect(body.checks.secretSeparation).toBe(false);
  });
});

describe('proDraftSecuritySelfCheck safe successful response', () => {
  it('returns the exact safe schema with every check true', async () => {
    const { handler } = createHarness();
    const response = await handler(request());
    const body = await responseBody(response);
    expect(response.status).toBe(200);
    expectSafeShape(body);
    expect(body).toMatchObject({
      success: true,
      environment: 'staging',
      securityVersion: 1,
      authorizationVersion: 1,
      persistenceVersion: 1,
      requestId: REQUEST_ID,
    });
    expect(Object.values(body.configuredSecrets)).toEqual(Array(6).fill(true));
    expect(Object.values(body.checks)).toEqual(Array(17).fill(true));
  });

  it('contains no raw generated value, secret, email, code, hash, or stack trace', async () => {
    const { handler } = createHarness();
    const responseText = await (await handler(request())).text();
    const body = JSON.parse(responseText);
    const responseValues = JSON.stringify({
      ...body,
      requestId: undefined,
    });
    for (const secretValue of Object.values(SECRET_VALUES)) {
      expect(responseValues).not.toContain(secretValue);
    }
    expect(responseValues).not.toMatch(/security-self-check@example\.test/iu);
    expect(responseValues).not.toMatch(/[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}(?:-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}){4}/u);
    expect(responseValues).not.toMatch(/[A-Za-z0-9_-]{43,}/u);
    expect(responseValues).not.toMatch(/\b[0-9a-f]{64}\b/iu);
    expect(responseValues).not.toMatch(/stack|secretValue|draftId/iu);
  });

  it('sets no-store JSON response headers', async () => {
    const { handler } = createHarness();
    const response = await handler(request());
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(response.headers.get('pragma')).toBe('no-cache');
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('sanitizes unexpected authentication errors', async () => {
    const sensitiveError = new Error('secret@example.test PRIVATE_TOKEN_VALUE');
    const createClientFromRequest = vi.fn(() => ({
      auth: { me: vi.fn().mockRejectedValue(sensitiveError) },
    }));
    const handler = createProDraftSecuritySelfCheckHandler({
      createClientFromRequest,
      getEnvironmentValue: (name) => ({
        PRO_DRAFT_ENVIRONMENT: 'staging',
        PRO_DRAFT_DIAGNOSTICS_ENABLED: 'true',
        ...SECRET_VALUES,
      })[name],
      createRequestId: () => REQUEST_ID,
    });
    const response = await handler(request());
    const responseText = await response.text();
    expect(response.status).toBe(500);
    expect(responseText).not.toContain('secret@example.test');
    expect(responseText).not.toContain('PRIVATE_TOKEN_VALUE');
    expectSafeShape(JSON.parse(responseText));
  });

  it('keeps the Base44 SDK import and Deno environment reads in the staging endpoint only', () => {
    const entrySource = readFileSync(resolve(
      process.cwd(),
      'base44/functions/proDraftSecuritySelfCheck/entry.ts',
    ), 'utf8');
    const coreSource = readFileSync(resolve(
      process.cwd(),
      'base44/functions/proDraftSecuritySelfCheck/core.ts',
    ), 'utf8');
    expect(entrySource).toContain("from 'npm:@base44/sdk'");
    expect(entrySource).toContain('createClientFromRequest');
    expect(entrySource).toContain('Deno.env.get');
    expect(entrySource).toContain('Deno.serve');
    expect(coreSource).not.toMatch(/console\s*\.|DRAFT_RECOVERY_PASSWORD/u);
  });
});
