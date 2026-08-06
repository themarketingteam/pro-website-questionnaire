export const PRO_DRAFT_IDENTITY_VERSION = 1;
export const RECOVERY_EMAIL_NORMALIZATION_VERSION = 1;

export const DRAFT_IDENTITY_SOURCE_VALUES = Object.freeze([
  'signed_invitation',
  'client_entered',
  'recovered_by_email',
  'recovered_by_code',
  'admin_corrected',
  'migrated_legacy',
  'anonymous',
]);

export const DRAFT_IDENTITY_ASSOCIATION_INTENTS = Object.freeze([
  'new_invitation',
  'resume_current_draft',
  'recover_by_email',
  'recover_by_code',
  'changed_signed_email',
  'clear_all_replacement',
  'start_new_after_submission',
  'legacy_migration',
  'anonymous_start',
]);

export const EMAIL_VERIFICATION_STATUS_VALUES = Object.freeze([
  'unverified',
  'verified_signed_invitation',
  'verified_otp',
  'verified_magic_link',
]);

export const DRAFT_IDENTITY_ERROR_CODES = Object.freeze({
  ANONYMOUS_ACKNOWLEDGEMENT_REQUIRED: 'ANONYMOUS_ACKNOWLEDGEMENT_REQUIRED',
  DOMAIN_CONTROL_CHARACTER: 'DOMAIN_CONTROL_CHARACTER',
  DOMAIN_CREDENTIALS_NOT_ALLOWED: 'DOMAIN_CREDENTIALS_NOT_ALLOWED',
  DOMAIN_FRAGMENT_NOT_ALLOWED: 'DOMAIN_FRAGMENT_NOT_ALLOWED',
  DOMAIN_INVALID_HOSTNAME: 'DOMAIN_INVALID_HOSTNAME',
  DOMAIN_INVALID_PORT: 'DOMAIN_INVALID_PORT',
  DOMAIN_INVALID_TYPE: 'DOMAIN_INVALID_TYPE',
  DOMAIN_INVALID_URL: 'DOMAIN_INVALID_URL',
  DOMAIN_IP_NOT_ALLOWED: 'DOMAIN_IP_NOT_ALLOWED',
  DOMAIN_QUERY_NOT_ALLOWED: 'DOMAIN_QUERY_NOT_ALLOWED',
  DOMAIN_REQUIRED: 'DOMAIN_REQUIRED',
  DOMAIN_UNSUPPORTED_SCHEME: 'DOMAIN_UNSUPPORTED_SCHEME',
  EMAIL_CONTROL_CHARACTER: 'EMAIL_CONTROL_CHARACTER',
  EMAIL_DOMAIN_CONSECUTIVE_DOTS: 'EMAIL_DOMAIN_CONSECUTIVE_DOTS',
  EMAIL_DOMAIN_INVALID: 'EMAIL_DOMAIN_INVALID',
  EMAIL_DOMAIN_LABEL_HYPHEN: 'EMAIL_DOMAIN_LABEL_HYPHEN',
  EMAIL_DOMAIN_LABEL_TOO_LONG: 'EMAIL_DOMAIN_LABEL_TOO_LONG',
  EMAIL_DOMAIN_TOO_LONG: 'EMAIL_DOMAIN_TOO_LONG',
  EMAIL_EMBEDDED_WHITESPACE: 'EMAIL_EMBEDDED_WHITESPACE',
  EMAIL_INVALID_AT_COUNT: 'EMAIL_INVALID_AT_COUNT',
  EMAIL_INVALID_TYPE: 'EMAIL_INVALID_TYPE',
  EMAIL_LOCAL_PART_TOO_LONG: 'EMAIL_LOCAL_PART_TOO_LONG',
  EMAIL_MISSING_DOMAIN: 'EMAIL_MISSING_DOMAIN',
  EMAIL_MISSING_LOCAL_PART: 'EMAIL_MISSING_LOCAL_PART',
  EMAIL_REQUIRED: 'EMAIL_REQUIRED',
  EMAIL_TOO_LONG: 'EMAIL_TOO_LONG',
  IDENTITY_INCONSISTENT: 'IDENTITY_INCONSISTENT',
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_STRING: 'INVALID_STRING',
  SIGNED_INVITATION_EMAIL_INVALID: 'SIGNED_INVITATION_EMAIL_INVALID',
  UNSUPPORTED_ASSOCIATION_INTENT: 'UNSUPPORTED_ASSOCIATION_INTENT',
  UNSUPPORTED_EMAIL_SOURCE: 'UNSUPPORTED_EMAIL_SOURCE',
  UNSUPPORTED_VERIFICATION_STATUS: 'UNSUPPORTED_VERIFICATION_STATUS',
  VERIFIED_STATUS_REQUIRES_BACKEND: 'VERIFIED_STATUS_REQUIRES_BACKEND',
});

const SOURCE_SET = new Set(DRAFT_IDENTITY_SOURCE_VALUES);
const INTENT_SET = new Set(DRAFT_IDENTITY_ASSOCIATION_INTENTS);
const VERIFICATION_STATUS_SET = new Set(EMAIL_VERIFICATION_STATUS_VALUES);
const ASCII_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;
const EMBEDDED_WHITESPACE_PATTERN = /\s/u;
const DOMAIN_LABEL_PATTERN = /^[a-z\d-]+$/iu;
const FORBIDDEN_CONTEXT_FIELD_PATTERN = /(?:signed.?invitation.?token|recovery.?code|recovery.?session.?token|resume.?token|admin.?grant|base44.?token|access.?token|auth.?token|authorization|password|private.?key|client.?secret)/iu;

const CONTEXT_FIELDS = Object.freeze([
  'identityVersion',
  'formType',
  'invitationId',
  'userId',
  'userName',
  'businessName',
  'normalizedDomain',
  'displayDomain',
  'recoveryEmail',
  'normalizedRecoveryEmail',
  'recoveryEmailSource',
  'recoveryEmailVerificationStatus',
  'associationIntent',
  'signedInvitationEmail',
  'normalizedSignedInvitationEmail',
  'signedInvitationEmailChanged',
  'anonymousRecoveryAcknowledged',
]);

const CONTEXT_FIELD_SET = new Set(CONTEXT_FIELDS);

const isPlainObject = (value) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
);

const normalizeUnicode = (value) => {
  try {
    return typeof value.normalize === 'function' ? value.normalize('NFC') : value;
  } catch {
    return value;
  }
};

const firstDefined = (...values) => values.find((value) => value !== undefined);

const result = (values) => Object.freeze(values);

const invalidEmail = (errorCode, displayEmail = '') => result({
  valid: false,
  displayEmail,
  normalizedEmail: '',
  normalizationVersion: RECOVERY_EMAIL_NORMALIZATION_VERSION,
  errorCode,
});

const invalidDomain = (errorCode, displayDomain = '') => result({
  valid: false,
  displayDomain,
  normalizedDomain: '',
  hostname: '',
  errorCode,
});

export class DraftIdentityValidationError extends TypeError {
  constructor(code, path = '$') {
    super(`Draft identity validation failed (${code}) at ${path}`);
    this.name = 'DraftIdentityValidationError';
    this.code = code;
    this.path = path;
  }
}

const throwIdentityError = (code, path) => {
  throw new DraftIdentityValidationError(code, path);
};

const normalizeOptionalString = (
  input,
  path,
  { collapseWhitespace = false, emptyValue = null } = {},
) => {
  if (input === undefined || input === null || input === '') return emptyValue;
  if (typeof input !== 'string') {
    return throwIdentityError(DRAFT_IDENTITY_ERROR_CODES.INVALID_STRING, path);
  }
  if (ASCII_CONTROL_PATTERN.test(input)) {
    return throwIdentityError(DRAFT_IDENTITY_ERROR_CODES.INVALID_STRING, path);
  }
  let value = normalizeUnicode(input).trim();
  if (!value) return emptyValue;
  if (collapseWhitespace) value = value.replace(/\s+/gu, ' ');
  return value;
};

export const normalizeQuestionnaireUserId = (input) => normalizeOptionalString(
  input,
  '$.userId',
);

export const normalizeQuestionnaireUserName = (input) => normalizeOptionalString(
  input,
  '$.userName',
  { collapseWhitespace: true },
);

export const normalizeQuestionnaireBusinessName = (input) => normalizeOptionalString(
  input,
  '$.businessName',
  { collapseWhitespace: true },
);

export const normalizeInvitationId = (input) => normalizeOptionalString(
  input,
  '$.invitationId',
);

const validateHostnameLabels = (hostname, codePrefix = 'DOMAIN') => {
  const labels = hostname.split('.');
  if (labels.some((label) => label.length === 0)) {
    return codePrefix === 'EMAIL'
      ? DRAFT_IDENTITY_ERROR_CODES.EMAIL_DOMAIN_INVALID
      : DRAFT_IDENTITY_ERROR_CODES.DOMAIN_INVALID_HOSTNAME;
  }
  for (const label of labels) {
    if (label.length > 63) {
      return codePrefix === 'EMAIL'
        ? DRAFT_IDENTITY_ERROR_CODES.EMAIL_DOMAIN_LABEL_TOO_LONG
        : DRAFT_IDENTITY_ERROR_CODES.DOMAIN_INVALID_HOSTNAME;
    }
    if (label.startsWith('-') || label.endsWith('-')) {
      return codePrefix === 'EMAIL'
        ? DRAFT_IDENTITY_ERROR_CODES.EMAIL_DOMAIN_LABEL_HYPHEN
        : DRAFT_IDENTITY_ERROR_CODES.DOMAIN_INVALID_HOSTNAME;
    }
    if (!DOMAIN_LABEL_PATTERN.test(label)) {
      return codePrefix === 'EMAIL'
        ? DRAFT_IDENTITY_ERROR_CODES.EMAIL_DOMAIN_INVALID
        : DRAFT_IDENTITY_ERROR_CODES.DOMAIN_INVALID_HOSTNAME;
    }
  }
  return null;
};

const toAsciiEmailDomain = (domain) => {
  try {
    const parsed = new URL(`https://${domain}`);
    if (
      parsed.username
      || parsed.password
      || parsed.port
      || parsed.search
      || parsed.hash
      || parsed.pathname !== '/'
    ) {
      return null;
    }
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
};

/**
 * Deterministically normalizes an email for association and later lookup.
 * The result does not prove ownership and must not be used as authorization.
 */
export const normalizeRecoveryEmail = (input, { allowEmpty = false } = {}) => {
  if (typeof input !== 'string') {
    return invalidEmail(DRAFT_IDENTITY_ERROR_CODES.EMAIL_INVALID_TYPE);
  }
  if (ASCII_CONTROL_PATTERN.test(input)) {
    return invalidEmail(DRAFT_IDENTITY_ERROR_CODES.EMAIL_CONTROL_CHARACTER);
  }

  const displayEmail = normalizeUnicode(input).trim();
  if (!displayEmail) {
    return allowEmpty
      ? result({
        valid: true,
        displayEmail: '',
        normalizedEmail: '',
        normalizationVersion: RECOVERY_EMAIL_NORMALIZATION_VERSION,
        errorCode: null,
      })
      : invalidEmail(DRAFT_IDENTITY_ERROR_CODES.EMAIL_REQUIRED);
  }
  if (EMBEDDED_WHITESPACE_PATTERN.test(displayEmail)) {
    return invalidEmail(
      DRAFT_IDENTITY_ERROR_CODES.EMAIL_EMBEDDED_WHITESPACE,
      displayEmail,
    );
  }
  if (displayEmail.length > 254) {
    return invalidEmail(DRAFT_IDENTITY_ERROR_CODES.EMAIL_TOO_LONG, displayEmail);
  }

  const atCount = [...displayEmail].filter((character) => character === '@').length;
  if (atCount !== 1) {
    return invalidEmail(DRAFT_IDENTITY_ERROR_CODES.EMAIL_INVALID_AT_COUNT, displayEmail);
  }
  const separatorIndex = displayEmail.indexOf('@');
  const localPart = displayEmail.slice(0, separatorIndex);
  const displayDomain = displayEmail.slice(separatorIndex + 1);
  if (!localPart) {
    return invalidEmail(DRAFT_IDENTITY_ERROR_CODES.EMAIL_MISSING_LOCAL_PART, displayEmail);
  }
  if (!displayDomain) {
    return invalidEmail(DRAFT_IDENTITY_ERROR_CODES.EMAIL_MISSING_DOMAIN, displayEmail);
  }
  if (localPart.length > 64) {
    return invalidEmail(DRAFT_IDENTITY_ERROR_CODES.EMAIL_LOCAL_PART_TOO_LONG, displayEmail);
  }
  if (displayDomain.length > 253) {
    return invalidEmail(DRAFT_IDENTITY_ERROR_CODES.EMAIL_DOMAIN_TOO_LONG, displayEmail);
  }
  if (displayDomain.includes('..')) {
    return invalidEmail(
      DRAFT_IDENTITY_ERROR_CODES.EMAIL_DOMAIN_CONSECUTIVE_DOTS,
      displayEmail,
    );
  }

  const asciiDomain = toAsciiEmailDomain(displayDomain);
  if (!asciiDomain) {
    return invalidEmail(DRAFT_IDENTITY_ERROR_CODES.EMAIL_DOMAIN_INVALID, displayEmail);
  }
  if (asciiDomain.length > 253) {
    return invalidEmail(DRAFT_IDENTITY_ERROR_CODES.EMAIL_DOMAIN_TOO_LONG, displayEmail);
  }
  const hostnameError = validateHostnameLabels(asciiDomain, 'EMAIL');
  if (hostnameError) return invalidEmail(hostnameError, displayEmail);

  const normalizedEmail = `${localPart.toLowerCase()}@${asciiDomain}`;
  if (normalizedEmail.length > 254) {
    return invalidEmail(DRAFT_IDENTITY_ERROR_CODES.EMAIL_TOO_LONG, displayEmail);
  }
  return result({
    valid: true,
    displayEmail,
    normalizedEmail,
    normalizationVersion: RECOVERY_EMAIL_NORMALIZATION_VERSION,
    errorCode: null,
  });
};

const authorityFromUrlInput = (value) => value
  .replace(/^[a-z][a-z\d+.-]*:\/\//iu, '')
  .split(/[/?#]/u, 1)[0];

const hasExplicitInvalidPort = (value) => {
  const authority = authorityFromUrlInput(value).replace(/^.*@/u, '');
  if (authority.startsWith('[')) {
    const closingBracket = authority.indexOf(']');
    if (closingBracket < 0) return false;
    const remainder = authority.slice(closingBracket + 1);
    if (!remainder.startsWith(':')) return false;
    const port = remainder.slice(1);
    return !/^\d+$/u.test(port) || Number(port) > 65535;
  }
  const colonIndex = authority.lastIndexOf(':');
  if (colonIndex < 0) return false;
  const port = authority.slice(colonIndex + 1);
  return !/^\d+$/u.test(port) || Number(port) > 65535;
};

const isIpHostname = (hostname) => {
  if (hostname.includes(':') || hostname.startsWith('[')) return true;
  const parts = hostname.split('.');
  return parts.length === 4
    && parts.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255);
};

export const normalizeBusinessDomain = (input, { allowEmpty = false } = {}) => {
  if (typeof input !== 'string') {
    return invalidDomain(DRAFT_IDENTITY_ERROR_CODES.DOMAIN_INVALID_TYPE);
  }
  if (ASCII_CONTROL_PATTERN.test(input)) {
    return invalidDomain(DRAFT_IDENTITY_ERROR_CODES.DOMAIN_CONTROL_CHARACTER);
  }
  const displayDomain = normalizeUnicode(input).trim();
  if (!displayDomain) {
    return allowEmpty
      ? result({
        valid: true,
        displayDomain: '',
        normalizedDomain: '',
        hostname: '',
        errorCode: null,
      })
      : invalidDomain(DRAFT_IDENTITY_ERROR_CODES.DOMAIN_REQUIRED);
  }
  if (displayDomain.includes('?')) {
    return invalidDomain(DRAFT_IDENTITY_ERROR_CODES.DOMAIN_QUERY_NOT_ALLOWED, displayDomain);
  }
  if (displayDomain.includes('#')) {
    return invalidDomain(DRAFT_IDENTITY_ERROR_CODES.DOMAIN_FRAGMENT_NOT_ALLOWED, displayDomain);
  }
  if (hasExplicitInvalidPort(displayDomain)) {
    return invalidDomain(DRAFT_IDENTITY_ERROR_CODES.DOMAIN_INVALID_PORT, displayDomain);
  }

  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//iu.test(displayDomain);
  let parsed;
  try {
    parsed = new URL(hasScheme ? displayDomain : `https://${displayDomain}`);
  } catch {
    return invalidDomain(DRAFT_IDENTITY_ERROR_CODES.DOMAIN_INVALID_URL, displayDomain);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return invalidDomain(DRAFT_IDENTITY_ERROR_CODES.DOMAIN_UNSUPPORTED_SCHEME, displayDomain);
  }
  if (parsed.username || parsed.password) {
    return invalidDomain(
      DRAFT_IDENTITY_ERROR_CODES.DOMAIN_CREDENTIALS_NOT_ALLOWED,
      displayDomain,
    );
  }
  if (!parsed.hostname) {
    return invalidDomain(DRAFT_IDENTITY_ERROR_CODES.DOMAIN_INVALID_HOSTNAME, displayDomain);
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, '');
  if (isIpHostname(hostname)) {
    return invalidDomain(DRAFT_IDENTITY_ERROR_CODES.DOMAIN_IP_NOT_ALLOWED, displayDomain);
  }
  const hostnameError = validateHostnameLabels(hostname);
  if (hostnameError) return invalidDomain(hostnameError, displayDomain);
  const normalizedDomain = hostname.replace(/^www\./u, '');
  return result({
    valid: true,
    displayDomain,
    normalizedDomain,
    hostname,
    errorCode: null,
  });
};

const parseSignedEmailArguments = (signedEmailOrInput, replacementEmail) => {
  if (isPlainObject(signedEmailOrInput)) {
    return {
      signedEmail: firstDefined(
        signedEmailOrInput.signedInvitationEmail,
        signedEmailOrInput.signedEmail,
      ),
      replacementEmail: firstDefined(
        signedEmailOrInput.recoveryEmail,
        signedEmailOrInput.clientEnteredEmail,
        signedEmailOrInput.replacementEmail,
      ),
    };
  }
  return { signedEmail: signedEmailOrInput, replacementEmail };
};

export const isSignedInvitationEmailChanged = (signedEmailOrInput, replacementEmail) => {
  const inputs = parseSignedEmailArguments(signedEmailOrInput, replacementEmail);
  if (inputs.signedEmail === undefined || inputs.signedEmail === null || inputs.signedEmail === '') {
    return false;
  }
  const signed = normalizeRecoveryEmail(inputs.signedEmail);
  if (!signed.valid) {
    return result({
      valid: false,
      changed: null,
      errorCode: DRAFT_IDENTITY_ERROR_CODES.SIGNED_INVITATION_EMAIL_INVALID,
    });
  }
  const replacement = normalizeRecoveryEmail(inputs.replacementEmail);
  if (!replacement.valid) {
    return result({ valid: false, changed: null, errorCode: replacement.errorCode });
  }
  return signed.normalizedEmail !== replacement.normalizedEmail;
};

const assertNoForbiddenContextFields = (input) => {
  for (const key of Object.keys(input)) {
    if (FORBIDDEN_CONTEXT_FIELD_PATTERN.test(key)) {
      throwIdentityError(DRAFT_IDENTITY_ERROR_CODES.INVALID_INPUT, `$.${key}`);
    }
  }
};

const inferSource = (input) => {
  if (input.recoveryEmailSource !== undefined) return input.recoveryEmailSource;
  if (input.emailSource !== undefined) return input.emailSource;
  if (firstDefined(input.recoveryEmail, input.clientEnteredEmail, input.userEmail) !== undefined) {
    return 'client_entered';
  }
  if (input.signedInvitationEmail !== undefined) return 'signed_invitation';
  return 'anonymous';
};

const recoveryEmailInputForSource = (input, source, credentials) => {
  if (input.recoveryEmail !== undefined) return input.recoveryEmail ?? '';
  if (source === 'signed_invitation') return input.signedInvitationEmail ?? '';
  if (source === 'client_entered') {
    return firstDefined(
      input.clientEnteredEmail,
      input.questionnaireUserEmail,
      input.userEmail,
      credentials.userEmail,
      '',
    );
  }
  if (source === 'recovered_by_email') {
    return firstDefined(input.emailUsedForRecovery, input.userEmail, credentials.userEmail, '');
  }
  return firstDefined(input.questionnaireUserEmail, input.userEmail, credentials.userEmail, '');
};

const normalizeVerifiedStatus = (status, source, signedEmailChanged, options) => {
  if (!VERIFICATION_STATUS_SET.has(status)) {
    throwIdentityError(
      DRAFT_IDENTITY_ERROR_CODES.UNSUPPORTED_VERIFICATION_STATUS,
      '$.recoveryEmailVerificationStatus',
    );
  }
  if (
    source === 'client_entered'
    || source === 'recovered_by_email'
    || source === 'anonymous'
    || signedEmailChanged
  ) {
    return 'unverified';
  }
  if (status !== 'unverified' && options.trustedBackendResult !== true) {
    throwIdentityError(
      DRAFT_IDENTITY_ERROR_CODES.VERIFIED_STATUS_REQUIRES_BACKEND,
      '$.recoveryEmailVerificationStatus',
    );
  }
  if (status === 'verified_signed_invitation' && source !== 'signed_invitation') {
    throwIdentityError(
      DRAFT_IDENTITY_ERROR_CODES.IDENTITY_INCONSISTENT,
      '$.recoveryEmailVerificationStatus',
    );
  }
  return status;
};

export const createDraftIdentityContext = (input = {}, options = {}) => {
  if (!isPlainObject(input) || !isPlainObject(options)) {
    throwIdentityError(DRAFT_IDENTITY_ERROR_CODES.INVALID_INPUT, '$');
  }
  assertNoForbiddenContextFields(input);
  const credentials = isPlainObject(input.credentials) ? input.credentials : {};
  let recoveryEmailSource = inferSource(input);
  if (!SOURCE_SET.has(recoveryEmailSource)) {
    throwIdentityError(
      DRAFT_IDENTITY_ERROR_CODES.UNSUPPORTED_EMAIL_SOURCE,
      '$.recoveryEmailSource',
    );
  }

  const recoveryEmailResult = normalizeRecoveryEmail(
    recoveryEmailInputForSource(input, recoveryEmailSource, credentials),
    { allowEmpty: true },
  );
  if (!recoveryEmailResult.valid) {
    throwIdentityError(recoveryEmailResult.errorCode, '$.recoveryEmail');
  }
  const signedEmailResult = normalizeRecoveryEmail(input.signedInvitationEmail ?? '', {
    allowEmpty: true,
  });
  if (!signedEmailResult.valid) {
    throwIdentityError(
      DRAFT_IDENTITY_ERROR_CODES.SIGNED_INVITATION_EMAIL_INVALID,
      '$.signedInvitationEmail',
    );
  }
  const changeResult = signedEmailResult.normalizedEmail && recoveryEmailResult.normalizedEmail
    ? isSignedInvitationEmailChanged(
      signedEmailResult.displayEmail,
      recoveryEmailResult.displayEmail,
    )
    : false;
  if (isPlainObject(changeResult) && changeResult.valid === false) {
    throwIdentityError(changeResult.errorCode, '$.recoveryEmail');
  }
  const signedInvitationEmailChanged = changeResult === true;
  if (signedInvitationEmailChanged) recoveryEmailSource = 'client_entered';

  let associationIntent = firstDefined(
    input.associationIntent,
    recoveryEmailSource === 'anonymous' ? 'anonymous_start' : 'new_invitation',
  );
  if (signedInvitationEmailChanged) associationIntent = 'changed_signed_email';
  if (!INTENT_SET.has(associationIntent)) {
    throwIdentityError(
      DRAFT_IDENTITY_ERROR_CODES.UNSUPPORTED_ASSOCIATION_INTENT,
      '$.associationIntent',
    );
  }
  if (associationIntent === 'changed_signed_email' && !signedInvitationEmailChanged) {
    throwIdentityError(
      DRAFT_IDENTITY_ERROR_CODES.IDENTITY_INCONSISTENT,
      '$.associationIntent',
    );
  }

  const anonymousRecoveryAcknowledged = input.anonymousRecoveryAcknowledged === true;
  if (
    associationIntent === 'anonymous_start'
    && recoveryEmailResult.normalizedEmail === ''
    && !anonymousRecoveryAcknowledged
  ) {
    throwIdentityError(
      DRAFT_IDENTITY_ERROR_CODES.ANONYMOUS_ACKNOWLEDGEMENT_REQUIRED,
      '$.anonymousRecoveryAcknowledged',
    );
  }
  if (recoveryEmailSource === 'anonymous' && recoveryEmailResult.normalizedEmail !== '') {
    throwIdentityError(
      DRAFT_IDENTITY_ERROR_CODES.IDENTITY_INCONSISTENT,
      '$.recoveryEmailSource',
    );
  }

  const requestedVerificationStatus = firstDefined(
    input.recoveryEmailVerificationStatus,
    input.verificationStatus,
    'unverified',
  );
  const recoveryEmailVerificationStatus = normalizeVerifiedStatus(
    requestedVerificationStatus,
    recoveryEmailSource,
    signedInvitationEmailChanged,
    options,
  );
  const domainResult = normalizeBusinessDomain(
    firstDefined(
      input.domain,
      input.domainName,
      input.displayDomain,
      input.normalizedDomain,
      credentials.domain,
      '',
    ),
    { allowEmpty: true },
  );
  if (!domainResult.valid) {
    throwIdentityError(domainResult.errorCode, '$.domain');
  }

  const formType = normalizeOptionalString(
    input.formType ?? 'pro-questionnaire',
    '$.formType',
  );
  if (!formType) throwIdentityError(DRAFT_IDENTITY_ERROR_CODES.INVALID_STRING, '$.formType');

  return {
    identityVersion: PRO_DRAFT_IDENTITY_VERSION,
    formType,
    invitationId: normalizeInvitationId(firstDefined(input.invitationId, input.signedInvitationId)),
    userId: normalizeQuestionnaireUserId(firstDefined(input.userId, credentials.userId)),
    userName: normalizeQuestionnaireUserName(firstDefined(input.userName, credentials.userName)),
    businessName: normalizeQuestionnaireBusinessName(firstDefined(
      input.businessName,
      credentials.businessName,
    )),
    normalizedDomain: domainResult.normalizedDomain || null,
    displayDomain: domainResult.displayDomain || null,
    recoveryEmail: recoveryEmailResult.displayEmail || null,
    normalizedRecoveryEmail: recoveryEmailResult.normalizedEmail || null,
    recoveryEmailSource,
    recoveryEmailVerificationStatus,
    associationIntent,
    signedInvitationEmail: signedEmailResult.displayEmail || null,
    normalizedSignedInvitationEmail: signedEmailResult.normalizedEmail || null,
    signedInvitationEmailChanged,
    anonymousRecoveryAcknowledged,
  };
};

export const getSafeDraftIdentityDiagnostics = (input = {}, explicitErrorCode = null) => {
  const wrapped = isPlainObject(input) && isPlainObject(input.context);
  const context = wrapped ? input.context : input;
  const errorCode = explicitErrorCode || (wrapped ? input.errorCode : null) || null;
  return Object.freeze({
    identityVersion: Number.isSafeInteger(context?.identityVersion)
      ? context.identityVersion
      : PRO_DRAFT_IDENTITY_VERSION,
    formType: typeof context?.formType === 'string' ? context.formType : 'unknown',
    hasInvitationId: Boolean(context?.invitationId),
    hasUserId: Boolean(context?.userId),
    hasRecoveryEmail: Boolean(context?.normalizedRecoveryEmail || context?.recoveryEmail),
    recoveryEmailSource: SOURCE_SET.has(context?.recoveryEmailSource)
      ? context.recoveryEmailSource
      : null,
    recoveryEmailVerificationStatus: VERIFICATION_STATUS_SET.has(
      context?.recoveryEmailVerificationStatus,
    ) ? context.recoveryEmailVerificationStatus : null,
    associationIntent: INTENT_SET.has(context?.associationIntent)
      ? context.associationIntent
      : null,
    signedInvitationEmailChanged: context?.signedInvitationEmailChanged === true,
    anonymousRecoveryAcknowledged: context?.anonymousRecoveryAcknowledged === true,
    errorCode,
  });
};

export const validateDraftIdentityContext = (input, options = {}) => {
  let context = null;
  let errorCode = null;
  try {
    if (!isPlainObject(input)) {
      throwIdentityError(DRAFT_IDENTITY_ERROR_CODES.INVALID_INPUT, '$');
    }
    for (const field of CONTEXT_FIELDS) {
      if (!Object.hasOwn(input, field)) {
        throwIdentityError(DRAFT_IDENTITY_ERROR_CODES.INVALID_INPUT, `$.${field}`);
      }
    }
    for (const field of Object.keys(input)) {
      if (!CONTEXT_FIELD_SET.has(field)) {
        throwIdentityError(DRAFT_IDENTITY_ERROR_CODES.INVALID_INPUT, `$.${field}`);
      }
    }
    if (input.identityVersion !== PRO_DRAFT_IDENTITY_VERSION) {
      throwIdentityError(DRAFT_IDENTITY_ERROR_CODES.INVALID_INPUT, '$.identityVersion');
    }
    context = createDraftIdentityContext(input, options);
  } catch (error) {
    errorCode = error?.code || DRAFT_IDENTITY_ERROR_CODES.INVALID_INPUT;
  }
  return {
    valid: context !== null,
    context,
    errorCode,
    safeDiagnostics: getSafeDraftIdentityDiagnostics(context || input, errorCode),
  };
};

export const compareDraftIdentityContexts = (left, right) => {
  const first = createDraftIdentityContext(left, { trustedBackendResult: true });
  const second = createDraftIdentityContext(right, { trustedBackendResult: true });
  const matches = Object.fromEntries(CONTEXT_FIELDS.map((field) => [
    field,
    first[field] === second[field],
  ]));
  return Object.freeze({
    equivalent: Object.values(matches).every(Boolean),
    sameInvitation: matches.invitationId,
    sameUser: matches.userId,
    sameBusiness: matches.businessName && matches.normalizedDomain,
    sameRecoveryEmail: matches.normalizedRecoveryEmail,
    sameAssociation: matches.recoveryEmailSource
      && matches.recoveryEmailVerificationStatus
      && matches.associationIntent,
    signedInvitationEmailChanged: second.signedInvitationEmailChanged,
  });
};

export const shouldCreateNewDraftAssociation = (identityOrIntent, options = {}) => {
  const associationIntent = typeof identityOrIntent === 'string'
    ? identityOrIntent
    : identityOrIntent?.associationIntent;
  if (!INTENT_SET.has(associationIntent)) {
    throwIdentityError(
      DRAFT_IDENTITY_ERROR_CODES.UNSUPPORTED_ASSOCIATION_INTENT,
      '$.associationIntent',
    );
  }
  if (
    associationIntent === 'changed_signed_email'
    || associationIntent === 'clear_all_replacement'
    || associationIntent === 'start_new_after_submission'
    || associationIntent === 'anonymous_start'
  ) {
    return true;
  }
  if (associationIntent === 'new_invitation') {
    const currentAuthorizedDraftExists = isPlainObject(identityOrIntent)
      ? identityOrIntent.currentAuthorizedDraftExists === true
      : options.currentAuthorizedDraftExists === true;
    return !currentAuthorizedDraftExists;
  }
  return false;
};
