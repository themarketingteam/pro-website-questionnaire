/** Internal recovery-code email service for already-authorized draft operations. */

import {
  EMAIL_TRANSPORT_ERROR_CODES,
  getEmailTransportConfig,
  sendTransactionalEmail,
  type InternalEmailTransportResult,
} from '../proDraftEmailTransport/entry.ts';
import { renderRecoveryCodeEmail } from '../proDraftEmailTemplates/entry.ts';
import { normalizeRecoveryEmail } from '../proDraftIdentity/entry.ts';
import {
  type DraftRecord,
  type DraftRepository,
  conditionalUpdateDraftDeliveryMetadata,
  createDraftEvents,
} from '../proDraftRepository/entry.ts';
import {
  SECURITY_SECRET_NAMES,
  hashRecoveryCode,
  hmacSha256Hex,
  timingSafeEqualStrings,
} from '../proDraftSecurity/entry.ts';

export const PRO_DRAFT_RECOVERY_EMAIL_SERVICE_VERSION = 1;

export const RECOVERY_EMAIL_SERVICE_ERROR_CODES = Object.freeze({
  CONFIGURATION_INVALID: 'RECOVERY_EMAIL_CONFIGURATION_INVALID',
  DRAFT_INVALID: 'RECOVERY_EMAIL_DRAFT_INVALID',
  CODE_MISMATCH: 'RECOVERY_EMAIL_CODE_MISMATCH',
  TRANSACTION_NOT_COMMITTED: 'RECOVERY_EMAIL_TRANSACTION_NOT_COMMITTED',
  DELIVERY_CONFLICT: 'RECOVERY_EMAIL_DELIVERY_CONFLICT',
  DELIVERY_FAILED: 'RECOVERY_EMAIL_DELIVERY_FAILED',
  DELIVERY_UNCERTAIN: 'RECOVERY_EMAIL_DELIVERY_UNCERTAIN',
} as const);

export type InternalRecoveryEmailResult = Readonly<{
  attempted: boolean;
  delivered: boolean;
  redirected: boolean;
  failed: boolean;
  canRetry: boolean;
  deliveryUncertain: boolean;
  idempotent: boolean;
  errorCode: string | null;
}>;

export type RecoveryEmailServiceDependencies = Readonly<{
  getEnvironmentValue: (name: string) => string | undefined;
  sendEmail?: (options: Parameters<typeof sendTransactionalEmail>[0]) =>
    Promise<InternalEmailTransportResult>;
  renderEmail?: typeof renderRecoveryCodeEmail;
}>;

export type DeliverRecoveryEmailInput = Readonly<{
  repository: DraftRepository;
  draft: DraftRecord;
  recoveryCode: string;
  purpose: 'clear_all_replacement' | 'start_new_after_submission' | 'staging_self_check';
  operationIdempotencyKey: string;
  requestId: string;
  environment: 'local' | 'test' | 'staging' | 'production';
  now: Date;
  testRunId?: string;
}>;

const HASH = /^[0-9a-f]{64}$/u;

function result(overrides: Partial<InternalRecoveryEmailResult>): InternalRecoveryEmailResult {
  return Object.freeze({
    attempted: false,
    delivered: false,
    redirected: false,
    failed: false,
    canRetry: false,
    deliveryUncertain: false,
    idempotent: false,
    errorCode: null,
    ...overrides,
  });
}

function secret(dependencies: RecoveryEmailServiceDependencies, name: string): string | null {
  const value = dependencies.getEnvironmentValue(name);
  return typeof value === 'string' && new TextEncoder().encode(value).byteLength >= 32
    ? value
    : null;
}

function concurrency(record: DraftRecord) {
  if (typeof record.id !== 'string'
    || typeof record.updated_date !== 'string'
    || Number.isNaN(Date.parse(record.updated_date))
    || typeof record.status !== 'string'
    || !Number.isSafeInteger(record.server_revision)) return null;
  return {
    draftId: record.id,
    expectedUpdatedDate: record.updated_date,
    expectedStatus: record.status,
    expectedServerRevision: Number(record.server_revision),
  } as const;
}

async function event(
  input: DeliverRecoveryEmailInput,
  eventType: string,
  metadata: Readonly<Record<string, unknown>>,
): Promise<void> {
  await createDraftEvents(input.repository, [{
    session_id: input.draft.session_id,
    event_type: eventType,
    created_at_iso: input.now.toISOString(),
    draft_id: input.draft.id,
    event_id: `${input.requestId}:${eventType}`,
    server_revision: input.draft.server_revision,
    event_metadata_json: JSON.stringify({
      purpose: input.purpose,
      requestId: input.requestId,
      ...metadata,
    }),
    redaction_level: 'omitted',
    environment: input.environment,
    ...(input.testRunId ? { test_run_id: input.testRunId } : {}),
  }]);
}

/**
 * Delivers a code only after the caller has authorized the exact draft.
 * The service accepts no public authorization or recipient override and never
 * returns, persists, or logs the raw code.
 */
export async function deliverProDraftRecoveryEmail(
  input: DeliverRecoveryEmailInput,
  dependencies: RecoveryEmailServiceDependencies,
): Promise<InternalRecoveryEmailResult> {
  if (typeof input.draft.recovery_email !== 'string'
    || input.draft.recovery_email.trim() === '') {
    return result({ errorCode: null });
  }
  const normalizedEmail = normalizeRecoveryEmail(input.draft.recovery_email);
  if (!normalizedEmail.valid) return result({ errorCode: null });
  if (input.purpose !== 'staging_self_check'
    && input.draft.replacement_transaction_status !== undefined
    && input.draft.replacement_transaction_status !== 'committed') {
    return result({
      failed: true,
      errorCode: RECOVERY_EMAIL_SERVICE_ERROR_CODES.TRANSACTION_NOT_COMMITTED,
    });
  }
  const recoverySecret = secret(dependencies, SECURITY_SECRET_NAMES.RECOVERY_CODE);
  const idempotencySecret = secret(dependencies, 'PRO_FORM_IDEMPOTENCY_SECRET');
  if (!recoverySecret || !idempotencySecret) {
    return result({
      failed: true,
      canRetry: true,
      errorCode: RECOVERY_EMAIL_SERVICE_ERROR_CODES.CONFIGURATION_INVALID,
    });
  }
  const codeHash = await hashRecoveryCode(input.recoveryCode, {
    name: SECURITY_SECRET_NAMES.RECOVERY_CODE,
    value: recoverySecret,
  });
  if (typeof input.draft.recovery_code_hash !== 'string'
    || !HASH.test(input.draft.recovery_code_hash)
    || !timingSafeEqualStrings(input.draft.recovery_code_hash, codeHash)) {
    return result({
      failed: true,
      errorCode: RECOVERY_EMAIL_SERVICE_ERROR_CODES.CODE_MISMATCH,
    });
  }
  const idempotencyHash = await hmacSha256Hex(
    `pro-draft:recovery-email-idempotency:v1:${input.draft.id}:${input.purpose}:${input.operationIdempotencyKey}`,
    idempotencySecret,
  );
  if (input.draft.recovery_email_delivery_idempotency_hash === idempotencyHash
    && input.draft.recovery_email_delivery_status === 'sent') {
    return result({ delivered: true, idempotent: true });
  }
  const current = concurrency(input.draft);
  if (!current) {
    return result({
      failed: true,
      canRetry: true,
      errorCode: RECOVERY_EMAIL_SERVICE_ERROR_CODES.DRAFT_INVALID,
    });
  }
  const attempt = Number.isSafeInteger(input.draft.recovery_email_delivery_attempt_count)
    ? Number(input.draft.recovery_email_delivery_attempt_count) + 1
    : 1;
  let attempting: DraftRecord;
  try {
    attempting = await conditionalUpdateDraftDeliveryMetadata(input.repository, {
      ...current,
      changes: {
        recovery_email_delivery_status: 'attempting',
        recovery_email_delivery_error_code: '',
        recovery_email_delivery_attempt_count: attempt,
        recovery_email_delivery_idempotency_hash: idempotencyHash,
        recovery_email_delivery_purpose: input.purpose,
        recovery_email_provider_message_id: '',
        recovery_email_last_request_id: input.requestId,
      },
    });
  } catch {
    return result({
      failed: true,
      canRetry: true,
      errorCode: RECOVERY_EMAIL_SERVICE_ERROR_CODES.DELIVERY_CONFLICT,
    });
  }
  try {
    await event(input, 'recovery_email_attempted', { attemptNumber: attempt });
  } catch {
    // Delivery metadata is authoritative; event loss is represented as uncertainty later.
  }
  const config = getEmailTransportConfig({
    envSource: dependencies.getEnvironmentValue,
    environment: input.environment,
  });
  const externalMode = dependencies.getEnvironmentValue(
    'PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE',
  );
  if (config.mode === 'disabled' || !config.modeRecognized
    || config.environment !== input.environment
    || config.mode !== externalMode) {
    const attemptingConcurrency = concurrency(attempting);
    if (attemptingConcurrency) {
      try {
        await conditionalUpdateDraftDeliveryMetadata(input.repository, {
          ...attemptingConcurrency,
          changes: {
            recovery_email_delivery_status: 'failed',
            recovery_email_delivery_error_code:
              RECOVERY_EMAIL_SERVICE_ERROR_CODES.CONFIGURATION_INVALID,
            recovery_email_delivery_attempt_count: attempt,
            recovery_email_delivery_idempotency_hash: idempotencyHash,
            recovery_email_delivery_purpose: input.purpose,
            recovery_email_provider_message_id: '',
            recovery_email_last_request_id: input.requestId,
          },
        });
      } catch {
        // A safe retryable result still prevents rollback or credential exposure.
      }
    }
    return result({
      attempted: true,
      failed: true,
      canRetry: true,
      errorCode: RECOVERY_EMAIL_SERVICE_ERROR_CODES.CONFIGURATION_INVALID,
    });
  }
  let transport: InternalEmailTransportResult;
  try {
    const rendered = (dependencies.renderEmail ?? renderRecoveryCodeEmail)({
      recoveryCode: input.recoveryCode,
      businessDisplayName: input.draft.business_name,
      recoveryBaseUrl: config.recoveryBaseUrl,
      environment: input.environment === 'production' ? 'production' : 'staging',
      purpose: input.purpose,
    });
    transport = await (dependencies.sendEmail ?? sendTransactionalEmail)({
      intendedRecipient: normalizedEmail.normalizedEmail,
      recipientAuthorized: true,
      subject: rendered.subject,
      textBody: rendered.textBody,
      htmlBody: rendered.htmlBody,
      requestId: input.requestId,
      environment: input.environment,
      envSource: dependencies.getEnvironmentValue,
    });
  } catch {
    transport = {
      success: false,
      delivered: false,
      suppressed: false,
      redirected: false,
      mode: config.mode,
      destinationClass: 'none',
      providerMessageId: null,
      providerStatus: null,
      errorCode: EMAIL_TRANSPORT_ERROR_CODES.PROVIDER_ERROR,
      requestId: input.requestId,
    };
  }
  const attemptingConcurrency = concurrency(attempting);
  if (!attemptingConcurrency) {
    return result({
      attempted: true,
      delivered: transport.delivered === true,
      redirected: transport.redirected === true,
      failed: transport.delivered !== true,
      deliveryUncertain: transport.delivered === true,
      canRetry: transport.delivered !== true,
      errorCode: transport.delivered === true
        ? RECOVERY_EMAIL_SERVICE_ERROR_CODES.DELIVERY_UNCERTAIN
        : RECOVERY_EMAIL_SERVICE_ERROR_CODES.DELIVERY_FAILED,
    });
  }
  const delivered = transport.success === true && transport.delivered === true;
  try {
    await conditionalUpdateDraftDeliveryMetadata(input.repository, {
      ...attemptingConcurrency,
      changes: {
        recovery_email_delivery_status: delivered ? 'sent' : 'failed',
        ...(delivered ? { last_recovery_email_sent_at: input.now.toISOString() } : {}),
        recovery_email_delivery_error_code: delivered
          ? ''
          : transport.errorCode ?? RECOVERY_EMAIL_SERVICE_ERROR_CODES.DELIVERY_FAILED,
        recovery_email_delivery_attempt_count: attempt,
        recovery_email_delivery_idempotency_hash: idempotencyHash,
        recovery_email_delivery_purpose: input.purpose,
        recovery_email_provider_message_id: delivered
          ? transport.providerMessageId ?? ''
          : '',
        recovery_email_last_request_id: input.requestId,
      },
    });
  } catch {
    return result({
      attempted: true,
      delivered,
      redirected: transport.redirected === true,
      failed: !delivered,
      canRetry: !delivered,
      deliveryUncertain: delivered,
      errorCode: delivered
        ? RECOVERY_EMAIL_SERVICE_ERROR_CODES.DELIVERY_UNCERTAIN
        : RECOVERY_EMAIL_SERVICE_ERROR_CODES.DELIVERY_FAILED,
    });
  }
  try {
    await event(input, delivered ? 'recovery_email_sent' : 'recovery_email_failed', {
      attemptNumber: attempt,
      redirected: transport.redirected === true,
      errorCode: delivered ? null : transport.errorCode,
    });
  } catch {
    // The safe result remains authoritative and contains no recipient or code.
  }
  return result({
    attempted: true,
    delivered,
    redirected: transport.redirected === true,
    failed: !delivered,
    canRetry: !delivered,
    errorCode: delivered
      ? null
      : transport.errorCode ?? RECOVERY_EMAIL_SERVICE_ERROR_CODES.DELIVERY_FAILED,
  });
}

export function getSafeRecoveryEmailServiceDiagnostics(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    version: PRO_DRAFT_RECOVERY_EMAIL_SERVICE_VERSION,
    acceptsPublicAuthorization: false,
    acceptsRecipientOverride: false,
    storesRawCode: false,
    logsRawCode: false,
    requiresCommittedReplacement: true,
  });
}
