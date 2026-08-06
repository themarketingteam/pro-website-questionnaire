import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse, parseTree } from 'jsonc-parser';
import { describe, expect, it } from 'vitest';

const REPOSITORY_ROOT = path.resolve(process.cwd());
const MANIFEST = JSON.parse(readFileSync(path.join(
  REPOSITORY_ROOT,
  'docs/durable-draft-recovery/data/pro-form-field-manifest.json',
), 'utf8'));
const ADMIN_BACKEND_ONLY_RLS = {
  read: { user_condition: { role: 'admin' } },
  write: { user_condition: { role: 'admin' } },
};
const COMMON_MIGRATION_FIELDS = MANIFEST.commonMigrationFields;
const TARGETS = [
  'ProFormDraftEvent',
  'ProFormSubmission',
  'ProFormSubmissionIntake',
];
const FIXTURE_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  'src/test/fixtures/pro-form-entity-schemas',
);
const EXPECTED_INTAKE_STATUS = [
  'submitted',
  'received_intake',
  'retry_pending',
  'retry_success',
  'retry_failed',
  'abandoned',
];

const schemaSources = Object.fromEntries(Object.entries(MANIFEST.entities).map(([name, plan]) => {
  const text = readFileSync(path.join(REPOSITORY_ROOT, plan.schemaFile), 'utf8');
  const errors = [];
  const schema = parse(text, errors, { allowTrailingComma: false, disallowComments: false });
  return [name, { text, errors, schema }];
}));

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
};

const sha256Stable = (value) => createHash('sha256')
  .update(JSON.stringify(stableValue(value)))
  .digest('hex');

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

function validateValue(value, schema, pointer, errors) {
  const actualType = Array.isArray(value) ? 'array' : typeof value;
  if (actualType !== schema.type) {
    errors.push(`type:${pointer}`);
    return;
  }
  if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) {
    errors.push(`date-time:${pointer}`);
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`enum:${pointer}`);
  if (schema.type === 'object') {
    for (const requiredField of schema.required || []) {
      if (!Object.hasOwn(value, requiredField)) errors.push(`missing:${pointer}/${requiredField}`);
    }
    for (const [fieldName, childValue] of Object.entries(value)) {
      const childSchema = schema.properties?.[fieldName];
      if (!childSchema) {
        errors.push(`unknown:${pointer}/${fieldName}`);
      } else {
        validateValue(childValue, childSchema, `${pointer}/${fieldName}`, errors);
      }
    }
  }
  if (schema.type === 'array') {
    value.forEach((child, index) => validateValue(child, schema.items, `${pointer}/${index}`, errors));
  }
}

function validateFixture(fixtureName, entityName) {
  const fixture = JSON.parse(readFileSync(path.join(FIXTURE_DIRECTORY, fixtureName), 'utf8'));
  const errors = [];
  validateValue(fixture, schemaSources[entityName].schema, entityName, errors);
  return { fixture, errors };
}

describe('Pro Form migration entity schema extensions', () => {
  it('parses every schema without duplicate properties or new missing descriptions', () => {
    for (const [entityName, source] of Object.entries(schemaSources)) {
      const treeErrors = [];
      const tree = parseTree(source.text, treeErrors, {
        allowTrailingComma: false,
        disallowComments: false,
      });
      expect(source.errors, entityName).toEqual([]);
      expect(treeErrors, entityName).toEqual([]);
      expect(duplicateKeys(tree), entityName).toEqual([]);

      const exceptions = new Set(MANIFEST.entities[entityName].legacyDescriptionExceptions);
      const visit = (fieldSchema, pointer) => {
        if (!pointer.endsWith('/items') && !exceptions.has(pointer)) {
          expect(fieldSchema.description?.trim(), `${entityName}${pointer}`).toBeTruthy();
        }
        for (const [name, child] of Object.entries(fieldSchema.properties || {})) {
          visit(child, `${pointer}/properties/${name}`);
        }
        if (fieldSchema.items?.type === 'object') visit(fieldSchema.items, `${pointer}/items`);
      };
      for (const [fieldName, fieldSchema] of Object.entries(source.schema.properties)) {
        visit(fieldSchema, `/properties/${fieldName}`);
      }
    }
  });

  it('preserves Event identity, required fields, legacy properties, and optional idempotency fields', () => {
    const { schema } = schemaSources.ProFormDraftEvent;
    const plan = MANIFEST.entities.ProFormDraftEvent;
    expect(schema.name).toBe('ProFormDraftEvent');
    expect(schema.required).toEqual(['session_id']);
    expect(schema.rls).toBeUndefined();
    expect(sha256Stable(Object.fromEntries(Object.keys(plan.existingFields).map((field) => [
      field,
      schema.properties[field],
    ])))).toBe(plan.baselineExistingPropertiesSha256);
    expect(plan.proposedFields).toHaveLength(25);
    for (const field of ['event_id', 'client_revision', 'server_revision', 'source_tab_id', 'mutation_id']) {
      expect(schema.properties[field], field).toBeDefined();
      expect(schema.required).not.toContain(field);
    }
    expect(schema.properties.value_json).toMatchObject({ type: 'string' });
  });

  it('preserves the full Submission metadata/userdata shape and adds only optional top-level linkage', () => {
    const { schema } = schemaSources.ProFormSubmission;
    const plan = MANIFEST.entities.ProFormSubmission;
    expect(schema.name).toBe('ProFormSubmission');
    expect(schema.required).toEqual(['metadata', 'userdata']);
    expect(schema.properties.metadata.properties).toHaveProperty('businessDomain');
    expect(schema.properties.metadata.properties).toHaveProperty('business_name');
    expect(schema.properties.userdata.properties).toHaveProperty('additional_pages_list');
    expect(schema.properties.userdata.properties).toHaveProperty('additional_notes');
    expect(sha256Stable({
      metadata: schema.properties.metadata,
      userdata: schema.properties.userdata,
    })).toBe(plan.baselineExistingPropertiesSha256);
    expect(plan.proposedFields).toHaveLength(16);
    for (const field of plan.proposedFields) expect(schema.required).not.toContain(field);
  });

  it('preserves Intake required/status/RLS/retry/Zapier/AI contracts', () => {
    const { schema } = schemaSources.ProFormSubmissionIntake;
    const plan = MANIFEST.entities.ProFormSubmissionIntake;
    expect(schema.name).toBe('ProFormSubmissionIntake');
    expect(schema.required).toEqual(['questionnaire_session_id']);
    expect(schema.properties.status).toMatchObject({
      type: 'string',
      enum: EXPECTED_INTAKE_STATUS,
      default: 'received_intake',
    });
    expect(schema.rls).toEqual(plan.expectedRls);
    for (const field of [
      'retry_count', 'retry_error_json', 'linked_submission_id', 'zapier_sent',
      'ai_repair_status', 'ai_repair_attempt_count', 'ai_repair_retry_result_json',
    ]) expect(schema.properties[field], field).toBeDefined();
    expect(schema.properties.zapier_sent).toMatchObject({ type: 'boolean', default: false });
    expect(schema.properties.zapier_suppressed).toMatchObject({ type: 'boolean', default: false });
    expect(schema.properties.zapier_redirected).toMatchObject({ type: 'boolean', default: false });
    expect(plan.proposedFields).toHaveLength(18);
    for (const field of plan.proposedFields) expect(schema.required).not.toContain(field);
  });

  it('uses consistent common migration types and exact admin-only FLS across all four entities', () => {
    for (const fieldName of COMMON_MIGRATION_FIELDS) {
      const definition = MANIFEST.fieldDefinitions[fieldName];
      for (const [entityName, { schema }] of Object.entries(schemaSources)) {
        const actual = schema.properties[fieldName];
        expect(actual.type, `${entityName}.${fieldName}`).toBe(definition.type);
        expect(actual.format, `${entityName}.${fieldName}`).toBe(definition.format);
        expect(actual.rls, `${entityName}.${fieldName}`).toEqual(ADMIN_BACKEND_ONLY_RLS);
      }
    }

    for (const entityName of TARGETS) {
      const { schema } = schemaSources[entityName];
      for (const fieldName of MANIFEST.entities[entityName].proposedFields) {
        expect(schema.properties[fieldName].rls, `${entityName}.${fieldName}`)
          .toEqual(ADMIN_BACKEND_ONLY_RLS);
      }
    }
  });

  it('contains no raw recovery code, token, grant, or credential field', () => {
    const forbidden = new Set([
      'recovery_code',
      'raw_recovery_code',
      'resume_token',
      'recovery_session_token',
      'draft_access_token',
      'signed_invitation_token',
      'admin_grant',
      'provider_credential',
    ]);
    for (const [entityName, { schema }] of Object.entries(schemaSources)) {
      for (const fieldName of Object.keys(schema.properties)) {
        expect(forbidden.has(fieldName), `${entityName}.${fieldName}`).toBe(false);
      }
    }
  });

  it.each([
    ['legacy-pro-form-draft-event.json', 'ProFormDraftEvent'],
    ['extended-pro-form-draft-event.json', 'ProFormDraftEvent'],
    ['legacy-pro-form-submission.json', 'ProFormSubmission'],
    ['extended-pro-form-submission.json', 'ProFormSubmission'],
    ['legacy-pro-form-submission-intake.json', 'ProFormSubmissionIntake'],
    ['extended-pro-form-submission-intake.json', 'ProFormSubmissionIntake'],
  ])('validates strict synthetic fixture %s', (fixtureName, entityName) => {
    const { fixture, errors } = validateFixture(fixtureName, entityName);
    expect(fixture).toBeTypeOf('object');
    expect(errors).toEqual([]);
  });
});
