import { readFileSync } from 'node:fs';
import { parse, parseTree } from 'jsonc-parser';
import { describe, expect, it } from 'vitest';

const schemaPath = 'base44/entities/ProFormRecoverySecurityEvent.jsonc';
const source = readFileSync(schemaPath, 'utf8');
const parseErrors = [];
const schema = parse(source, parseErrors, {
  allowTrailingComma: false,
  disallowComments: false,
});

const adminOnly = { user_condition: { role: 'admin' } };
const commonMigrationFields = [
  'environment', 'test_run_id', 'source_app_id', 'source_entity',
  'source_record_id', 'source_created_date', 'source_updated_date',
  'migration_batch_id', 'migration_direction', 'migrated_at',
  'source_content_hash', 'migration_version',
];

describe('ProFormRecoverySecurityEvent schema', () => {
  it('parses as the exact Base44 entity contract without duplicate keys', () => {
    const treeErrors = [];
    const tree = parseTree(source, treeErrors, {
      allowTrailingComma: false,
      disallowComments: false,
    });
    expect(parseErrors).toEqual([]);
    expect(treeErrors).toEqual([]);
    expect(tree).toBeTruthy();
    expect(schema.name).toBe('ProFormRecoverySecurityEvent');
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(['request_id', 'environment']);
    expect(Object.keys(schema.properties)).toHaveLength(28);
  });

  it('uses exact attempt/outcome enums and required defaults/formats', () => {
    expect(schema.properties.attempt_type.enum).toEqual([
      'email_recovery', 'code_recovery', 'list_choices',
      'select_choice', 'captcha', 'admin_review',
      'admin_password_authentication', 'admin_grant_validation',
      'admin_grant_revocation', 'admin_draft_list', 'admin_draft_detail',
      'admin_draft_update', 'admin_event_list', 'admin_retry_submission',
      'admin_repair_submission', 'admin_migration_analyze',
      'admin_migration_apply', 'admin_migration_duplicate_resolution',
      'admin_migration_rollback', 'admin_retention_analyze',
      'admin_retention_apply', 'retention_dry_run', 'retention_apply_start',
      'retention_draft_delete', 'retention_event_delete', 'retention_skip',
      'retention_manual_review', 'retention_failure', 'retention_completion',
    ]);
    expect(schema.properties.outcome.enum).toEqual([
      'success', 'not_found', 'invalid_input', 'rate_limited',
      'captcha_required', 'captcha_failed', 'locked', 'superseded', 'internal_error',
      'authorized', 'invalid_password', 'invalid_grant', 'grant_version_mismatch',
      'password_version_mismatch', 'device_mismatch', 'environment_mismatch',
      'revoked', 'eligible', 'protected', 'manual_review', 'deleted',
      'skipped', 'failed', 'completed', 'dry_run_only',
    ]);
    expect(schema.properties.captcha_required.default).toBe(false);
    expect(schema.properties.captcha_verified.default).toBe(false);
    for (const field of ['lockout_until', 'window_started_at', 'created_at_server']) {
      expect(schema.properties[field]).toMatchObject({ type: 'string', format: 'date-time' });
    }
    for (const field of commonMigrationFields) expect(schema.properties[field]).toBeDefined();
  });

  it('allows only admins for every entity operation and protects linkage fields', () => {
    expect(schema.rls).toEqual({
      create: adminOnly,
      read: adminOnly,
      update: adminOnly,
      delete: adminOnly,
    });
    for (const field of ['recovery_email_lookup_hash', 'draft_id']) {
      expect(schema.properties[field].rls).toEqual({
        read: adminOnly,
        write: adminOnly,
      });
    }
  });

  it('contains no raw sensitive-input or request-content field', () => {
    const forbidden = [
      'email', 'ip_address', 'device_id', 'recovery_code', 'captcha_token',
      'request_body', 'answer_content', 'recovery_session_token',
    ];
    const fields = Object.keys(schema.properties);
    for (const field of forbidden) expect(fields).not.toContain(field);
    expect(fields.filter((field) => /(?:token|password|secret|payload|body)/u.test(field)))
      .toEqual([]);
  });
});
