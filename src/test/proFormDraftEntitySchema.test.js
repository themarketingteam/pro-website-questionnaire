import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse, parseTree } from 'jsonc-parser';
import { describe, expect, it } from 'vitest';

const REPOSITORY_ROOT = path.resolve(process.cwd());
const SCHEMA_PATH = path.join(REPOSITORY_ROOT, 'base44/entities/ProFormDraft.jsonc');
const MANIFEST_PATH = path.join(
  REPOSITORY_ROOT,
  'docs/durable-draft-recovery/data/pro-form-field-manifest.json',
);
const ADMIN_BACKEND_ONLY_RLS = {
  read: { user_condition: { role: 'admin' } },
  write: { user_condition: { role: 'admin' } },
};
const ADMIN_ENTITY_RLS = {
  create: { user_condition: { role: 'admin' } },
  read: { user_condition: { role: 'admin' } },
  update: { user_condition: { role: 'admin' } },
  delete: { user_condition: { role: 'admin' } },
};

const FIELD_CATEGORIES = {
  canonicalState: [
    'form_type',
    'draft_schema_version',
    'draft_state_json',
    'text_validation_meta_json',
    'ui_draft_state_json',
    'field_change_metadata_json',
    'credentials_json',
  ],
  revisionAndHash: [
    'client_revision',
    'server_revision',
    'state_hash',
    'source_tab_id',
    'last_sync_reason',
    'last_restored_at',
  ],
  recoveryEmail: [
    'recovery_email',
    'recovery_email_lookup_hash',
    'recovery_email_source',
    'recovery_email_verification_status',
    'recovery_email_verified_at',
  ],
  recoveryAuthorization: [
    'recovery_code_hash',
    'recovery_code_version',
    'recovery_code_hint',
    'resume_token_hash',
    'identity_key_hash',
    'recovery_session_version',
  ],
  apiIdempotency: [
    'bootstrap_idempotency_key_hash',
    'last_save_idempotency_key_hash',
    'last_save_request_id',
    'last_event_batch_idempotency_key_hash',
    'last_event_batch_request_id',
  ],
  supersession: [
    'draft_generation',
    'previous_draft_id',
    'replacement_draft_id',
    'replacement_transaction_id',
    'replacement_transaction_status',
    'replacement_transaction_started_at',
    'replacement_transaction_completed_at',
    'replacement_transaction_error_code',
    'draft_origin',
    'replacement_operation_idempotency_hash',
    'superseded_at',
    'superseded_reason',
    'status_version',
  ],
  submissionLock: [
    'submitted_state_hash',
    'pdf_source_state_hash',
    'submitted_lock_version',
    'status_locked_at',
    'last_submission_error_code',
  ],
  recoveryEmailDelivery: [
    'recovery_email_delivery_status',
    'last_recovery_email_sent_at',
    'recovery_email_delivery_error_code',
    'recovery_email_delivery_attempt_count',
    'recovery_email_delivery_idempotency_hash',
    'recovery_email_delivery_purpose',
    'recovery_email_provider_message_id',
    'recovery_email_last_request_id',
  ],
  retention: [
    'retention_expires_at',
    'retention_hold',
    'retention_hold_reason',
    'retention_policy_version',
  ],
  migration: [
    'environment',
    'test_run_id',
    'source_app_id',
    'source_entity',
    'source_record_id',
    'source_created_date',
    'source_updated_date',
    'migration_batch_id',
    'migration_direction',
    'migrated_at',
    'source_content_hash',
    'migration_version',
  ],
};

const EXPECTED_NEW_FIELDS = Object.values(FIELD_CATEGORIES).flat();
const FORBIDDEN_RAW_FIELDS = [
  'recovery_code',
  'resume_token',
  'recovery_session_token',
  'admin_grant',
  'recovery_email_body',
  'recovery_email_raw_code',
  'aws_access_key',
  'aws_secret_access_key',
];

const schemaText = readFileSync(SCHEMA_PATH, 'utf8');
const parseErrors = [];
const schema = parse(schemaText, parseErrors, {
  allowTrailingComma: false,
  disallowComments: false,
});
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const draftPlan = manifest.entities.ProFormDraft;

function duplicateKeys(node, pointer = '') {
  const duplicates = [];
  if (node?.type === 'object') {
    const seen = new Set();
    for (const property of node.children || []) {
      const key = String(property.children?.[0]?.value || '');
      const fieldPointer = `${pointer}/${key}`;
      if (seen.has(key)) duplicates.push(fieldPointer);
      seen.add(key);
      duplicates.push(...duplicateKeys(property.children?.[1], fieldPointer));
    }
  } else if (node?.type === 'array') {
    for (const [index, child] of (node.children || []).entries()) {
      duplicates.push(...duplicateKeys(child, `${pointer}/${index}`));
    }
  }
  return duplicates;
}

function validatePayload(payload) {
  const errors = [];
  for (const requiredField of schema.required || []) {
    if (!Object.hasOwn(payload, requiredField)) errors.push(`missing:${requiredField}`);
  }
  for (const [fieldName, value] of Object.entries(payload)) {
    const fieldSchema = schema.properties[fieldName];
    if (!fieldSchema) {
      errors.push(`unknown:${fieldName}`);
      continue;
    }
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (actualType !== fieldSchema.type) errors.push(`type:${fieldName}`);
    if (
      fieldSchema.format === 'date-time'
      && (typeof value !== 'string' || Number.isNaN(Date.parse(value)))
    ) errors.push(`date-time:${fieldName}`);
    if (
      fieldSchema.format === 'email'
      && (typeof value !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(value))
    ) errors.push(`email:${fieldName}`);
  }
  return errors;
}

function syntheticValue(definition, fieldName) {
  if (definition.format === 'date-time') return '2026-08-05T12:00:00.000Z';
  if (definition.format === 'email') return 'schema-test@example.invalid';
  if (definition.type === 'number') return 1;
  if (definition.type === 'boolean') return false;
  if (fieldName.endsWith('_json')) return '{}';
  if (fieldName.includes('hash')) return 'a'.repeat(64);
  return `synthetic-${fieldName}`;
}

describe('ProFormDraft entity schema extension', () => {
  it('parses without duplicate properties and preserves the entity contract', () => {
    const treeErrors = [];
    const tree = parseTree(schemaText, treeErrors, {
      allowTrailingComma: false,
      disallowComments: false,
    });

    expect(parseErrors).toEqual([]);
    expect(treeErrors).toEqual([]);
    expect(duplicateKeys(tree)).toEqual([]);
    expect(schema.name).toBe('ProFormDraft');
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(['session_id']);
    expect(schema.rls).toEqual(ADMIN_ENTITY_RLS);
    expect(schema.properties.status).toMatchObject({ type: 'string' });
    expect(schema.properties.status.enum).toBeUndefined();
  });

  it('preserves all original compatibility and AI repair fields', () => {
    for (const [fieldName, baseline] of Object.entries(draftPlan.existingFields)) {
      expect(schema.properties[fieldName], fieldName).toBeDefined();
      expect(schema.properties[fieldName].type, fieldName).toBe(baseline.type);
    }
    expect(Object.keys(draftPlan.existingFields)).toHaveLength(30);
  });

  it('implements exactly the 71 optional protected fields with admin/backend FLS', () => {
    expect(new Set(EXPECTED_NEW_FIELDS).size).toBe(71);
    expect([...draftPlan.proposedFields].sort()).toEqual([...EXPECTED_NEW_FIELDS].sort());

    for (const fieldName of EXPECTED_NEW_FIELDS) {
      const definition = manifest.fieldDefinitions[fieldName];
      const actual = schema.properties[fieldName];
      expect(definition, `${fieldName} manifest definition`).toBeDefined();
      expect(actual, `${fieldName} schema field`).toBeDefined();
      expect(actual.type, fieldName).toBe(definition.type);
      expect(actual.format, fieldName).toBe(definition.format);
      if (Object.hasOwn(definition, 'default')) {
        expect(actual.default, fieldName).toEqual(definition.default);
      }
      expect(actual.description?.trim(), fieldName).toBeTruthy();
      expect(actual.rls, fieldName).toEqual(ADMIN_BACKEND_ONLY_RLS);
      expect(schema.required).not.toContain(fieldName);
    }
  });

  it('contains no raw recovery, token, or grant field', () => {
    for (const fieldName of FORBIDDEN_RAW_FIELDS) {
      expect(schema.properties).not.toHaveProperty(fieldName);
    }
    expect(schema.properties.credentials_json.description).toMatch(/excludes raw codes, tokens, grants/u);
  });

  it('accepts a synthetic current legacy direct-save payload', () => {
    const legacyPayload = {
      session_id: 'synthetic-legacy-session',
      status: 'draft',
      responses_json: '{}',
      validation_status_json: '{}',
      touched_questions_json: '{}',
      expanded_questions_json: '{}',
      ai_repair_applied: false,
    };

    expect(validatePayload(legacyPayload)).toEqual([]);
  });

  it('accepts a synthetic future canonical backend payload', () => {
    const futurePayload = { session_id: 'synthetic-future-session' };
    for (const fieldName of EXPECTED_NEW_FIELDS) {
      futurePayload[fieldName] = syntheticValue(manifest.fieldDefinitions[fieldName], fieldName);
    }

    expect(validatePayload(futurePayload)).toEqual([]);
  });
});
