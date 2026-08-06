const PRODUCTION_HOST_PATTERNS = Object.freeze([
  /(^|\.)mspsuccesswebsites\.com$/iu,
  /qtrypzzcjebvfcihiynt\.supabase\.co$/iu,
  /(^|[.-])prod(?:uction)?([.-]|$)/iu,
]);

const SAFE_ENVIRONMENTS = new Set(['local', 'test', 'staging']);
const RUN_ID_PATTERN = /^security-[a-z0-9-]{8,96}$/u;

export const assertSecurityTarget = (input = {}) => {
  const environment = String(input.environment || '').toLowerCase();
  if (!SAFE_ENVIRONMENTS.has(environment)) throw new Error('SECURITY_TARGET_ENVIRONMENT_DENIED');

  let target;
  try {
    target = new URL(String(input.baseURL || ''));
  } catch {
    throw new Error('SECURITY_TARGET_URL_INVALID');
  }
  if (!['http:', 'https:'].includes(target.protocol)) {
    throw new Error('SECURITY_TARGET_PROTOCOL_DENIED');
  }
  if (PRODUCTION_HOST_PATTERNS.some((pattern) => pattern.test(target.hostname))) {
    throw new Error('SECURITY_PRODUCTION_TARGET_DENIED');
  }
  if (environment === 'local' && !['127.0.0.1', 'localhost'].includes(target.hostname)) {
    throw new Error('SECURITY_LOCAL_TARGET_DENIED');
  }
  if (environment === 'staging' && !/(?:staging|example\.test)$/iu.test(target.hostname)) {
    throw new Error('SECURITY_STAGING_TARGET_UNVERIFIED');
  }
  return Object.freeze({ environment, origin: target.origin, production: false });
};

export const assertIsolatedRateLimitSubject = (input = {}) => {
  const testRunId = String(input.testRunId || '');
  const subject = String(input.subject || '').toLowerCase();
  const attempts = Number(input.attempts);
  if (!RUN_ID_PATTERN.test(testRunId)) throw new Error('SECURITY_TEST_RUN_ID_INVALID');
  if (!subject.endsWith('@example.test') || !subject.includes(testRunId)) {
    throw new Error('SECURITY_RATE_LIMIT_SUBJECT_NOT_ISOLATED');
  }
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 20) {
    throw new Error('SECURITY_BRUTE_FORCE_BOUND_EXCEEDED');
  }
  return Object.freeze({ testRunId, attempts, isolated: true });
};
