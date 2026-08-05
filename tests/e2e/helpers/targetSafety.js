const ALLOWED_TARGET_ENVIRONMENTS = new Set(['local', 'staging', 'production']);
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', '::1', 'localhost']);

// The approved documentation identifies this as the production organization
// domain. Any current/future questionnaire hostname below it is fail-closed.
const DOCUMENTED_PRODUCTION_HOST_SUFFIXES = Object.freeze([
  'mspsuccesswebsites.com',
  'qtrypzzcjebvfcihiynt.supabase.co',
]);

export const KNOWN_ZAPIER_HOSTNAMES = Object.freeze([
  'hooks.zapier.com',
  'zapier.com',
]);

export const DEFAULT_LOCAL_E2E_URL = 'http://127.0.0.1:4173';

export class E2ETargetSafetyError extends Error {
  constructor(code) {
    super(code);
    this.name = 'E2ETargetSafetyError';
    this.code = code;
  }
}

const strictFlag = (value, name) => {
  if (value === undefined || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new E2ETargetSafetyError(`INVALID_${name}`);
};

const hostnameMatches = (hostname, suffix) => (
  hostname === suffix || hostname.endsWith(`.${suffix}`)
);

export const isDocumentedProductionHostname = (hostname) => {
  const normalized = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return DOCUMENTED_PRODUCTION_HOST_SUFFIXES.some((suffix) => (
    hostnameMatches(normalized, suffix)
  ));
};

export const isKnownZapierUrl = (value) => {
  try {
    const hostname = new URL(String(value)).hostname.toLowerCase();
    return KNOWN_ZAPIER_HOSTNAMES.some((suffix) => hostnameMatches(hostname, suffix));
  } catch {
    return false;
  }
};

const parseBaseUrl = (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new E2ETargetSafetyError('INVALID_E2E_BASE_URL');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new E2ETargetSafetyError('UNSAFE_E2E_BASE_URL_PROTOCOL');
  }
  if (url.username || url.password) {
    throw new E2ETargetSafetyError('CREDENTIALS_IN_E2E_BASE_URL');
  }
  if (url.search || url.hash) {
    throw new E2ETargetSafetyError('QUERY_OR_HASH_IN_E2E_BASE_URL');
  }

  return url;
};

export const resolveE2ETarget = (env = process.env) => {
  const explicitBaseUrl = String(env.E2E_BASE_URL || '').trim();
  const usesLocalWebServer = explicitBaseUrl.length === 0;
  const rawEnvironment = String(env.E2E_TARGET_ENVIRONMENT || '').trim();

  if (!rawEnvironment && !usesLocalWebServer) {
    throw new E2ETargetSafetyError('MISSING_E2E_TARGET_ENVIRONMENT');
  }

  const environment = rawEnvironment || 'local';
  if (!ALLOWED_TARGET_ENVIRONMENTS.has(environment)) {
    throw new E2ETargetSafetyError('INVALID_E2E_TARGET_ENVIRONMENT');
  }
  if (environment !== 'local' && usesLocalWebServer) {
    throw new E2ETargetSafetyError('MISSING_E2E_BASE_URL');
  }

  const url = parseBaseUrl(explicitBaseUrl || DEFAULT_LOCAL_E2E_URL);
  const hostname = url.hostname.toLowerCase();
  const allowProduction = strictFlag(
    env.E2E_ALLOW_PRODUCTION,
    'E2E_ALLOW_PRODUCTION',
  );
  const allowWrites = strictFlag(env.E2E_ALLOW_WRITES, 'E2E_ALLOW_WRITES');
  const edgeEnabled = strictFlag(env.E2E_EDGE_ENABLED, 'E2E_EDGE_ENABLED');
  const productionHostname = isDocumentedProductionHostname(hostname);

  if ((environment === 'production' || productionHostname) && !allowProduction) {
    throw new E2ETargetSafetyError('PRODUCTION_E2E_NOT_ALLOWED');
  }
  if (environment !== 'production' && productionHostname) {
    throw new E2ETargetSafetyError('PRODUCTION_HOST_ENVIRONMENT_MISMATCH');
  }
  if (environment === 'local' && !LOOPBACK_HOSTNAMES.has(hostname)) {
    throw new E2ETargetSafetyError('LOCAL_E2E_REQUIRES_LOOPBACK');
  }
  if (environment === 'staging' && LOOPBACK_HOSTNAMES.has(hostname)) {
    throw new E2ETargetSafetyError('STAGING_E2E_REQUIRES_REMOTE_URL');
  }
  if (environment === 'production' && LOOPBACK_HOSTNAMES.has(hostname)) {
    throw new E2ETargetSafetyError('PRODUCTION_E2E_REQUIRES_REMOTE_URL');
  }

  // A separate production-write authorization does not exist in this batch.
  if (environment === 'production' && allowWrites) {
    throw new E2ETargetSafetyError('PRODUCTION_E2E_WRITES_NOT_IMPLEMENTED');
  }
  if (environment !== 'staging' && allowWrites) {
    throw new E2ETargetSafetyError('E2E_WRITES_REQUIRE_STAGING');
  }

  return Object.freeze({
    allowProduction,
    allowWrites,
    baseURL: url.origin + (url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')),
    edgeEnabled,
    environment,
    hostname,
    origin: url.origin,
    usesLocalWebServer,
  });
};

export const canRunWriteTests = (target) => (
  target?.allowWrites === true && target?.environment === 'staging'
);

export const assertSafeNavigation = (value, target) => {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new E2ETargetSafetyError('INVALID_NAVIGATION_URL');
  }

  if (isDocumentedProductionHostname(url.hostname) && !target?.allowProduction) {
    throw new E2ETargetSafetyError('UNEXPECTED_PRODUCTION_NAVIGATION');
  }
  if (url.origin !== target?.origin) {
    throw new E2ETargetSafetyError('UNEXPECTED_CROSS_ORIGIN_NAVIGATION');
  }

  return true;
};
