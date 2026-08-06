/** Explicit allowlist projections for authoritative draft responses. */

export const PRO_DRAFT_PROJECTION_VERSION = 1;

const SENSITIVE_DRAFT_FIELD_NAMES = Object.freeze([
  'recovery_email_lookup_hash',
  'recovery_code_hash',
  'resume_token_hash',
  'identity_key_hash',
  'bootstrap_idempotency_key_hash',
  'last_save_idempotency_key_hash',
  'last_event_batch_idempotency_key_hash',
  'source_app_id',
  'recovery_email',
  'ai_repair_error_json',
  'ai_repair_report_json',
  'ai_repaired_payload_json',
] as const);

const SENSITIVE_NAMES = new Set<string>(SENSITIVE_DRAFT_FIELD_NAMES);
const SENSITIVE_KEY_PATTERN = /(?:recovery.?code.?hash|resume.?token|recovery.?session.?token|signed.?invitation.?token|email.?lookup.?hash|identity.?key.?hash|idempotency.?key|source.?app.?id|authorization|access.?token|private.?key|client.?secret|password|raw.?token|admin.?grant)/iu;
const ACTIVE_STATUSES = new Set(['active', 'submit_attempted', 'submit_failed', 'draft', '']);
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;

export class ProDraftProjectionError extends Error {
  readonly code: string;

  constructor(code: string) {
    super('The draft record could not be projected safely.');
    this.name = 'ProDraftProjectionError';
    this.code = code;
  }
}

function projectionError(code: string): never {
  throw new ProDraftProjectionError(code);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) return projectionError('PROJECTION_RECORD_INVALID');
  return value;
}

function value(
  record: Record<string, unknown>,
  ...names: string[]
): unknown {
  for (const name of names) {
    if (Object.hasOwn(record, name)) return record[name];
  }
  return undefined;
}

function safeId(valueInput: unknown): string | null {
  return typeof valueInput === 'string' && ID_PATTERN.test(valueInput)
    ? valueInput
    : null;
}

function safeInteger(valueInput: unknown): number | null {
  return Number.isSafeInteger(valueInput) && Number(valueInput) >= 0
    ? Number(valueInput)
    : null;
}

function safeDate(valueInput: unknown): string | null {
  return typeof valueInput === 'string' && !Number.isNaN(Date.parse(valueInput))
    ? valueInput
    : null;
}

function redactRecoveryEmail(valueInput: unknown): unknown {
  if (Array.isArray(valueInput)) return valueInput.map(redactRecoveryEmail);
  if (!isPlainObject(valueInput)) return valueInput;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(valueInput)) {
    const normalized = key.replace(/[A-Z]/gu, (character) => (
      `_${character.toLowerCase()}`
    ));
    if (normalized === 'recovery_email') continue;
    output[key] = redactRecoveryEmail(nested);
  }
  return output;
}

function canonicalState(
  record: Record<string, unknown>,
  allowRecoveryEmail: boolean,
): unknown {
  const source = value(record, 'canonicalState', 'draft_state_json');
  if (source === undefined || source === null || source === '') return null;
  if (isPlainObject(source)) {
    const projected = allowRecoveryEmail ? source : redactRecoveryEmail(source);
    assertNoSensitiveDraftFields(projected, { allowRecoveryEmail });
    return projected;
  }
  if (typeof source !== 'string') return projectionError('PROJECTION_CANONICAL_INVALID');
  try {
    const parsed = JSON.parse(source);
    if (!isPlainObject(parsed)) return projectionError('PROJECTION_CANONICAL_INVALID');
    const projected = allowRecoveryEmail ? parsed : redactRecoveryEmail(parsed);
    assertNoSensitiveDraftFields(projected, { allowRecoveryEmail });
    return projected;
  } catch (error) {
    if (error instanceof ProDraftProjectionError) throw error;
    return projectionError('PROJECTION_CANONICAL_INVALID');
  }
}

function baseProjection(
  record: Record<string, unknown>,
  includeCanonicalState: boolean,
  allowRecoveryEmail = false,
): Record<string, unknown> {
  const recoveryEmail = value(record, 'recovery_email', 'recoveryEmail');
  const output: Record<string, unknown> = {
    draftId: safeId(value(record, 'id', 'draft_id', 'draftId')),
    sessionId: safeId(value(record, 'session_id', 'sessionId')),
    status: typeof record.status === 'string' ? record.status || 'active' : 'active',
    clientRevision: safeInteger(value(record, 'client_revision', 'clientRevision')),
    serverRevision: safeInteger(value(record, 'server_revision', 'serverRevision')),
    stateHash: typeof value(record, 'state_hash', 'stateHash') === 'string'
      ? value(record, 'state_hash', 'stateHash')
      : null,
    lastSavedAt: safeDate(value(record, 'last_saved_at', 'saved_at_server')),
    recoveryEmailPresent: typeof recoveryEmail === 'string' && recoveryEmail.length > 0,
    recoveryEmailVerificationStatus:
      typeof record.recovery_email_verification_status === 'string'
        ? record.recovery_email_verification_status
        : null,
    recoveryCodeHint: typeof record.recovery_code_hint === 'string'
      ? record.recovery_code_hint
      : null,
    draftGeneration: safeInteger(record.draft_generation),
    previousDraftId: safeId(record.previous_draft_id),
    replacementDraftId: safeId(record.replacement_draft_id),
  };
  if (includeCanonicalState) {
    output.canonicalState = canonicalState(record, allowRecoveryEmail);
  }
  return output;
}

export function projectActiveDraftForAuthorizedClient(
  recordInput: unknown,
  options: Readonly<{ includeCanonicalState?: boolean; includeRecoveryEmail?: boolean }> = {},
): Readonly<Record<string, unknown>> {
  const record = requireRecord(recordInput);
  const status = typeof record.status === 'string' ? record.status : '';
  if (!ACTIVE_STATUSES.has(status)) {
    return projectionError('PROJECTION_ACTIVE_STATUS_INVALID');
  }
  const output = baseProjection(
    record,
    options.includeCanonicalState !== false,
    options.includeRecoveryEmail === true,
  );
  output.readOnly = false;
  if (options.includeRecoveryEmail === true
    && typeof record.recovery_email === 'string') {
    output.recoveryEmail = record.recovery_email;
  }
  assertNoSensitiveDraftFields(output, {
    allowRecoveryEmail: options.includeRecoveryEmail === true,
  });
  return Object.freeze(output);
}

export function projectSubmittedDraftForAuthorizedClient(
  recordInput: unknown,
  options: Readonly<{ includeCanonicalState?: boolean }> = {},
): Readonly<Record<string, unknown>> {
  const record = requireRecord(recordInput);
  if (record.status !== 'submitted') {
    return projectionError('PROJECTION_SUBMITTED_STATUS_INVALID');
  }
  const output = baseProjection(record, options.includeCanonicalState !== false);
  output.finalSubmissionId = safeId(record.final_submission_id);
  output.submittedAt = safeDate(record.submitted_at);
  output.pdfSourceStateHash = typeof record.pdf_source_state_hash === 'string'
    ? record.pdf_source_state_hash
    : null;
  output.readOnly = true;
  assertNoSensitiveDraftFields(output);
  return Object.freeze(output);
}

export function projectDraftSummaryForAuthorizedClient(
  recordInput: unknown,
): Readonly<Record<string, unknown>> {
  const record = requireRecord(recordInput);
  const output = baseProjection(record, false);
  output.readOnly = record.status === 'submitted';
  assertNoSensitiveDraftFields(output);
  return Object.freeze(output);
}

export function projectDraftForAdmin(
  recordInput: unknown,
  options: Readonly<{ includeCanonicalState?: boolean; includeRecoveryEmail?: boolean }> = {},
): Readonly<Record<string, unknown>> {
  const record = requireRecord(recordInput);
  const output = baseProjection(
    record,
    options.includeCanonicalState === true,
    options.includeRecoveryEmail === true,
  );
  output.formType = typeof record.form_type === 'string' ? record.form_type : null;
  output.finalSubmissionId = safeId(record.final_submission_id);
  output.submittedAt = safeDate(record.submitted_at);
  output.retentionExpiresAt = safeDate(record.retention_expires_at);
  output.retentionHold = record.retention_hold === true;
  output.lastSubmissionErrorCode = typeof record.last_submission_error_code === 'string'
    ? record.last_submission_error_code
    : null;
  if (options.includeRecoveryEmail === true
    && typeof record.recovery_email === 'string') {
    output.recoveryEmail = record.recovery_email;
  }
  assertNoSensitiveDraftFields(output, {
    allowRecoveryEmail: options.includeRecoveryEmail === true,
  });
  return Object.freeze(output);
}

export function projectDraftForPublicFailure(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    success: false,
    errorCode: 'DRAFT_ACCESS_DENIED',
    message: 'Draft access could not be verified.',
  });
}

export function assertNoSensitiveDraftFields(
  valueInput: unknown,
  options: Readonly<{ allowRecoveryEmail?: boolean }> = {},
): void {
  const pending: unknown[] = [valueInput];
  const visited = new Set<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== 'object') continue;
    if (visited.has(current)) return projectionError('PROJECTION_CYCLE_INVALID');
    visited.add(current);
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    for (const [key, nested] of Object.entries(current)) {
      const normalized = key.replace(/[A-Z]/gu, (character) => `_${character.toLowerCase()}`);
      if ((SENSITIVE_NAMES.has(normalized)
        && !(normalized === 'recovery_email' && options.allowRecoveryEmail === true))
        || SENSITIVE_KEY_PATTERN.test(key)) {
        return projectionError('PROJECTION_SENSITIVE_FIELD');
      }
      pending.push(nested);
    }
  }
}

export function getSensitiveDraftFieldNames(): readonly string[] {
  return SENSITIVE_DRAFT_FIELD_NAMES;
}
