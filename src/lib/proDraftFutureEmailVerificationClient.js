import { base44 } from '@/api/base44Client';
import {
  frontendRuntimeConfig,
  isEmailOtpClientEnabled,
  isMagicLinkClientEnabled,
} from '@/lib/proDraftRuntimeConfig';

export const PRO_DRAFT_FUTURE_EMAIL_VERIFICATION_CLIENT_VERSION = 1;

export const FUTURE_EMAIL_VERIFICATION_FUNCTIONS = Object.freeze({
  requestEmailOtp: 'requestProDraftEmailOtp',
  verifyEmailOtp: 'verifyProDraftEmailOtp',
  requestMagicLink: 'requestProDraftMagicLink',
  consumeMagicLink: 'consumeProDraftMagicLink',
});

const OPERATIONS = Object.freeze({
  requestEmailOtp: Object.freeze({ method: 'otp', flag: 'otp' }),
  verifyEmailOtp: Object.freeze({ method: 'otp', flag: 'otp' }),
  requestMagicLink: Object.freeze({ method: 'magic_link', flag: 'magic_link' }),
  consumeMagicLink: Object.freeze({ method: 'magic_link', flag: 'magic_link' }),
});

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function disabledResult(method) {
  return Object.freeze({
    success: false,
    enabled: false,
    method,
    errorCode: 'FEATURE_DISABLED',
    message: 'Email verification is unavailable.',
  });
}

function genericFailure(method) {
  return Object.freeze({
    success: false,
    enabled: true,
    method,
    errorCode: 'EMAIL_VERIFICATION_FAILED',
    message: 'Email verification could not be completed.',
  });
}

export function createProDraftFutureEmailVerificationClient({
  client = base44,
  runtimeConfig = frontendRuntimeConfig,
} = {}) {
  const invoke = client?.functions?.invoke;
  const available = typeof invoke === 'function';
  const flags = Object.freeze({
    otp: isEmailOtpClientEnabled(runtimeConfig),
    magic_link: isMagicLinkClientEnabled(runtimeConfig),
  });

  const call = async (operationName, input = {}) => {
    const operation = OPERATIONS[operationName];
    if (!operation || !flags[operation.flag]) return disabledResult(operation?.method ?? 'unknown');
    if (!available || !isPlainObject(input)) return genericFailure(operation.method);
    try {
      const response = await invoke.call(
        client.functions,
        FUTURE_EMAIL_VERIFICATION_FUNCTIONS[operationName],
        Object.freeze({ ...input, apiVersion: 1 }),
      );
      const body = isPlainObject(response?.data) ? response.data : null;
      if (!body || typeof body.success !== 'boolean') return genericFailure(operation.method);
      return Object.freeze({ ...body });
    } catch {
      return genericFailure(operation.method);
    }
  };

  return Object.freeze({
    requestEmailOtp: (input) => call('requestEmailOtp', input),
    verifyEmailOtp: (input) => call('verifyEmailOtp', input),
    requestMagicLink: (input) => call('requestMagicLink', input),
    consumeMagicLink: (input) => call('consumeMagicLink', input),
    getDiagnostics: () => Object.freeze({
      version: PRO_DRAFT_FUTURE_EMAIL_VERIFICATION_CLIENT_VERSION,
      otpEnabled: flags.otp,
      magicLinkEnabled: flags.magic_link,
      available,
      rendersUi: false,
      addsRoutes: false,
      persistsOtp: false,
      persistsMagicLinkToken: false,
      storesRequests: false,
    }),
  });
}

export const proDraftFutureEmailVerificationClient =
  createProDraftFutureEmailVerificationClient();

export function requestEmailOtp(input) {
  return proDraftFutureEmailVerificationClient.requestEmailOtp(input);
}

export function verifyEmailOtp(input) {
  return proDraftFutureEmailVerificationClient.verifyEmailOtp(input);
}

export function requestMagicLink(input) {
  return proDraftFutureEmailVerificationClient.requestMagicLink(input);
}

export function consumeMagicLink(input) {
  return proDraftFutureEmailVerificationClient.consumeMagicLink(input);
}
