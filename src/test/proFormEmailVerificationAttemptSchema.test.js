import { readFileSync } from 'node:fs';
import { parse, parseTree } from 'jsonc-parser';
import { describe, expect, it } from 'vitest';

const schemaPath = 'base44/entities/ProFormEmailVerificationAttempt.jsonc';
const source = readFileSync(schemaPath, 'utf8');
const errors = [];
const schema = parse(source, errors, {
  allowTrailingComma: false,
  disallowComments: false,
});
const manifest = JSON.parse(readFileSync(
  'docs/durable-draft-recovery/data/pro-form-field-manifest.json',
  'utf8',
));

const adminOnly = { user_condition: { role: 'admin' } };
const commonMigrationFields = [
  'environment', 'test_run_id', 'source_app_id', 'source_entity',
  'source_record_id', 'source_created_date', 'source_updated_date',
  'migration_batch_id', 'migration_direction', 'migrated_at',
  'source_content_hash', 'migration_version',
];

describe('ProFormEmailVerificationAttempt schema', () => {
  it('parses without duplicate keys and exposes the exact optional framework entity', () => {
    const treeErrors = [];
    const tree = parseTree(source, treeErrors, {
      allowTrailingComma: false,
      disallowComments: false,
    });
    expect(errors).toEqual([]);
    expect(treeErrors).toEqual([]);
    expect(tree).toBeTruthy();
    expect(schema.name).toBe('ProFormEmailVerificationAttempt');
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(['attempt_id', 'environment']);
    expect(Object.keys(schema.properties)).toHaveLength(29);
  });

  it('declares exact methods/statuses, timestamp formats, and migration metadata', () => {
    expect(schema.properties.verification_method.enum).toEqual(['otp', 'magic_link']);
    expect(schema.properties.status.enum).toEqual([
      'pending', 'verified', 'expired', 'locked', 'consumed', 'cancelled',
    ]);
    for (const field of [
      'requested_at', 'expires_at', 'verified_at', 'consumed_at',
      'source_created_date', 'source_updated_date', 'migrated_at',
    ]) {
      expect(schema.properties[field]).toMatchObject({ type: 'string', format: 'date-time' });
    }
    for (const field of commonMigrationFields) expect(schema.properties[field]).toBeDefined();
  });

  it('is admin-only for every entity operation and protects all required hashes', () => {
    expect(schema.rls).toEqual({
      create: adminOnly,
      read: adminOnly,
      update: adminOnly,
      delete: adminOnly,
    });
    for (const field of [
      'recovery_email_lookup_hash', 'verification_token_hash', 'device_hash',
      'ip_hash', 'redirect_path_hash', 'email_provider_message_id',
    ]) {
      expect(schema.properties[field].rls).toEqual({
        read: adminOnly,
        write: adminOnly,
      });
    }
  });

  it('contains no raw email, OTP, magic token, IP, device, or public URL field', () => {
    const names = Object.keys(schema.properties);
    for (const forbidden of [
      'email', 'raw_email', 'otp', 'otp_code', 'magic_link_token', 'raw_token',
      'ip_address', 'device_id', 'redirect_url', 'recovery_session_token',
    ]) expect(names).not.toContain(forbidden);
    expect(source).not.toMatch(/"(raw_otp|raw_magic|request_body|email_body)"\s*:/u);
  });

  it('is represented in the nondeployable field manifest', () => {
    const plan = manifest.securityEntities.ProFormEmailVerificationAttempt;
    expect(manifest.nonDeployable).toBe(true);
    expect(plan.schemaFile).toBe(schemaPath);
    expect(plan.implementationStatus).toBe('local_schema_implemented_not_pushed');
    expect(plan.required).toEqual(schema.required);
    expect(Object.keys(plan.fields)).toEqual(Object.keys(schema.properties));
    expect(plan.entityRls).toEqual(schema.rls);
  });
});
