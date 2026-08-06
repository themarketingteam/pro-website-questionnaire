/**
 * Runtime-neutral durable-draft recovery code and email-selection contract.
 *
 * This module performs no I/O, authorization, hashing, logging, random-number
 * generation, Base44 calls, or entity mutation. Callers must authorize an
 * association before using a selected draft.
 */

export const RECOVERY_CODE_VERSION = 1;
export const RECOVERY_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const RECOVERY_CODE_LENGTH = 20;
export const RECOVERY_CODE_GROUP_SIZE = 4;
export const RECOVERY_CODE_GROUP_COUNT = 5;
export const RECOVERY_CODE_ENTROPY_BITS = RECOVERY_CODE_LENGTH
  * Math.log2(RECOVERY_CODE_ALPHABET.length);
export const RECOVERY_EMAIL_NORMALIZATION_VERSION = 1;

export const RECOVERY_EMAIL_ERROR_CODES = Object.freeze({
  CONTROL_CHARACTER: 'RECOVERY_EMAIL_CONTROL_CHARACTER',
  DOMAIN_CONSECUTIVE_DOTS: 'RECOVERY_EMAIL_DOMAIN_CONSECUTIVE_DOTS',
  DOMAIN_INVALID: 'RECOVERY_EMAIL_DOMAIN_INVALID',
  DOMAIN_LABEL_HYPHEN: 'RECOVERY_EMAIL_DOMAIN_LABEL_HYPHEN',
  DOMAIN_LABEL_TOO_LONG: 'RECOVERY_EMAIL_DOMAIN_LABEL_TOO_LONG',
  DOMAIN_TOO_LONG: 'RECOVERY_EMAIL_DOMAIN_TOO_LONG',
  EMBEDDED_WHITESPACE: 'RECOVERY_EMAIL_EMBEDDED_WHITESPACE',
  INVALID_AT_COUNT: 'RECOVERY_EMAIL_INVALID_AT_COUNT',
  INVALID_TYPE: 'RECOVERY_EMAIL_INVALID_TYPE',
  LOCAL_PART_TOO_LONG: 'RECOVERY_EMAIL_LOCAL_PART_TOO_LONG',
  MISSING_DOMAIN: 'RECOVERY_EMAIL_MISSING_DOMAIN',
  MISSING_LOCAL_PART: 'RECOVERY_EMAIL_MISSING_LOCAL_PART',
  REQUIRED: 'RECOVERY_EMAIL_REQUIRED',
  TOO_LONG: 'RECOVERY_EMAIL_TOO_LONG',
} as const);

export type RecoveryEmailErrorCode = typeof RECOVERY_EMAIL_ERROR_CODES[
  keyof typeof RECOVERY_EMAIL_ERROR_CODES
];

export type RecoveryEmailNormalizationResult = Readonly<{
  valid: boolean;
  displayEmail: string;
  normalizedEmail: string;
  normalizationVersion: 1;
  errorCode: RecoveryEmailErrorCode | null;
}>;

export const RECOVERY_CODE_ERROR_CODES = Object.freeze({
  INVALID_TYPE: 'RECOVERY_CODE_INVALID_TYPE',
  TOO_SHORT: 'RECOVERY_CODE_TOO_SHORT',
  TOO_LONG: 'RECOVERY_CODE_TOO_LONG',
  INVALID_CHARACTER: 'RECOVERY_CODE_INVALID_CHARACTER',
  INVALID_NORMALIZED_FORMAT: 'RECOVERY_CODE_INVALID_NORMALIZED_FORMAT',
  INVALID_RANDOM_VALUES: 'RECOVERY_CODE_INVALID_RANDOM_VALUES',
  INSUFFICIENT_ENTROPY: 'RECOVERY_CODE_INSUFFICIENT_ENTROPY',
} as const);

export type RecoveryCodeErrorCode = typeof RECOVERY_CODE_ERROR_CODES[
  keyof typeof RECOVERY_CODE_ERROR_CODES
];

export type RecoveryCodeNormalizationResult = Readonly<{
  valid: boolean;
  normalizedCode: string;
  normalizedLength: number;
  errorCode: RecoveryCodeErrorCode | null;
}>;

export type SafeRecoveryCodeDiagnostics = Readonly<{
  version: number;
  valid: boolean;
  normalizedLength: number;
  errorCode: RecoveryCodeErrorCode | null;
}>;

const ALPHABET_PATTERN = new RegExp(`^[${RECOVERY_CODE_ALPHABET}]+$`);
const NORMALIZED_PATTERN = new RegExp(
  `^[${RECOVERY_CODE_ALPHABET}]{${RECOVERY_CODE_LENGTH}}$`,
);
const REJECTION_SAMPLING_LIMIT = Math.floor(256 / RECOVERY_CODE_ALPHABET.length)
  * RECOVERY_CODE_ALPHABET.length;
const ASCII_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;
const EMBEDDED_WHITESPACE_PATTERN = /\s/u;
const DOMAIN_LABEL_PATTERN = /^[a-z\d-]+$/iu;

const invalidCodeResult = (
  errorCode: RecoveryCodeErrorCode,
  normalizedLength = 0,
): RecoveryCodeNormalizationResult => Object.freeze({
  valid: false,
  normalizedCode: '',
  normalizedLength,
  errorCode,
});

export class RecoveryCodeContractError extends TypeError {
  readonly code: RecoveryCodeErrorCode;

  constructor(code: RecoveryCodeErrorCode) {
    super(`Recovery-code contract violation: ${code}`);
    this.name = 'RecoveryCodeContractError';
    this.code = code;
  }
}

export function normalizeRecoveryCodeInput(
  input: unknown,
): RecoveryCodeNormalizationResult {
  if (typeof input !== 'string') {
    return invalidCodeResult(RECOVERY_CODE_ERROR_CODES.INVALID_TYPE);
  }

  const normalizedCode = input.replace(/[ -]/gu, '').toUpperCase();
  const normalizedLength = normalizedCode.length;

  if (normalizedLength < RECOVERY_CODE_LENGTH) {
    return invalidCodeResult(
      RECOVERY_CODE_ERROR_CODES.TOO_SHORT,
      normalizedLength,
    );
  }
  if (normalizedLength > RECOVERY_CODE_LENGTH) {
    return invalidCodeResult(
      RECOVERY_CODE_ERROR_CODES.TOO_LONG,
      normalizedLength,
    );
  }
  if (!ALPHABET_PATTERN.test(normalizedCode)) {
    return invalidCodeResult(
      RECOVERY_CODE_ERROR_CODES.INVALID_CHARACTER,
      normalizedLength,
    );
  }

  return Object.freeze({
    valid: true,
    normalizedCode,
    normalizedLength,
    errorCode: null,
  });
}

export function validateRecoveryCodeFormat(
  input: unknown,
): Readonly<{
  valid: boolean;
  normalizedLength: number;
  errorCode: RecoveryCodeErrorCode | null;
}> {
  const result = normalizeRecoveryCodeInput(input);
  return Object.freeze({
    valid: result.valid,
    normalizedLength: result.normalizedLength,
    errorCode: result.errorCode,
  });
}

function invalidEmail(
  errorCode: RecoveryEmailErrorCode,
  displayEmail = '',
): RecoveryEmailNormalizationResult {
  return Object.freeze({
    valid: false,
    displayEmail,
    normalizedEmail: '',
    normalizationVersion: RECOVERY_EMAIL_NORMALIZATION_VERSION,
    errorCode,
  });
}

function normalizedUnicode(value: string): string {
  try {
    return value.normalize('NFC');
  } catch {
    return value;
  }
}

function asciiEmailDomain(domain: string): string | null {
  try {
    const parsed = new URL(`https://${domain}`);
    if (parsed.username || parsed.password || parsed.port || parsed.search
      || parsed.hash || parsed.pathname !== '/') return null;
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Normalizes an email association. This deliberately does not verify ownership. */
export function normalizeRecoveryEmail(
  input: unknown,
): RecoveryEmailNormalizationResult {
  if (typeof input !== 'string') {
    return invalidEmail(RECOVERY_EMAIL_ERROR_CODES.INVALID_TYPE);
  }
  if (ASCII_CONTROL_PATTERN.test(input)) {
    return invalidEmail(RECOVERY_EMAIL_ERROR_CODES.CONTROL_CHARACTER);
  }
  const displayEmail = normalizedUnicode(input).trim();
  if (displayEmail === '') return invalidEmail(RECOVERY_EMAIL_ERROR_CODES.REQUIRED);
  if (EMBEDDED_WHITESPACE_PATTERN.test(displayEmail)) {
    return invalidEmail(RECOVERY_EMAIL_ERROR_CODES.EMBEDDED_WHITESPACE, displayEmail);
  }
  if (displayEmail.length > 254) {
    return invalidEmail(RECOVERY_EMAIL_ERROR_CODES.TOO_LONG, displayEmail);
  }
  if ([...displayEmail].filter((character) => character === '@').length !== 1) {
    return invalidEmail(RECOVERY_EMAIL_ERROR_CODES.INVALID_AT_COUNT, displayEmail);
  }
  const separator = displayEmail.indexOf('@');
  const localPart = displayEmail.slice(0, separator);
  const displayDomain = displayEmail.slice(separator + 1);
  if (localPart === '') {
    return invalidEmail(RECOVERY_EMAIL_ERROR_CODES.MISSING_LOCAL_PART, displayEmail);
  }
  if (displayDomain === '') {
    return invalidEmail(RECOVERY_EMAIL_ERROR_CODES.MISSING_DOMAIN, displayEmail);
  }
  if (localPart.length > 64) {
    return invalidEmail(RECOVERY_EMAIL_ERROR_CODES.LOCAL_PART_TOO_LONG, displayEmail);
  }
  if (displayDomain.length > 253) {
    return invalidEmail(RECOVERY_EMAIL_ERROR_CODES.DOMAIN_TOO_LONG, displayEmail);
  }
  if (displayDomain.includes('..')) {
    return invalidEmail(RECOVERY_EMAIL_ERROR_CODES.DOMAIN_CONSECUTIVE_DOTS, displayEmail);
  }
  const domain = asciiEmailDomain(displayDomain);
  if (!domain) return invalidEmail(RECOVERY_EMAIL_ERROR_CODES.DOMAIN_INVALID, displayEmail);
  if (domain.length > 253) {
    return invalidEmail(RECOVERY_EMAIL_ERROR_CODES.DOMAIN_TOO_LONG, displayEmail);
  }
  for (const label of domain.split('.')) {
    if (label === '' || !DOMAIN_LABEL_PATTERN.test(label)) {
      return invalidEmail(RECOVERY_EMAIL_ERROR_CODES.DOMAIN_INVALID, displayEmail);
    }
    if (label.length > 63) {
      return invalidEmail(RECOVERY_EMAIL_ERROR_CODES.DOMAIN_LABEL_TOO_LONG, displayEmail);
    }
    if (label.startsWith('-') || label.endsWith('-')) {
      return invalidEmail(RECOVERY_EMAIL_ERROR_CODES.DOMAIN_LABEL_HYPHEN, displayEmail);
    }
  }
  const normalizedEmail = `${localPart.toLowerCase()}@${domain}`;
  if (normalizedEmail.length > 254) {
    return invalidEmail(RECOVERY_EMAIL_ERROR_CODES.TOO_LONG, displayEmail);
  }
  return Object.freeze({
    valid: true,
    displayEmail,
    normalizedEmail,
    normalizationVersion: RECOVERY_EMAIL_NORMALIZATION_VERSION,
    errorCode: null,
  });
}

export function formatRecoveryCode(normalizedCode: unknown): string {
  if (
    typeof normalizedCode !== 'string'
    || !NORMALIZED_PATTERN.test(normalizedCode)
  ) {
    throw new RecoveryCodeContractError(
      RECOVERY_CODE_ERROR_CODES.INVALID_NORMALIZED_FORMAT,
    );
  }

  const groups: string[] = [];
  for (let offset = 0; offset < normalizedCode.length; offset += RECOVERY_CODE_GROUP_SIZE) {
    groups.push(normalizedCode.slice(offset, offset + RECOVERY_CODE_GROUP_SIZE));
  }
  return groups.join('-');
}

/**
 * Encodes caller-supplied bytes without modulo bias. Bytes 248 through 255 are
 * rejected because 248 is the largest multiple of 31 below 256. A later
 * security primitive must supply cryptographically secure bytes and retry.
 */
export function encodeRecoveryCodeFromRandomValues(
  values: ArrayLike<number>,
): string {
  if (
    values === null
    || values === undefined
    || typeof values.length !== 'number'
    || !Number.isSafeInteger(values.length)
    || values.length < 0
  ) {
    throw new RecoveryCodeContractError(
      RECOVERY_CODE_ERROR_CODES.INVALID_RANDOM_VALUES,
    );
  }

  let encoded = '';
  for (let index = 0; index < values.length && encoded.length < RECOVERY_CODE_LENGTH; index += 1) {
    const value = values[index];
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new RecoveryCodeContractError(
        RECOVERY_CODE_ERROR_CODES.INVALID_RANDOM_VALUES,
      );
    }
    if (value >= REJECTION_SAMPLING_LIMIT) continue;
    encoded += RECOVERY_CODE_ALPHABET[value % RECOVERY_CODE_ALPHABET.length];
  }

  if (encoded.length !== RECOVERY_CODE_LENGTH) {
    throw new RecoveryCodeContractError(
      RECOVERY_CODE_ERROR_CODES.INSUFFICIENT_ENTROPY,
    );
  }

  return encoded;
}

export function getSafeRecoveryCodeDiagnostics(
  input: unknown,
): SafeRecoveryCodeDiagnostics {
  const result = normalizeRecoveryCodeInput(input);
  return Object.freeze({
    version: RECOVERY_CODE_VERSION,
    valid: result.valid,
    normalizedLength: result.normalizedLength,
    errorCode: result.errorCode,
  });
}

export const DRAFT_LIFECYCLE_STATUS_VALUES = Object.freeze([
  'active',
  'submit_attempted',
  'submit_failed',
  'submitted',
  'cleared_superseded',
  'expired',
  'deleted',
] as const);

export const EMAIL_RECOVERY_ELIGIBLE_STATUSES = Object.freeze([
  'active',
  'submit_attempted',
  'submit_failed',
  'submitted',
] as const);

export type DraftLifecycleStatus = typeof DRAFT_LIFECYCLE_STATUS_VALUES[number];
export type NormalizedDraftStatus = DraftLifecycleStatus | 'unknown';
export type DraftEnvironment = 'local' | 'test' | 'staging' | 'production';

export type DraftSelectionRecord = Readonly<{
  id?: unknown;
  _id?: unknown;
  draft_id?: unknown;
  status?: unknown;
  created_date?: unknown;
  created_at_server?: unknown;
  environment?: unknown;
  source_environment?: unknown;
  replacement_draft_id?: unknown;
  superseded_by_draft_id?: unknown;
  is_deleted?: unknown;
  deleted?: unknown;
  soft_deleted?: unknown;
  softDelete?: unknown;
  isDeleted?: unknown;
  retention_deletion_finalized?: unknown;
  retention_deleted?: unknown;
  deletion_finalized?: unknown;
  retentionDeletionFinalized?: unknown;
  retention_expires_at?: unknown;
  is_staging?: unknown;
  is_test?: unknown;
  test_record?: unknown;
  staging_record?: unknown;
  [key: string]: unknown;
}>;

export type DraftSelectionOptions = Readonly<{
  expectedEnvironment?: DraftEnvironment;
  now?: Date | number | string;
}>;

export type DraftSelectionWarning =
  | 'INVALID_CREATION_TIMESTAMP_EXCLUDED'
  | 'ALL_CREATION_TIMESTAMPS_INVALID_ID_FALLBACK';

export type SafeDraftSelectionDiagnostics = Readonly<{
  version: number;
  selected: boolean;
  eligibleCount: number;
  excludedCount: number;
  warnings: readonly DraftSelectionWarning[];
}>;

export type DraftSelectionResult<T extends DraftSelectionRecord> = Readonly<{
  selected: T | null;
  eligibleCount: number;
  excludedCount: number;
  diagnostics: SafeDraftSelectionDiagnostics;
}>;

const ELIGIBLE_STATUS_SET = new Set<NormalizedDraftStatus>(
  EMAIL_RECOVERY_ELIGIBLE_STATUSES,
);

const isRecord = (value: unknown): value is DraftSelectionRecord => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const hasValue = (value: unknown): boolean => (
  typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined
);

const readStableId = (record: DraftSelectionRecord): string | null => {
  for (const value of [record.id, record._id, record.draft_id]) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
};

const parseServerTimestamp = (value: unknown): number | null => {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
};

const hasAnyValidServerCreatedTimestamp = (
  record: DraftSelectionRecord,
): boolean => (
  parseServerTimestamp(record.created_date) !== null
  || parseServerTimestamp(record.created_at_server) !== null
);

const isValidLegacyDraftRecord = (record: DraftSelectionRecord): boolean => (
  readStableId(record) !== null && hasAnyValidServerCreatedTimestamp(record)
);

export function normalizeLegacyDraftStatus(
  value: unknown,
  { isValidLegacyDraft = false }: Readonly<{ isValidLegacyDraft?: boolean }> = {},
): NormalizedDraftStatus {
  if (typeof value !== 'string') {
    return isValidLegacyDraft && (value === null || value === undefined)
      ? 'active'
      : 'unknown';
  }

  const normalized = value.trim();
  if (normalized === '' && isValidLegacyDraft) return 'active';
  if (normalized === 'draft') return 'active';
  if (
    DRAFT_LIFECYCLE_STATUS_VALUES.includes(
      normalized as DraftLifecycleStatus,
    )
  ) {
    return normalized as DraftLifecycleStatus;
  }
  return 'unknown';
}

const hasTrueFlag = (record: DraftSelectionRecord, fields: readonly string[]): boolean => (
  fields.some((field) => record[field] === true)
);

const isEnvironmentEligible = (
  record: DraftSelectionRecord,
  expectedEnvironment?: DraftEnvironment,
): boolean => {
  if (!expectedEnvironment) return true;

  const declaredEnvironment = typeof record.environment === 'string'
    ? record.environment
    : record.source_environment;
  if (
    typeof declaredEnvironment === 'string'
    && declaredEnvironment.trim().length > 0
    && declaredEnvironment !== expectedEnvironment
  ) {
    return false;
  }

  if (expectedEnvironment === 'production') {
    return !hasTrueFlag(record, [
      'is_staging',
      'is_test',
      'test_record',
      'staging_record',
    ]);
  }
  return true;
};

export function isDraftEligibleForAutomaticEmailRecovery(
  value: unknown,
  options: DraftSelectionOptions = {},
): value is DraftSelectionRecord {
  if (!isRecord(value) || readStableId(value) === null) return false;

  const status = normalizeLegacyDraftStatus(value.status, {
    isValidLegacyDraft: isValidLegacyDraftRecord(value),
  });
  if (!ELIGIBLE_STATUS_SET.has(status)) return false;
  if (hasValue(value.superseded_by_draft_id)) return false;
  if (status === 'cleared_superseded' && hasValue(value.replacement_draft_id)) {
    return false;
  }
  if (hasTrueFlag(value, [
    'is_deleted',
    'deleted',
    'soft_deleted',
    'softDelete',
    'isDeleted',
  ])) return false;
  if (hasTrueFlag(value, [
    'retention_deletion_finalized',
    'retention_deleted',
    'deletion_finalized',
    'retentionDeletionFinalized',
  ])) return false;
  if (options.now !== undefined && typeof value.retention_expires_at === 'string') {
    const now = options.now instanceof Date ? options.now.getTime()
      : typeof options.now === 'number' ? options.now : Date.parse(options.now);
    const retentionExpiry = Date.parse(value.retention_expires_at);
    if (Number.isFinite(now) && Number.isFinite(retentionExpiry)
      && retentionExpiry <= now) return false;
  }

  return isEnvironmentEligible(value, options.expectedEnvironment);
}

type IndexedDraft<T extends DraftSelectionRecord> = Readonly<{
  record: T;
  index: number;
}>;

const compareIndexedDrafts = <T extends DraftSelectionRecord>(
  left: IndexedDraft<T>,
  right: IndexedDraft<T>,
): number => {
  const leftCreated = parseServerTimestamp(left.record.created_date);
  const rightCreated = parseServerTimestamp(right.record.created_date);
  if (leftCreated !== rightCreated) {
    return (rightCreated ?? Number.NEGATIVE_INFINITY)
      - (leftCreated ?? Number.NEGATIVE_INFINITY);
  }

  const leftServerCreated = parseServerTimestamp(left.record.created_at_server);
  const rightServerCreated = parseServerTimestamp(right.record.created_at_server);
  if (leftServerCreated !== rightServerCreated) {
    return (rightServerCreated ?? Number.NEGATIVE_INFINITY)
      - (leftServerCreated ?? Number.NEGATIVE_INFINITY);
  }

  const leftId = readStableId(left.record) ?? '';
  const rightId = readStableId(right.record) ?? '';
  if (leftId !== rightId) return leftId > rightId ? -1 : 1;
  return left.index - right.index;
};

export function sortDraftsForEmailRecovery<T extends DraftSelectionRecord>(
  records: readonly T[],
): T[] {
  return records
    .map((record, index) => Object.freeze({ record, index }))
    .sort(compareIndexedDrafts)
    .map(({ record }) => record);
}

export function getSafeDraftSelectionDiagnostics(
  input: Readonly<{
    selected: boolean;
    eligibleCount: number;
    excludedCount: number;
    warnings?: readonly DraftSelectionWarning[];
  }>,
): SafeDraftSelectionDiagnostics {
  return Object.freeze({
    version: RECOVERY_CODE_VERSION,
    selected: input.selected === true,
    eligibleCount: Number.isSafeInteger(input.eligibleCount)
      ? Math.max(0, input.eligibleCount)
      : 0,
    excludedCount: Number.isSafeInteger(input.excludedCount)
      ? Math.max(0, input.excludedCount)
      : 0,
    warnings: Object.freeze([...(input.warnings ?? [])]),
  });
}

/**
 * Selects by lifecycle/environment metadata only. Email matching and recovery
 * authorization belong to a future authenticated backend boundary.
 */
export function selectNewestEligibleDraft<T extends DraftSelectionRecord>(
  records: readonly T[],
  options: DraftSelectionOptions = {},
): DraftSelectionResult<T> {
  const safeRecords: readonly T[] = Array.isArray(records) ? records : [];
  const eligible: T[] = [];
  for (const record of safeRecords) {
    if (isDraftEligibleForAutomaticEmailRecovery(record, options)) {
      eligible.push(record);
    }
  }
  const withValidTimestamp = eligible.filter(hasAnyValidServerCreatedTimestamp);
  const warnings: DraftSelectionWarning[] = [];
  let candidates = eligible;

  if (withValidTimestamp.length > 0 && withValidTimestamp.length < eligible.length) {
    candidates = withValidTimestamp;
    warnings.push('INVALID_CREATION_TIMESTAMP_EXCLUDED');
  } else if (eligible.length > 0 && withValidTimestamp.length === 0) {
    warnings.push('ALL_CREATION_TIMESTAMPS_INVALID_ID_FALLBACK');
  }

  const selected = sortDraftsForEmailRecovery(candidates)[0] ?? null;
  const eligibleCount = candidates.length;
  const excludedCount = safeRecords.length - eligibleCount;
  const diagnostics = getSafeDraftSelectionDiagnostics({
    selected: selected !== null,
    eligibleCount,
    excludedCount,
    warnings,
  });

  return Object.freeze({
    selected,
    eligibleCount,
    excludedCount,
    diagnostics,
  });
}
