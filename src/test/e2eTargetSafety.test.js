import {
  assertSafeNavigation,
  canRunWriteTests,
  E2ETargetSafetyError,
  isDocumentedProductionHostname,
  isKnownZapierUrl,
  resolveE2ETarget,
} from '../../tests/e2e/helpers/targetSafety.js';
import {
  isSensitiveQueryKey,
  redactText,
  redactUrl,
} from '../../tests/e2e/helpers/redaction.js';
import {
  createSyntheticBusinessName,
  createSyntheticEmail,
  createTestRunId,
  isValidTestRunId,
} from '../../tests/e2e/helpers/testRunId.js';

const expectSafetyCode = (callback, code) => {
  expect(callback).toThrowError(expect.objectContaining({
    code,
    name: 'E2ETargetSafetyError',
  }));
};

describe('E2E target safety', () => {
  it('defaults to a loopback local server only when no URL is supplied', () => {
    expect(resolveE2ETarget({})).toMatchObject({
      allowProduction: false,
      allowWrites: false,
      baseURL: 'http://127.0.0.1:4173',
      environment: 'local',
      usesLocalWebServer: true,
    });
  });

  it('requires an environment when an explicit URL is supplied', () => {
    expectSafetyCode(
      () => resolveE2ETarget({ E2E_BASE_URL: 'https://staging.example.test' }),
      'MISSING_E2E_TARGET_ENVIRONMENT',
    );
  });

  it('requires an explicit remote URL for staging', () => {
    expectSafetyCode(
      () => resolveE2ETarget({ E2E_TARGET_ENVIRONMENT: 'staging' }),
      'MISSING_E2E_BASE_URL',
    );
    expectSafetyCode(
      () => resolveE2ETarget({
        E2E_BASE_URL: 'http://127.0.0.1:4173',
        E2E_TARGET_ENVIRONMENT: 'staging',
      }),
      'STAGING_E2E_REQUIRES_REMOTE_URL',
    );
  });

  it('rejects a production target before Playwright launches', () => {
    expectSafetyCode(
      () => resolveE2ETarget({
        E2E_ALLOW_PRODUCTION: 'false',
        E2E_BASE_URL: 'https://questionnaire.example.test',
        E2E_TARGET_ENVIRONMENT: 'production',
      }),
      'PRODUCTION_E2E_NOT_ALLOWED',
    );
  });

  it('rejects documented production hostnames in staging mode', () => {
    expect(isDocumentedProductionHostname('www.mspsuccesswebsites.com')).toBe(true);
    expect(
      isDocumentedProductionHostname('qtrypzzcjebvfcihiynt.supabase.co'),
    ).toBe(true);
    expectSafetyCode(
      () => resolveE2ETarget({
        E2E_BASE_URL: 'https://forms.mspsuccesswebsites.com',
        E2E_TARGET_ENVIRONMENT: 'staging',
      }),
      'PRODUCTION_E2E_NOT_ALLOWED',
    );
  });

  it('does not implement production writes even with both current flags', () => {
    expectSafetyCode(
      () => resolveE2ETarget({
        E2E_ALLOW_PRODUCTION: 'true',
        E2E_ALLOW_WRITES: 'true',
        E2E_BASE_URL: 'https://questionnaire.example.test',
        E2E_TARGET_ENVIRONMENT: 'production',
      }),
      'PRODUCTION_E2E_WRITES_NOT_IMPLEMENTED',
    );
  });

  it('enables future staging writes only through the exact write flag', () => {
    const target = resolveE2ETarget({
      E2E_ALLOW_WRITES: 'true',
      E2E_BASE_URL: 'https://staging.example.test',
      E2E_TARGET_ENVIRONMENT: 'staging',
    });
    expect(canRunWriteTests(target)).toBe(true);
    expectSafetyCode(
      () => resolveE2ETarget({
        E2E_ALLOW_WRITES: 'TRUE',
        E2E_BASE_URL: 'https://staging.example.test',
        E2E_TARGET_ENVIRONMENT: 'staging',
      }),
      'INVALID_E2E_ALLOW_WRITES',
    );
    expectSafetyCode(
      () => resolveE2ETarget({ E2E_ALLOW_WRITES: 'true' }),
      'E2E_WRITES_REQUIRE_STAGING',
    );
  });

  it('rejects query strings, fragments, and credentials in the base URL', () => {
    expectSafetyCode(
      () => resolveE2ETarget({
        E2E_BASE_URL: 'https://staging.example.test/?access_token=secret',
        E2E_TARGET_ENVIRONMENT: 'staging',
      }),
      'QUERY_OR_HASH_IN_E2E_BASE_URL',
    );
    expectSafetyCode(
      () => resolveE2ETarget({
        E2E_BASE_URL: 'https://user:password@staging.example.test',
        E2E_TARGET_ENVIRONMENT: 'staging',
      }),
      'CREDENTIALS_IN_E2E_BASE_URL',
    );
  });

  it('permits navigation only within the validated origin', () => {
    const target = resolveE2ETarget({});
    expect(assertSafeNavigation('http://127.0.0.1:4173/questionnaire', target)).toBe(true);
    expectSafetyCode(
      () => assertSafeNavigation('https://www.mspsuccesswebsites.com', target),
      'UNEXPECTED_PRODUCTION_NAVIGATION',
    );
    expectSafetyCode(
      () => assertSafeNavigation('https://unrelated.example.test', target),
      'UNEXPECTED_CROSS_ORIGIN_NAVIGATION',
    );
  });

  it('recognizes Zapier hosts without matching lookalikes', () => {
    expect(isKnownZapierUrl('https://hooks.zapier.com/hooks/catch/1/2')).toBe(true);
    expect(isKnownZapierUrl('https://hooks.zapier.com.example.test/path')).toBe(false);
  });
});

describe('E2E redaction and synthetic identity', () => {
  it.each([
    'access_token',
    'recoveryCode',
    'draftAccessToken',
    'userEmail',
  ])('recognizes and redacts %s', (key) => {
    expect(isSensitiveQueryKey(key)).toBe(true);
    const redacted = redactUrl(`https://staging.example.test/?${key}=secret-value&safe=ok`);
    expect(redacted).not.toContain('secret-value');
    expect(redacted).toContain('%5BREDACTED%5D');
    expect(redacted).toContain('safe=ok');
  });

  it('redacts sensitive values from console-safe text', () => {
    const redacted = redactText(
      'url=?access_token=secret&userEmail=person@example.test; Authorization: Bearer secret-token; Cookie: session=secret-cookie',
    );
    expect(redacted).not.toContain('secret');
    expect(redacted).not.toContain('person@example.test');
    expect(redacted).not.toContain('Bearer');
    expect(redacted).not.toContain('session=');
  });

  it('creates a unique valid run ID when one is absent', () => {
    const first = createTestRunId();
    const second = createTestRunId();
    expect(isValidTestRunId(first)).toBe(true);
    expect(isValidTestRunId(second)).toBe(true);
    expect(first).not.toBe(second);
  });

  it('marks synthetic staging data with a safe name and email domain', () => {
    const runId = 'e2e-safe-run-0001';
    expect(createSyntheticBusinessName(runId)).toBe(`E2E STAGING ${runId}`);
    expect(createSyntheticEmail(runId)).toBe('e2e+e2e-safe-run-0001@example.test');
  });

  it('rejects unsafe caller-supplied run IDs', () => {
    expect(() => createTestRunId('short')).toThrow('INVALID_E2E_TEST_RUN_ID');
    expect(() => createTestRunId('e2e unsafe query?')).toThrow(
      'INVALID_E2E_TEST_RUN_ID',
    );
  });
});
