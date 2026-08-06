import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'jsonc-parser';
import { describe, expect, it } from 'vitest';

const ADMIN_ONLY = { user_condition: { role: 'admin' } };
const ADMIN_ENTITY_RLS = {
  create: ADMIN_ONLY,
  read: ADMIN_ONLY,
  update: ADMIN_ONLY,
  delete: ADMIN_ONLY,
};
const PATHS = {
  ProFormDraft: 'base44/entities/ProFormDraft.jsonc',
  ProFormDraftEvent: 'base44/entities/ProFormDraftEvent.jsonc',
  ProFormRecoverySecurityEvent: 'base44/entities/ProFormRecoverySecurityEvent.jsonc',
  ProFormEmailVerificationAttempt: 'base44/entities/ProFormEmailVerificationAttempt.jsonc',
  ProFormSubmission: 'base44/entities/ProFormSubmission.jsonc',
  ProFormSubmissionIntake: 'base44/entities/ProFormSubmissionIntake.jsonc',
};
const EXPECTED_REQUIRED = {
  ProFormDraft: ['session_id'],
  ProFormDraftEvent: ['session_id'],
  ProFormRecoverySecurityEvent: ['request_id', 'environment'],
  ProFormEmailVerificationAttempt: ['attempt_id', 'environment'],
};
const EXCLUDED_SCHEMA_SHA256 = {
  ProFormSubmission: '62bceebf3f2ada03ca4cf787222b5639517d43e9674878cbb29a4247598a9f66',
  ProFormSubmissionIntake: 'a809858129984d17eba2f9115de2bfa033fb6f723e2680c45115cbe3a38b7be4',
};

const sources = Object.fromEntries(Object.entries(PATHS).map(([name, file]) => (
  [name, readFileSync(file, 'utf8')]
)));
const schemas = Object.fromEntries(Object.entries(sources).map(([name, source]) => {
  const errors = [];
  const schema = parse(source, errors, { allowTrailingComma: false, disallowComments: false });
  if (errors.length > 0) throw new Error(`SCHEMA_PARSE_FAILED:${name}`);
  return [name, schema];
}));
const manifest = JSON.parse(readFileSync(
  'docs/durable-draft-recovery/data/pro-form-field-manifest.json',
  'utf8',
));

describe('draft-recovery entity RLS contract', () => {
  it.each(Object.keys(EXPECTED_REQUIRED))('%s is admin-only for every entity operation', (name) => {
    expect(schemas[name].rls).toEqual(ADMIN_ENTITY_RLS);
  });

  it('preserves entity identity, required fields, and every declared property', () => {
    for (const [name, required] of Object.entries(EXPECTED_REQUIRED)) {
      expect(schemas[name].name).toBe(name);
      expect(schemas[name].type).toBe('object');
      expect(schemas[name].required).toEqual(required);
    }
    for (const name of ['ProFormDraft', 'ProFormDraftEvent']) {
      const plan = manifest.entities[name];
      const expectedFields = new Set([
        ...Object.keys(plan.existingFields),
        ...plan.proposedFields,
      ]);
      expect(new Set(Object.keys(schemas[name].properties))).toEqual(expectedFields);
    }
  });

  it('preserves admin-only field security on every protected draft/event field', () => {
    const expectedFieldRls = { read: ADMIN_ONLY, write: ADMIN_ONLY };
    for (const name of ['ProFormDraft', 'ProFormDraftEvent']) {
      for (const field of manifest.entities[name].proposedFields) {
        expect(schemas[name].properties[field].rls, `${name}.${field}`)
          .toEqual(expectedFieldRls);
      }
    }
    for (const name of ['ProFormRecoverySecurityEvent', 'ProFormEmailVerificationAttempt']) {
      for (const [field, definition] of Object.entries(schemas[name].properties)) {
        if (definition.rls) expect(definition.rls, `${name}.${field}`).toEqual(expectedFieldRls);
      }
    }
  });

  it('freezes the approved submission and intake origin-field extensions', () => {
    for (const [name, expected] of Object.entries(EXCLUDED_SCHEMA_SHA256)) {
      const actual = createHash('sha256').update(sources[name]).digest('hex');
      expect(actual, name).toBe(expected);
    }
  });
});
