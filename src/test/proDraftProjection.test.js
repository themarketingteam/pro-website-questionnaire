import { describe, expect, it } from 'vitest';
import {
  ProDraftProjectionError,
  assertNoSensitiveDraftFields,
  getSensitiveDraftFieldNames,
  projectActiveDraftForAuthorizedClient,
  projectDraftForAdmin,
  projectDraftForPublicFailure,
  projectDraftRecoveryChoiceForAuthorizedClient,
  projectDraftRecoverySummaryForAuthorizedClient,
  projectDraftSummaryForAuthorizedClient,
  projectSubmittedDraftForAuthorizedClient,
} from '../../base44/functions/_shared/proDraftProjection/entry.ts';

const record = (overrides = {}) => ({
  id: 'draft-synthetic-1',
  session_id: 'session-synthetic-1',
  status: 'active',
  draft_state_json: JSON.stringify({
    schemaVersion: 4,
    draftId: 'draft-synthetic-1',
    responses: { 6: 'Synthetic answer' },
    credentials: { recoveryEmail: 'nested@example.test' },
  }),
  client_revision: 2,
  server_revision: 5,
  state_hash: 'a'.repeat(64),
  last_saved_at: '2026-08-05T12:00:00.000Z',
  recovery_email: 'synthetic@example.test',
  recovery_email_lookup_hash: 'b'.repeat(64),
  recovery_email_verification_status: 'unverified',
  recovery_code_hash: 'c'.repeat(64),
  recovery_code_hint: 'X7K9',
  resume_token_hash: 'd'.repeat(64),
  identity_key_hash: 'e'.repeat(64),
  bootstrap_idempotency_key_hash: 'f'.repeat(64),
  last_save_idempotency_key_hash: '1'.repeat(64),
  last_event_batch_idempotency_key_hash: '2'.repeat(64),
  source_app_id: 'app-sensitive',
  ai_repair_error_json: '{"raw":"diagnostic"}',
  draft_generation: 1,
  previous_draft_id: 'draft-synthetic-0',
  replacement_draft_id: null,
  ...overrides,
});

const forbidden = [
  'recovery_email_lookup_hash',
  'recovery_code_hash',
  'resume_token_hash',
  'identity_key_hash',
  'bootstrap_idempotency_key_hash',
  'last_save_idempotency_key_hash',
  'last_event_batch_idempotency_key_hash',
  'source_app_id',
  'ai_repair_error_json',
];

describe('safe draft projections', () => {
  it('projects active records through an explicit safe allowlist', () => {
    const output = projectActiveDraftForAuthorizedClient(record());
    expect(output).toMatchObject({
      draftId: 'draft-synthetic-1',
      sessionId: 'session-synthetic-1',
      status: 'active',
      clientRevision: 2,
      serverRevision: 5,
      recoveryEmailPresent: true,
      recoveryEmailVerificationStatus: 'unverified',
      recoveryCodeHint: 'X7K9',
      readOnly: false,
    });
    expect(output.canonicalState).toEqual({
      schemaVersion: 4,
      draftId: 'draft-synthetic-1',
      responses: { 6: 'Synthetic answer' },
      credentials: {},
    });
    for (const field of forbidden) expect(output).not.toHaveProperty(field);
    expect(output).not.toHaveProperty('recoveryEmail');
    expect(() => assertNoSensitiveDraftFields(output)).not.toThrow();
  });

  it('includes raw recovery email only under an explicit authorized option', () => {
    const output = projectActiveDraftForAuthorizedClient(record(), {
      includeRecoveryEmail: true,
    });
    expect(output.recoveryEmail).toBe('synthetic@example.test');
    expect(output.canonicalState.credentials.recoveryEmail)
      .toBe('nested@example.test');
    expect(() => assertNoSensitiveDraftFields(output, {
      allowRecoveryEmail: true,
    })).not.toThrow();
    expect(() => assertNoSensitiveDraftFields(output)).toThrowError(
      expect.objectContaining({ code: 'PROJECTION_SENSITIVE_FIELD' }),
    );
  });

  it('projects submitted records as read-only with safe linkage', () => {
    const output = projectSubmittedDraftForAuthorizedClient(record({
      status: 'submitted',
      final_submission_id: 'submission-synthetic-1',
      submitted_at: '2026-08-05T12:30:00.000Z',
      pdf_source_state_hash: '9'.repeat(64),
    }));
    expect(output).toMatchObject({
      status: 'submitted',
      finalSubmissionId: 'submission-synthetic-1',
      submittedAt: '2026-08-05T12:30:00.000Z',
      pdfSourceStateHash: '9'.repeat(64),
      readOnly: true,
    });
    for (const field of forbidden) expect(output).not.toHaveProperty(field);
    expect(() => assertNoSensitiveDraftFields(output)).not.toThrow();
  });

  it('omits canonical state from summary and default admin projections', () => {
    const summary = projectDraftSummaryForAuthorizedClient(record());
    const admin = projectDraftForAdmin(record({
      retention_hold: true,
      retention_expires_at: '2027-08-05T12:00:00.000Z',
    }));
    expect(summary).not.toHaveProperty('canonicalState');
    expect(admin).not.toHaveProperty('canonicalState');
    expect(admin).toMatchObject({
      retentionHold: true,
      retentionExpiresAt: '2027-08-05T12:00:00.000Z',
    });
    expect(JSON.stringify(admin)).not.toContain('app-sensitive');
  });

  it('projects the exact minimal recovery success summary', () => {
    const summary = projectDraftRecoverySummaryForAuthorizedClient(record({
      business_name: 'Synthetic Business',
      created_date: '2026-08-01T12:00:00.000Z',
    }));
    expect(summary).toEqual({
      draftId: 'draft-synthetic-1',
      status: 'active',
      readOnly: false,
      businessNameDisplay: 'Synthetic Business',
      createdAt: '2026-08-01T12:00:00.000Z',
      lastSavedAt: '2026-08-05T12:00:00.000Z',
      draftGeneration: 1,
      recoveryCodeHint: 'X7K9',
    });
    expect(JSON.stringify(summary)).not.toMatch(/canonical|email|hash/iu);
  });

  it('projects the exact associated-choice allowlist', () => {
    const choice = projectDraftRecoveryChoiceForAuthorizedClient(record({
      business_name: 'Synthetic Business',
      created_date: '2026-08-01T12:00:00.000Z',
      status: 'submitted',
    }), 'draft-synthetic-1');
    expect(choice).toEqual({
      draftId: 'draft-synthetic-1',
      status: 'submitted',
      readOnly: true,
      businessNameDisplay: 'Synthetic Business',
      createdAt: '2026-08-01T12:00:00.000Z',
      lastSavedAt: '2026-08-05T12:00:00.000Z',
      draftGeneration: 1,
      isCurrentSelection: true,
    });
    expect(JSON.stringify(choice)).not.toMatch(/answer|email|domain|hash|token/iu);
  });

  it('detects sensitive fields recursively in snake and camel case', () => {
    for (const unsafe of [
      { nested: { resume_token_hash: 'unsafe' } },
      { nested: { identityKeyHash: 'unsafe' } },
      { nested: [{ lastSaveIdempotencyKeyHash: 'unsafe' }] },
      { sourceAppId: 'unsafe' },
    ]) {
      expect(() => assertNoSensitiveDraftFields(unsafe)).toThrowError(
        ProDraftProjectionError,
      );
    }
    expect(getSensitiveDraftFieldNames()).toEqual(expect.arrayContaining(forbidden));
  });

  it('returns a generic public failure with no identifiers', () => {
    expect(projectDraftForPublicFailure()).toEqual({
      success: false,
      errorCode: 'DRAFT_ACCESS_DENIED',
      message: 'Draft access could not be verified.',
    });
    expect(JSON.stringify(projectDraftForPublicFailure())).not.toContain('draft-synthetic');
  });

  it('fails closed when the requested projection does not match status', () => {
    expect(() => projectActiveDraftForAuthorizedClient(record({ status: 'submitted' })))
      .toThrowError(expect.objectContaining({
        code: 'PROJECTION_ACTIVE_STATUS_INVALID',
      }));
    expect(() => projectSubmittedDraftForAuthorizedClient(record()))
      .toThrowError(expect.objectContaining({
        code: 'PROJECTION_SUBMITTED_STATUS_INVALID',
      }));
  });
});
