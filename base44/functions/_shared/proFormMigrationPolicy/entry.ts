const COMMON_MIGRATION_FIELDS = [
  'environment', 'test_run_id', 'origin_app_id', 'origin_entity', 'origin_record_id',
  'origin_created_at', 'origin_updated_at', 'source_app_id', 'source_entity',
  'source_record_id', 'source_created_date', 'source_updated_date', 'migration_batch_id',
  'migration_direction', 'migrated_at', 'source_content_hash', 'migration_version',
];
const SERVER_FIELDS = ['id', 'created_date', 'updated_date', 'created_by'];
const HASH_EXCLUDED = [...SERVER_FIELDS, ...COMMON_MIGRATION_FIELDS];
const policy = (
  entityName: string,
  dependencyOrder: number,
  allowedFields: string[],
  relationshipFields: Array<{ path: string; targetEntity: string; required: boolean }>,
  migrationPolicy = 'required',
) => Object.freeze({
  entityName,
  migrationPolicy,
  reverseMigrationPolicy: migrationPolicy,
  dependencyOrder,
  allowedFields: Object.freeze(allowedFields),
  relationshipFields: Object.freeze(relationshipFields),
  serverManagedFields: Object.freeze(SERVER_FIELDS),
  excludedFields: Object.freeze([]),
  contentHashExcludedFields: Object.freeze(HASH_EXCLUDED),
  productionAllowed: true,
  stagingAllowed: false,
  testRecordPolicy: 'never_migrate',
});

export const PRO_FORM_MIGRATION_RUNTIME_POLICIES = Object.freeze({
  ProFormDraft: policy('ProFormDraft', 10, [
    'session_id', 'business_name', 'domain', 'user_id', 'user_name', 'user_email', 'status',
    'current_question_id', 'last_changed_question_id', 'responses_json', 'validation_status_json',
    'touched_questions_json', 'expanded_questions_json', 'metadata_json', 'userdata_json',
    'mapped_payload_json', 'draft_metadata_json', 'save_error', 'submit_error',
    'submit_attempted_at', 'submitted_at', 'last_changed_at', 'last_saved_at',
    'final_submission_id', 'ai_repair_status', 'last_ai_repair_at', 'ai_repair_error_json',
    'ai_repair_report_json', 'ai_repaired_payload_json', 'ai_repair_applied', 'form_type',
    'draft_schema_version', 'draft_state_json', 'text_validation_meta_json', 'ui_draft_state_json',
    'field_change_metadata_json', 'credentials_json', 'client_revision', 'server_revision',
    'state_hash', 'source_tab_id', 'last_sync_reason', 'last_restored_at', 'recovery_email',
    'recovery_email_lookup_hash', 'recovery_email_source', 'recovery_email_verification_status',
    'recovery_email_verified_at', 'recovery_code_hash', 'recovery_code_version',
    'recovery_code_hint', 'resume_token_hash', 'identity_key_hash', 'recovery_session_version',
    'bootstrap_idempotency_key_hash', 'last_save_idempotency_key_hash', 'last_save_request_id',
    'last_event_batch_idempotency_key_hash', 'last_event_batch_request_id', 'draft_generation',
    'previous_draft_id', 'replacement_draft_id', 'replacement_transaction_id',
    'replacement_transaction_status', 'replacement_transaction_started_at',
    'replacement_transaction_completed_at', 'replacement_transaction_error_code', 'draft_origin',
    'replacement_operation_idempotency_hash', 'superseded_at', 'superseded_reason',
    'status_version', 'submitted_state_hash', 'pdf_source_state_hash', 'submitted_lock_version',
    'status_locked_at', 'last_submission_error_code', 'recovery_email_delivery_status',
    'last_recovery_email_sent_at', 'recovery_email_delivery_error_code',
    'recovery_email_delivery_attempt_count', 'recovery_email_delivery_idempotency_hash',
    'recovery_email_delivery_purpose', 'recovery_email_provider_message_id',
    'recovery_email_last_request_id', 'retention_expires_at', 'retention_hold',
    'retention_hold_reason', 'retention_policy_version', ...COMMON_MIGRATION_FIELDS,
  ], [
    { path: 'previous_draft_id', targetEntity: 'ProFormDraft', required: false },
    { path: 'replacement_draft_id', targetEntity: 'ProFormDraft', required: false },
    { path: 'final_submission_id', targetEntity: 'ProFormSubmission', required: false },
  ]),
  ProFormDraftEvent: policy('ProFormDraftEvent', 20, [
    'session_id', 'event_type', 'question_id', 'question_type', 'value_json', 'value_summary',
    'value_length', 'selected_option_count', 'business_name', 'domain', 'user_id',
    'created_at_iso', 'draft_id', 'event_id', 'client_revision', 'server_revision',
    'source_tab_id', 'mutation_id', 'event_metadata_json', 'value_hash', 'redaction_level',
    'admin_actor_hash', 'retention_expires_at', 'retention_hold', 'retention_hold_reason',
    ...COMMON_MIGRATION_FIELDS,
  ], [{ path: 'draft_id', targetEntity: 'ProFormDraft', required: false }]),
  ProFormSubmission: policy('ProFormSubmission', 30, [
    'metadata', 'userdata', 'questionnaire_session_id', 'source_draft_id',
    'submitted_state_hash', 'pdf_source_state_hash', ...COMMON_MIGRATION_FIELDS,
  ], [{ path: 'source_draft_id', targetEntity: 'ProFormDraft', required: false }]),
  ProFormSubmissionIntake: policy('ProFormSubmissionIntake', 40, [
    'questionnaire_session_id', 'business_name', 'business_domain', 'user_email', 'user_id',
    'status', 'intake_reason', 'primary_failure_kind', 'fallback_failure_kind',
    'primary_error_json', 'fallback_error_json', 'retry_error_json', 'transformed_payload_json',
    'raw_responses_json', 'diagnostics_json', 'source', 'created_at_client', 'created_at_server',
    'last_retry_at', 'retry_count', 'linked_submission_id', 'zapier_sent', 'notes',
    'ai_repair_status', 'ai_repair_attempt_count', 'last_ai_repair_at', 'ai_repair_error_json',
    'ai_repair_report_json', 'ai_repaired_payload_json', 'ai_repair_applied',
    'ai_repair_retry_attempted', 'ai_repair_retry_result_json', 'ai_repair_source',
    'source_draft_id', 'canonical_state_hash', 'submitted_state_hash', 'zapier_suppressed',
    'zapier_redirected', 'zapier_status', ...COMMON_MIGRATION_FIELDS,
  ], [
    { path: 'source_draft_id', targetEntity: 'ProFormDraft', required: false },
    { path: 'linked_submission_id', targetEntity: 'ProFormSubmission', required: false },
  ]),
  ProFormRecoverySecurityEvent: policy('ProFormRecoverySecurityEvent', 50, [
    'request_id', 'environment', 'attempt_type', 'outcome', 'subject_hash', 'ip_hash',
    'device_hash', 'recovery_email_lookup_hash', 'draft_id', 'captcha_required',
    'captcha_verified', 'failure_count_window', 'attempt_count_window', 'lockout_until',
    'window_started_at', 'created_at_server', 'policy_version', 'test_run_id',
    'source_app_id', 'source_entity', 'source_record_id', 'source_created_date',
    'source_updated_date', 'migration_batch_id', 'migration_direction', 'migrated_at',
    'source_content_hash', 'migration_version',
  ], [{ path: 'draft_id', targetEntity: 'ProFormDraft', required: false }], 'audit_optional'),
});

export function getProFormMigrationRuntimePolicy(entityName: unknown) {
  if (typeof entityName !== 'string'
    || !Object.hasOwn(PRO_FORM_MIGRATION_RUNTIME_POLICIES, entityName)) {
    throw new Error('MIGRATION_ENTITY_POLICY_REJECTED');
  }
  return PRO_FORM_MIGRATION_RUNTIME_POLICIES[
    entityName as keyof typeof PRO_FORM_MIGRATION_RUNTIME_POLICIES
  ];
}

export function getSafeProFormMigrationPolicyDiagnostics() {
  return Object.freeze({
    version: 1,
    entities: Object.freeze(Object.values(PRO_FORM_MIGRATION_RUNTIME_POLICIES)
      .map(({ entityName, dependencyOrder, migrationPolicy }) => Object.freeze({
        entityName, dependencyOrder, migrationPolicy,
      }))),
    unknownFieldsRejected: true,
    deletesSupported: false,
  });
}
