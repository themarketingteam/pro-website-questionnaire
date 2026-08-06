import { createHash } from 'node:crypto';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
const BASE_TIME = Date.parse('2026-08-06T12:00:00.000Z');

const digest = (value) => createHash('sha256').update(String(value)).digest('hex');
const clean = (value) => String(value || '').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32);

export const createSyntheticFactoryContext = ({
  seed = 'durable-draft-release',
  testRunId = 'release-test-run-0001',
  workerId = 'worker-0',
} = {}) => {
  if (!SAFE_ID.test(testRunId)) throw new Error('INVALID_SYNTHETIC_TEST_RUN_ID');
  if (!SAFE_ID.test(workerId)) throw new Error('INVALID_SYNTHETIC_WORKER_ID');

  let sequence = 0;
  const prefix = `${clean(testRunId)}-${clean(workerId)}`;
  const next = (kind) => {
    sequence += 1;
    return `${clean(kind)}-${prefix}-${String(sequence).padStart(4, '0')}`;
  };
  const pick = (label, values) => values[
    Number.parseInt(digest(`${seed}:${label}`).slice(0, 8), 16) % values.length
  ];
  const timestamp = (offset = sequence) => new Date(BASE_TIME + offset * 1000).toISOString();

  return Object.freeze({
    environment: 'staging',
    next,
    pick,
    seed: String(seed),
    testRunId,
    timestamp,
    workerId,
  });
};

const withMarker = (context, record = {}) => ({
  ...record,
  environment: 'staging',
  test_run_id: context.testRunId,
});

export const createClientIdentity = (context) => withMarker(context, {
  client_id: context.next('client'),
  device_id: context.next('device'),
  worker_id: context.workerId,
});

export const createEmailAssociatedDraft = (context, overrides = {}) => withMarker(context, {
  id: context.next('draft-email'),
  business_name: `E2E STAGING ${context.testRunId}`,
  domain: `${context.testRunId.toLowerCase()}.example.test`,
  recovery_email: `draft+${context.testRunId.toLowerCase()}@example.test`,
  status: 'active',
  ...overrides,
});

export const createAnonymousDraft = (context, overrides = {}) => withMarker(context, {
  id: context.next('draft-anonymous'),
  business_name: `E2E STAGING ${context.testRunId}`,
  recovery_email: null,
  status: 'active',
  ...overrides,
});

export const createActiveDraft = (context, overrides = {}) => createEmailAssociatedDraft(context, {
  client_revision: 3,
  last_saved_at: context.timestamp(),
  server_revision: 3,
  status: 'active',
  ...overrides,
});

export const createSubmitFailedDraft = (context, overrides = {}) => createActiveDraft(context, {
  status: 'submit_failed',
  submit_error: 'SYNTHETIC_TRANSIENT_FAILURE',
  ...overrides,
});

export const createSubmittedDraft = (context, overrides = {}) => createActiveDraft(context, {
  final_submission_id: context.next('submission-ref'),
  status: 'submitted',
  submitted_at: context.timestamp(),
  ...overrides,
});

export const createClearedOrSupersededDraft = (context, overrides = {}) => createActiveDraft(context, {
  replacement_draft_id: context.next('replacement'),
  status: context.pick('terminal-status', ['cleared', 'superseded']),
  superseded_at: context.timestamp(),
  superseded_reason: 'synthetic_test_replacement',
  ...overrides,
});

export const createQuestionnaireResponseSet = (context, overrides = {}) => withMarker(context, {
  responses: {
    short_text: 'Synthetic response',
    long_text: 'Synthetic staging-only paragraph for release verification.',
    single_select: 'synthetic_option_a',
    multi_select: ['synthetic_option_a', 'synthetic_option_b'],
    boolean: true,
    number: 7,
    date: '2030-01-15',
    url: `https://${context.testRunId.toLowerCase()}.example.test/path`,
    email: `responses+${context.testRunId.toLowerCase()}@example.test`,
    file: createFileMetadata(context),
    repeater: [{ label: 'Synthetic item', value: 'synthetic_value' }],
    location: { label: 'Synthetic service area', lat: 0, lon: 0 },
  },
  ...overrides,
});

export const createPartialUiEditorState = (context, overrides = {}) => withMarker(context, {
  current_question_id: 'synthetic-long-text',
  expanded_sections: ['synthetic-section-a'],
  touched_fields: ['short_text'],
  validation_state: { short_text: 'valid', long_text: 'pending' },
  ...overrides,
});

export const createFileMetadata = (context, overrides = {}) => withMarker(context, {
  file_id: context.next('file'),
  file_name: 'synthetic-document.txt',
  media_type: 'text/plain',
  size_bytes: 128,
  url: `https://assets.example.test/${context.testRunId}/synthetic-document.txt`,
  ...overrides,
});

export const createDraftEvent = (context, overrides = {}) => withMarker(context, {
  id: context.next('event'),
  draft_id: context.next('draft-ref'),
  event_id: context.next('mutation'),
  event_type: 'question_answered',
  question_id: 'synthetic-short-text',
  redaction_level: 'metadata_only',
  value_length: 18,
  ...overrides,
});

export const createSubmission = (context, overrides = {}) => withMarker(context, {
  id: context.next('submission'),
  business_name: `E2E STAGING ${context.testRunId}`,
  questionnaire_session_id: context.next('session'),
  status: 'submitted',
  submitted_at: context.timestamp(),
  ...overrides,
});

export const createIntake = (context, overrides = {}) => withMarker(context, {
  id: context.next('intake'),
  business_name: `E2E STAGING ${context.testRunId}`,
  questionnaire_session_id: context.next('session'),
  status: 'received',
  ...overrides,
});

export const createRecoverySecurityEvent = (context, overrides = {}) => withMarker(context, {
  id: context.next('security-event'),
  event_type: 'synthetic_recovery_attempt',
  outcome: 'denied',
  safe_reason_code: 'SYNTHETIC_RATE_LIMIT_TEST',
  ...overrides,
});

export const createVerificationAttempt = (context, overrides = {}) => withMarker(context, {
  id: context.next('verification-attempt'),
  outcome: 'pending',
  purpose: 'synthetic_email_verification',
  test_only_fake_code_label: `TEST-ONLY-FAKE-CODE-${digest(context.seed).slice(0, 8)}`,
  ...overrides,
});

export const createMigrationFixture = (context, overrides = {}) => withMarker(context, {
  id: context.next('migration'),
  migration_direction: 'blue_to_green',
  operation_mode: 'initial_full',
  source_app_id: 'synthetic-blue-app',
  destination_app_id: 'synthetic-green-app',
  ...overrides,
});

export const createConflictFixture = (context, overrides = {}) => withMarker(context, {
  id: context.next('conflict'),
  conflict_type: 'source_and_destination_modified',
  resolution_status: 'open',
  source_content_hash: digest(`${context.seed}:source`),
  destination_content_hash: digest(`${context.seed}:destination`),
  ...overrides,
});

export const createRetentionFixture = (context, overrides = {}) => withMarker(context, {
  id: context.next('retention'),
  retention_decision: 'protected',
  retention_reason: 'test_protected',
  status: 'active',
  ...overrides,
});
