/** Server-only CAPTCHA provider abstraction for future public recovery APIs. */

export const CAPTCHA_PROVIDER_MODES = Object.freeze([
  'disabled', 'turnstile', 'staging_test',
] as const);

export const CAPTCHA_ERROR_CODES = Object.freeze({
  NOT_REQUIRED: 'CAPTCHA_NOT_REQUIRED',
  UNAVAILABLE: 'CAPTCHA_UNAVAILABLE',
  TOKEN_INVALID: 'CAPTCHA_TOKEN_INVALID',
  PROVIDER_REJECTED: 'CAPTCHA_PROVIDER_REJECTED',
  PROVIDER_TIMEOUT: 'CAPTCHA_PROVIDER_TIMEOUT',
  PROVIDER_ERROR: 'CAPTCHA_PROVIDER_ERROR',
  HOSTNAME_MISMATCH: 'CAPTCHA_HOSTNAME_MISMATCH',
  ACTION_MISMATCH: 'CAPTCHA_ACTION_MISMATCH',
  STAGING_TEST_FORBIDDEN: 'CAPTCHA_STAGING_TEST_FORBIDDEN',
} as const);

export type CaptchaProviderMode = typeof CAPTCHA_PROVIDER_MODES[number];
export type CaptchaErrorCode = typeof CAPTCHA_ERROR_CODES[
  keyof typeof CAPTCHA_ERROR_CODES
];
export type CaptchaEnvironment = 'local' | 'test' | 'staging' | 'production' | 'unknown';

type EnvSource = Readonly<Record<string, unknown>>
  | Readonly<{ get: (name: string) => unknown }>
  | ((name: string) => unknown);

type CaptchaConfiguration = Readonly<{
  provider: CaptchaProviderMode;
  environment: CaptchaEnvironment;
  secretKey: string;
  verifyUrl: string;
  expectedHostname: string;
  testModeEnabled: boolean;
  configured: boolean;
}>;

export type CaptchaVerificationResult = Readonly<{
  success: boolean;
  captchaRequired: boolean;
  captchaVerified: boolean;
  provider: CaptchaProviderMode;
  errorCode: CaptchaErrorCode | null;
}>;

const DEFAULT_TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const STAGING_TEST_TOKEN = 'staging-test-valid';
const MAX_TOKEN_LENGTH = 4096;
const MAX_ACTION_LENGTH = 64;
const MIN_TIMEOUT_MS = 250;
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_TIMEOUT_MS = 10000;

function readEnv(source: EnvSource, name: string): unknown {
  try {
    if (typeof source === 'function') return source(name);
    if ('get' in source && typeof source.get === 'function') return source.get(name);
    return source[name];
  } catch {
    return undefined;
  }
}

function defaultEnv(name: string): unknown {
  try {
    return (globalThis as typeof globalThis & {
      Deno?: { env?: { get?: (key: string) => string | undefined } };
    }).Deno?.env?.get?.(name);
  } catch {
    return undefined;
  }
}

function environment(value: unknown): CaptchaEnvironment {
  return value === 'local' || value === 'test' || value === 'staging'
    || value === 'production' ? value : 'unknown';
}

function provider(value: unknown): CaptchaProviderMode {
  return CAPTCHA_PROVIDER_MODES.includes(value as CaptchaProviderMode)
    ? value as CaptchaProviderMode : 'disabled';
}

function safeString(value: unknown, maximum: number): string {
  return typeof value === 'string' && value.length <= maximum ? value : '';
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

function getCaptchaConfiguration(
  envSource: EnvSource = defaultEnv,
  environmentOverride?: CaptchaEnvironment,
): CaptchaConfiguration {
  const selectedProvider = provider(readEnv(envSource, 'PRO_DRAFT_CAPTCHA_PROVIDER'));
  const selectedEnvironment = environment(
    environmentOverride ?? readEnv(envSource, 'PRO_DRAFT_ENVIRONMENT'),
  );
  const secretKey = safeString(readEnv(envSource, 'PRO_DRAFT_CAPTCHA_SECRET_KEY'), 4096);
  const configuredUrl = safeString(
    readEnv(envSource, 'PRO_DRAFT_CAPTCHA_VERIFY_URL'),
    2048,
  );
  const verifyUrl = configuredUrl || DEFAULT_TURNSTILE_VERIFY_URL;
  const expectedHostname = safeString(
    readEnv(envSource, 'PRO_DRAFT_CAPTCHA_EXPECTED_HOSTNAME'),
    253,
  ).toLowerCase();
  const testModeEnabled = readEnv(
    envSource,
    'PRO_DRAFT_CAPTCHA_TEST_MODE_ENABLED',
  ) === 'true';
  const configured = selectedProvider === 'turnstile'
    ? secretKey.length >= 16 && isHttpsUrl(verifyUrl)
    : selectedProvider === 'staging_test'
      ? testModeEnabled && (selectedEnvironment === 'staging' || selectedEnvironment === 'test')
      : false;
  return Object.freeze({
    provider: selectedProvider,
    environment: selectedEnvironment,
    secretKey,
    verifyUrl,
    expectedHostname,
    testModeEnabled,
    configured,
  });
}

export function isCaptchaConfigured(
  envSource: EnvSource = defaultEnv,
  environmentOverride?: CaptchaEnvironment,
): boolean {
  return getCaptchaConfiguration(envSource, environmentOverride).configured;
}

function result(
  success: boolean,
  required: boolean,
  verified: boolean,
  selectedProvider: CaptchaProviderMode,
  errorCode: CaptchaErrorCode | null,
): CaptchaVerificationResult {
  return Object.freeze({
    success,
    captchaRequired: required,
    captchaVerified: verified,
    provider: selectedProvider,
    errorCode,
  });
}

function boundedTimeout(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, value as number));
}

export async function verifyRecoveryCaptcha(options: Readonly<{
  required: boolean;
  token?: string | null;
  remoteIp?: string | null;
  action?: string | null;
  envSource?: EnvSource;
  environment?: CaptchaEnvironment;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}>): Promise<CaptchaVerificationResult> {
  const config = getCaptchaConfiguration(options.envSource, options.environment);
  if (!options.required && !options.token) {
    return result(true, false, false, config.provider, CAPTCHA_ERROR_CODES.NOT_REQUIRED);
  }
  if (config.provider === 'staging_test' && config.environment === 'production') {
    return result(false, options.required, false, config.provider,
      CAPTCHA_ERROR_CODES.STAGING_TEST_FORBIDDEN);
  }
  if (!config.configured) {
    return result(false, options.required, false, config.provider,
      CAPTCHA_ERROR_CODES.UNAVAILABLE);
  }
  if (typeof options.token !== 'string' || options.token.length === 0
    || options.token.length > MAX_TOKEN_LENGTH) {
    return result(false, options.required, false, config.provider,
      CAPTCHA_ERROR_CODES.TOKEN_INVALID);
  }
  if (config.provider === 'staging_test') {
    const verified = options.token === STAGING_TEST_TOKEN;
    return result(verified, options.required, verified, config.provider,
      verified ? null : CAPTCHA_ERROR_CODES.PROVIDER_REJECTED);
  }

  const action = safeString(options.action, MAX_ACTION_LENGTH);
  if (options.action && !action) {
    return result(false, options.required, false, config.provider,
      CAPTCHA_ERROR_CODES.ACTION_MISMATCH);
  }
  const body = new URLSearchParams();
  body.set('secret', config.secretKey);
  body.set('response', options.token);
  if (typeof options.remoteIp === 'string' && options.remoteIp.length <= 128) {
    body.set('remoteip', options.remoteIp);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), boundedTimeout(options.timeoutMs));
  try {
    const response = await (options.fetchImpl ?? fetch)(config.verifyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      return result(false, options.required, false, config.provider,
        CAPTCHA_ERROR_CODES.PROVIDER_ERROR);
    }
    const payload = await response.json() as Record<string, unknown>;
    if (payload.success !== true) {
      return result(false, options.required, false, config.provider,
        CAPTCHA_ERROR_CODES.PROVIDER_REJECTED);
    }
    if (config.expectedHostname) {
      const actual = typeof payload.hostname === 'string'
        ? payload.hostname.toLowerCase() : '';
      if (actual !== config.expectedHostname) {
        return result(false, options.required, false, config.provider,
          CAPTCHA_ERROR_CODES.HOSTNAME_MISMATCH);
      }
    }
    if (action && payload.action !== action) {
      return result(false, options.required, false, config.provider,
        CAPTCHA_ERROR_CODES.ACTION_MISMATCH);
    }
    return result(true, options.required, true, config.provider, null);
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'AbortError';
    return result(false, options.required, false, config.provider,
      timedOut ? CAPTCHA_ERROR_CODES.PROVIDER_TIMEOUT : CAPTCHA_ERROR_CODES.PROVIDER_ERROR);
  } finally {
    clearTimeout(timeout);
  }
}

export function getSafeCaptchaDiagnostics(
  envSource: EnvSource = defaultEnv,
  environmentOverride?: CaptchaEnvironment,
): Readonly<Record<string, unknown>> {
  const config = getCaptchaConfiguration(envSource, environmentOverride);
  return Object.freeze({
    provider: config.provider,
    environment: config.environment,
    configured: config.configured,
    expectedHostnameConfigured: config.expectedHostname !== '',
    customVerifyUrlConfigured: readEnv(envSource, 'PRO_DRAFT_CAPTCHA_VERIFY_URL') != null,
    testModeEnabled: config.testModeEnabled,
    secretKeyPresent: config.secretKey !== '',
    storesToken: false,
  });
}
