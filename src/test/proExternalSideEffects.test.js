import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertExternalSideEffectAllowed,
  buildSafeSideEffectLogContext,
  buildZapierPersistenceDiagnostics,
  getExternalSideEffectPolicy,
  performZapierSubmission,
  resolveExternalDestination,
} from '../../base44/functions/_shared/proExternalSideEffects/entry.ts';
import { createSendToZapierHandler } from '../../base44/functions/sendToZapier/entry.ts';
import { base44 } from '@/api/base44Client';
import { sendZapierSafe } from '@/lib/proQuestionnaireSubmit';

const PRODUCTION_DESTINATION = 'https://production.invalid/internal-test';
const STAGING_DESTINATION = 'https://staging.invalid/internal-test';

const backendEnvironment = (overrides = {}) => ({
  PRO_DRAFT_ENVIRONMENT: 'production',
  PRO_DRAFT_V2_SERVER_ENABLED: 'false',
  PRO_DRAFT_V2_KILL_SWITCH: 'true',
  PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE: 'production',
  PRO_ZAPIER_WEBHOOK_URL: PRODUCTION_DESTINATION,
  STAGING_ZAPIER_WEBHOOK_URL: STAGING_DESTINATION,
  PRO_ZAPIER_TIMEOUT_MS: '8000',
  ...overrides,
});

const request = (body = {}, headers = {}) =>
  new Request('https://function.invalid/sendToZapier', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-request-id': 'request-test-1',
      ...headers,
    },
    body: JSON.stringify(body),
  });

const successfulFetch = () =>
  vi.fn(async () => new Response('', { status: 200 }));

const readProjectFile = (path) =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('shared external-side-effect policy', () => {
  it('allows production delivery only with the production environment and URL', async () => {
    const fetchImpl = successfulFetch();
    const result = await performZapierSubmission(
      { metadata: { questionnaire_session_id: 'session-production-1' } },
      { envSource: backendEnvironment(), fetchImpl },
    );

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][0]).toBe(PRODUCTION_DESTINATION);
    expect(result).toEqual({
      success: true,
      delivered: true,
      redirected: false,
      suppressed: false,
      environment: 'production',
      mode: 'production',
      destinationClass: 'production',
      externalStatus: 200,
      errorCode: '',
      message: 'Data delivered to the configured production destination.',
    });
  });

  it('fails closed when production mode has no production URL', async () => {
    const fetchImpl = successfulFetch();
    const env = backendEnvironment({ PRO_ZAPIER_WEBHOOK_URL: undefined });
    const result = await performZapierSubmission({}, { envSource: env, fetchImpl });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: false,
      delivered: false,
      suppressed: false,
      errorCode: 'DESTINATION_MISSING',
    });
  });

  it('redirects staging only to the configured staging destination', async () => {
    const fetchImpl = successfulFetch();
    const env = backendEnvironment({
      PRO_DRAFT_ENVIRONMENT: 'staging',
      PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE: 'staging_redirect',
    });
    const result = await performZapierSubmission({}, { envSource: env, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][0]).toBe(STAGING_DESTINATION);
    expect(fetchImpl.mock.calls[0][0]).not.toBe(PRODUCTION_DESTINATION);
    expect(result).toMatchObject({
      success: true,
      delivered: true,
      redirected: true,
      suppressed: false,
      environment: 'staging',
      mode: 'staging_redirect',
      destinationClass: 'staging',
    });
  });

  it('fails closed when staging redirect has no staging URL', async () => {
    const fetchImpl = successfulFetch();
    const env = backendEnvironment({
      PRO_DRAFT_ENVIRONMENT: 'staging',
      PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE: 'staging_redirect',
      STAGING_ZAPIER_WEBHOOK_URL: undefined,
    });
    const result = await performZapierSubmission({}, { envSource: env, fetchImpl });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.errorCode).toBe('DESTINATION_MISSING');
    expect(result.destinationClass).toBe('staging');
  });

  it('suppresses disabled mode and performs zero fetch calls', async () => {
    const fetchImpl = successfulFetch();
    const result = await performZapierSubmission(
      {},
      {
        envSource: backendEnvironment({
          PRO_DRAFT_ENVIRONMENT: 'staging',
          PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE: 'disabled',
          STAGING_ZAPIER_WEBHOOK_URL: undefined,
        }),
        fetchImpl,
      },
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      delivered: false,
      redirected: false,
      suppressed: true,
      errorCode: 'EXTERNAL_SIDE_EFFECTS_DISABLED',
    });
  });

  it.each([
    ['unknown', 'production'],
    ['test', 'production'],
    ['test', 'staging_redirect'],
  ])(
    'never performs a production fetch in %s environment with %s mode',
    async (environment, mode) => {
      const fetchImpl = successfulFetch();
      const result = await performZapierSubmission(
        {},
        {
          envSource: backendEnvironment({
            PRO_DRAFT_ENVIRONMENT: environment,
            PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE: mode,
          }),
          fetchImpl,
        },
      );

      expect(fetchImpl).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.delivered).toBe(false);
    },
  );

  it('ignores request-body destination overrides', async () => {
    const fetchImpl = successfulFetch();
    await performZapierSubmission(
      {
        destination: 'https://attacker.invalid/override',
        webhookUrl: 'https://attacker.invalid/override-2',
      },
      { envSource: backendEnvironment(), fetchImpl },
    );

    expect(fetchImpl.mock.calls[0][0]).toBe(PRODUCTION_DESTINATION);
  });

  it('rejects HTTP destinations unless a local test adapter explicitly allows them', async () => {
    const fetchImpl = successfulFetch();
    const env = backendEnvironment({
      PRO_DRAFT_ENVIRONMENT: 'staging',
      PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE: 'staging_redirect',
      STAGING_ZAPIER_WEBHOOK_URL: 'http://127.0.0.1:9999/fake-hook',
    });

    const rejected = await performZapierSubmission({}, { envSource: env, fetchImpl });
    expect(rejected.errorCode).toBe('DESTINATION_INVALID');
    expect(fetchImpl).not.toHaveBeenCalled();

    const allowedForTest = await performZapierSubmission(
      {},
      { envSource: env, fetchImpl, allowHttpForTests: true },
    );
    expect(allowedForTest.redirected).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('returns a safe timeout failure', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('synthetic timeout');
          error.name = 'AbortError';
          reject(error);
        });
      }),
    );
    const resultPromise = performZapierSubmission(
      {},
      {
        envSource: backendEnvironment({ PRO_ZAPIER_TIMEOUT_MS: '100' }),
        fetchImpl,
      },
    );

    await vi.advanceTimersByTimeAsync(100);
    await expect(resultPromise).resolves.toMatchObject({
      success: false,
      delivered: false,
      errorCode: 'EXTERNAL_TIMEOUT',
    });
  });

  it('returns a safe non-2xx failure without reading the external body', async () => {
    const responseText = vi.fn(async () => 'sensitive external response');
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 503,
      text: responseText,
    }));
    const result = await performZapierSubmission(
      {},
      { envSource: backendEnvironment(), fetchImpl },
    );

    expect(result).toMatchObject({
      success: false,
      delivered: false,
      externalStatus: 503,
      errorCode: 'EXTERNAL_HTTP_REJECTED',
    });
    expect(responseText).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('sensitive external response');
  });

  it('supports all declared side-effect kinds and rejects unconfigured destinations', () => {
    for (const kind of [
      'ses_email',
      'external_file_copy',
      'external_pdf_delivery',
      'external_notification',
    ]) {
      const resolved = resolveExternalDestination(kind, {
        envSource: backendEnvironment(),
      });
      expect(resolved.decision).toMatchObject({
        kind,
        allowed: false,
        destinationClass: 'unconfigured',
        reasonCode: 'DESTINATION_NOT_IMPLEMENTED',
      });
    }
  });

  it('asserts allowed destinations with a safe policy error', () => {
    expect(
      assertExternalSideEffectAllowed('zapier_submission', {
        envSource: backendEnvironment(),
      }).decision.allowed,
    ).toBe(true);
    expect(() =>
      assertExternalSideEffectAllowed('zapier_submission', {
        envSource: backendEnvironment({ PRO_ZAPIER_WEBHOOK_URL: undefined }),
      }),
    ).toThrow('External side effect is not allowed by server policy.');
  });
});

describe('sendToZapier public contract and safe logging', () => {
  it('returns the exact safe result shape without exposing either destination', async () => {
    const handler = createSendToZapierHandler({
      envSource: backendEnvironment(),
      fetchImpl: successfulFetch(),
      logger: { info: vi.fn(), error: vi.fn() },
    });
    const response = await handler(request({ answer: 'synthetic' }));
    const result = await response.json();

    expect(Object.keys(result)).toEqual([
      'success',
      'delivered',
      'redirected',
      'suppressed',
      'environment',
      'mode',
      'destinationClass',
      'externalStatus',
      'errorCode',
      'message',
    ]);
    expect(JSON.stringify(result)).not.toContain(PRODUCTION_DESTINATION);
    expect(JSON.stringify(result)).not.toContain(STAGING_DESTINATION);
  });

  it('logs only the approved safe context and never the payload or URL', async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const privatePayloadValue = 'PRIVATE_QUESTIONNAIRE_VALUE_DO_NOT_LOG';
    const handler = createSendToZapierHandler({
      envSource: backendEnvironment(),
      fetchImpl: successfulFetch(),
      logger,
    });

    await handler(
      request({
        metadata: { questionnaire_session_id: 'session-safe-1' },
        userdata: { answer: privatePayloadValue },
      }),
    );

    expect(logger.info).toHaveBeenCalledOnce();
    const serializedLog = JSON.stringify(logger.info.mock.calls);
    expect(serializedLog).not.toContain(privatePayloadValue);
    expect(serializedLog).not.toContain(PRODUCTION_DESTINATION);
    expect(logger.info.mock.calls[0][1]).toEqual({
      requestId: 'request-test-1',
      environment: 'production',
      mode: 'production',
      payloadByteSize: expect.any(Number),
      submissionIdentifier: 'session-safe-1',
      externalStatus: 200,
    });
  });

  it('validates POST, JSON content type, and bounded body size before fetch', async () => {
    const fetchImpl = successfulFetch();
    const handler = createSendToZapierHandler({
      envSource: backendEnvironment(),
      fetchImpl,
      logger: { info: vi.fn(), error: vi.fn() },
    });

    const getResponse = await handler(
      new Request('https://function.invalid/sendToZapier', { method: 'GET' }),
    );
    expect(getResponse.status).toBe(405);

    const textResponse = await handler(
      new Request('https://function.invalid/sendToZapier', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: '{}',
      }),
    );
    expect(textResponse.status).toBe(415);

    const largeResponse = await handler(
      request({}, { 'content-length': '1000001' }),
    );
    expect(largeResponse.status).toBe(413);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('builds safe log context even when identifiers contain unsafe values', () => {
    const decision = getExternalSideEffectPolicy('zapier_submission', {
      envSource: backendEnvironment(),
    });
    expect(
      buildSafeSideEffectLogContext(decision, {
        requestId: 'unsafe request token=value',
        submissionIdentifier: 'person@example.test',
      }),
    ).toMatchObject({ requestId: '', submissionIdentifier: '' });
  });
});

describe('caller compatibility and truthful diagnostics', () => {
  it('does not mark a suppressed result as zapier_sent', () => {
    const diagnostics = buildZapierPersistenceDiagnostics({
      success: true,
      delivered: false,
      redirected: false,
      suppressed: true,
      environment: 'staging',
      mode: 'disabled',
      destinationClass: 'none',
      externalStatus: null,
      errorCode: 'EXTERNAL_SIDE_EFFECTS_DISABLED',
      message: 'suppressed',
    });

    expect(diagnostics).toMatchObject({
      zapier_sent: false,
      zapier_suppressed: true,
      zapier_redirected: false,
      zapier_status: null,
    });
  });

  it('records a staging redirect distinctly from production delivery', () => {
    const diagnostics = buildZapierPersistenceDiagnostics({
      success: true,
      delivered: true,
      redirected: true,
      suppressed: false,
      environment: 'staging',
      mode: 'staging_redirect',
      destinationClass: 'staging',
      externalStatus: 202,
      errorCode: '',
      message: 'redirected',
    });

    expect(diagnostics).toMatchObject({
      zapier_sent: true,
      zapier_suppressed: false,
      zapier_redirected: true,
      zapier_status: 202,
    });
  });

  it('keeps the legacy production success response compatible', async () => {
    base44.functions.invoke.mockResolvedValueOnce({ data: { success: true } });
    await expect(sendZapierSafe({ synthetic: true })).resolves.toMatchObject({
      ok: true,
      delivered: true,
      redirected: false,
      suppressed: false,
      status: 'delivered',
    });
  });

  it('lets the frontend distinguish a structured suppression result', async () => {
    base44.functions.invoke.mockResolvedValueOnce({
      data: {
        success: true,
        delivered: false,
        redirected: false,
        suppressed: true,
        environment: 'staging',
        mode: 'disabled',
        destinationClass: 'none',
        externalStatus: null,
        errorCode: 'EXTERNAL_SIDE_EFFECTS_DISABLED',
      },
    });
    await expect(sendZapierSafe({ synthetic: true })).resolves.toMatchObject({
      ok: true,
      delivered: false,
      redirected: false,
      suppressed: true,
      status: 'suppressed',
    });
  });
});

describe('function entrypoint normalization', () => {
  it.each([
    [
      'sendToZapier',
      'base44/functions/sendToZapier/entry.ts',
      'base44/functions/sendToZapier/entry/entry.ts',
      "export { default } from '../entry.ts';",
    ],
    [
      'retryProQuestionnaireIntakeSubmission',
      'base44/functions/retryProQuestionnaireIntakeSubmission/entry.ts',
      'base44/functions/retryProQuestionnaireIntakeSubmission/entry/entry.ts',
      "export { default } from '../entry.ts';",
    ],
    [
      'submitProQuestionnaireFallback',
      'base44/functions/submitProQuestionnaireFallback/entry/entry.ts',
      'base44/functions/submitProQuestionnaireFallback/entry.ts',
      "export { default } from './entry/entry.ts';",
    ],
  ])('%s has one implementation and an import-only compatibility entry', (_name, implementationPath, wrapperPath, expectedExport) => {
    const implementation = readProjectFile(implementationPath);
    const wrapper = readProjectFile(wrapperPath);

    expect(implementation).toContain('export default');
    expect(wrapper).toContain(expectedExport);
    expect(wrapper).not.toContain('fetch(');
    expect(wrapper).not.toContain('Deno.serve');
  });

  it('keeps all Zapier destinations server-configured and removes direct caller fetches', () => {
    const destinationHostFragment = ['hooks', 'zapier.com'].join('.');
    const sources = [
      'base44/functions/sendToZapier/entry.ts',
      'base44/functions/sendToZapier/entry/entry.ts',
      'base44/functions/retryProQuestionnaireIntakeSubmission/entry.ts',
      'base44/functions/retryProQuestionnaireIntakeSubmission/entry/entry.ts',
      'base44/functions/repairProQuestionnaireIntakeSubmission/entry.ts',
      'base44/functions/_shared/proExternalSideEffects/entry.ts',
    ].map(readProjectFile).join('\n');

    expect(sources).not.toContain(destinationHostFragment);
    expect(sources).not.toContain("Deno.env.get('ZAPIER_WEBHOOK_URL')");
    expect(readProjectFile('base44/functions/retryProQuestionnaireIntakeSubmission/entry.ts')).not.toContain('fetch(');
    expect(readProjectFile('base44/functions/repairProQuestionnaireIntakeSubmission/entry.ts')).not.toContain('fetch(');
  });
});
