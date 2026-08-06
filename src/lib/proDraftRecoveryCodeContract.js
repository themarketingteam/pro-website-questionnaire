export const RECOVERY_CODE_VERSION = 1;
export const RECOVERY_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const RECOVERY_CODE_LENGTH = 20;
export const RECOVERY_CODE_GROUP_SIZE = 4;
export const RECOVERY_CODE_GROUP_COUNT = 5;
export const RECOVERY_CODE_ENTROPY_BITS = RECOVERY_CODE_LENGTH
  * Math.log2(RECOVERY_CODE_ALPHABET.length);

export const RECOVERY_CODE_ERROR_CODES = Object.freeze({
  INVALID_TYPE: 'RECOVERY_CODE_INVALID_TYPE',
  TOO_SHORT: 'RECOVERY_CODE_TOO_SHORT',
  TOO_LONG: 'RECOVERY_CODE_TOO_LONG',
  INVALID_CHARACTER: 'RECOVERY_CODE_INVALID_CHARACTER',
  INVALID_NORMALIZED_FORMAT: 'RECOVERY_CODE_INVALID_NORMALIZED_FORMAT',
  INVALID_RANDOM_VALUES: 'RECOVERY_CODE_INVALID_RANDOM_VALUES',
  INSUFFICIENT_ENTROPY: 'RECOVERY_CODE_INSUFFICIENT_ENTROPY',
});

// Selection values are duplicated in the backend contract and verified by the
// drift validator. They are data-only here; the frontend does not authorize
// recovery or select a draft.
export const DRAFT_LIFECYCLE_STATUS_VALUES = Object.freeze([
  'active',
  'submit_attempted',
  'submit_failed',
  'submitted',
  'cleared_superseded',
  'expired',
  'deleted',
]);

export const EMAIL_RECOVERY_ELIGIBLE_STATUSES = Object.freeze([
  'active',
  'submit_attempted',
  'submit_failed',
  'submitted',
]);

const ALPHABET_PATTERN = new RegExp(`^[${RECOVERY_CODE_ALPHABET}]+$`);
const NORMALIZED_PATTERN = new RegExp(
  `^[${RECOVERY_CODE_ALPHABET}]{${RECOVERY_CODE_LENGTH}}$`,
);

const freezeResult = (value) => Object.freeze(value);

const invalidResult = (errorCode, normalizedLength = 0) => freezeResult({
  valid: false,
  normalizedCode: '',
  normalizedLength,
  errorCode,
});

export class RecoveryCodeContractError extends TypeError {
  constructor(code) {
    super(`Recovery-code contract violation: ${code}`);
    this.name = 'RecoveryCodeContractError';
    this.code = code;
  }
}

/**
 * Canonicalizes user input without authorizing recovery.
 *
 * Only ordinary ASCII spaces and hyphens are ignored. The returned canonical
 * value is transient sensitive input and must not be persisted or logged.
 */
export const normalizeRecoveryCodeInput = (input) => {
  if (typeof input !== 'string') {
    return invalidResult(RECOVERY_CODE_ERROR_CODES.INVALID_TYPE);
  }

  const normalizedCode = input.replace(/[ -]/gu, '').toUpperCase();
  const normalizedLength = normalizedCode.length;

  if (normalizedLength < RECOVERY_CODE_LENGTH) {
    return invalidResult(RECOVERY_CODE_ERROR_CODES.TOO_SHORT, normalizedLength);
  }
  if (normalizedLength > RECOVERY_CODE_LENGTH) {
    return invalidResult(RECOVERY_CODE_ERROR_CODES.TOO_LONG, normalizedLength);
  }
  if (!ALPHABET_PATTERN.test(normalizedCode)) {
    return invalidResult(
      RECOVERY_CODE_ERROR_CODES.INVALID_CHARACTER,
      normalizedLength,
    );
  }

  return freezeResult({
    valid: true,
    normalizedCode,
    normalizedLength,
    errorCode: null,
  });
};

export const validateRecoveryCodeFormat = (input) => {
  const result = normalizeRecoveryCodeInput(input);
  return freezeResult({
    valid: result.valid,
    normalizedLength: result.normalizedLength,
    errorCode: result.errorCode,
  });
};

export const formatRecoveryCode = (normalizedCode) => {
  if (
    typeof normalizedCode !== 'string'
    || !NORMALIZED_PATTERN.test(normalizedCode)
  ) {
    throw new RecoveryCodeContractError(
      RECOVERY_CODE_ERROR_CODES.INVALID_NORMALIZED_FORMAT,
    );
  }

  const groups = [];
  for (let offset = 0; offset < normalizedCode.length; offset += RECOVERY_CODE_GROUP_SIZE) {
    groups.push(normalizedCode.slice(offset, offset + RECOVERY_CODE_GROUP_SIZE));
  }
  return groups.join('-');
};

/**
 * Returns the optional support-display hint. The caller must separately prove
 * that its context is approved; the hint is never sufficient for recovery.
 */
export const deriveRecoveryCodeHint = (input) => {
  const result = normalizeRecoveryCodeInput(input);
  if (!result.valid) {
    throw new RecoveryCodeContractError(result.errorCode);
  }
  return result.normalizedCode.slice(-4);
};

export const getSafeRecoveryCodeDiagnostics = (input) => {
  const result = normalizeRecoveryCodeInput(input);
  return freezeResult({
    version: RECOVERY_CODE_VERSION,
    valid: result.valid,
    normalizedLength: result.normalizedLength,
    errorCode: result.errorCode,
  });
};
