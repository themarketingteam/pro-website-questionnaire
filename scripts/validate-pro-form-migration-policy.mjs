#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, parseTree, printParseErrorCode } from 'jsonc-parser';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POLICY_PATH = path.join(ROOT, 'config/pro-form-migration-entity-policy.json');
const ENTITY_DIRECTORY = path.join(ROOT, 'base44/entities');
const REQUIRED_MIGRATABLE = new Set([
  'ProFormDraft',
  'ProFormDraftEvent',
  'ProFormSubmission',
  'ProFormSubmissionIntake',
]);
const ALLOWED_POLICIES = new Set([
  'required',
  'required_if_present',
  'environment_local',
  'audit_optional',
  'never_migrate',
  'manual_review',
]);
const REQUIRED_POLICY_FIELDS = [
  'entityName',
  'migrationPolicy',
  'reverseMigrationPolicy',
  'dependencyOrder',
  'logicalIdentityFields',
  'relationshipFields',
  'serverManagedFields',
  'excludedFields',
  'sensitiveFields',
  'contentHashExcludedFields',
  'fileReferencePaths',
  'productionAllowed',
  'stagingAllowed',
  'testRecordPolicy',
  'conflictPolicy',
  'retentionPolicy',
];
const ORIGIN_FIELDS = {
  origin_app_id: { type: 'string' },
  origin_entity: { type: 'string' },
  origin_record_id: { type: 'string' },
  origin_created_at: { type: 'string', format: 'date-time' },
  origin_updated_at: { type: 'string', format: 'date-time' },
};
const ADMIN_FIELD_RLS = {
  read: { user_condition: { role: 'admin' } },
  write: { user_condition: { role: 'admin' } },
};
const ADMIN_ENTITY_RLS = {
  create: { user_condition: { role: 'admin' } },
  read: { user_condition: { role: 'admin' } },
  update: { user_condition: { role: 'admin' } },
  delete: { user_condition: { role: 'admin' } },
};
const HASH_MEANINGFUL_PATTERN = /(?:answer|response|value_json|metadata|userdata|draft_state)/iu;
const violations = [];

const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
};
const equal = (left, right) => JSON.stringify(stable(left)) === JSON.stringify(stable(right));
const violation = (code, location) => violations.push(`${code}:${location}`);
const escapePointer = (value) => String(value).replace(/~/gu, '~0').replace(/\//gu, '~1');

function duplicateKeys(node, location, pointer = '') {
  if (!node) return;
  if (node.type === 'object') {
    const seen = new Set();
    for (const property of node.children ?? []) {
      const key = String(property.children?.[0]?.value ?? '');
      const childPointer = `${pointer}/${escapePointer(key)}`;
      if (seen.has(key)) violation('DUPLICATE_PROPERTY', `${location}${childPointer}`);
      seen.add(key);
      duplicateKeys(property.children?.[1], location, childPointer);
    }
  } else if (node.type === 'array') {
    (node.children ?? []).forEach((child, index) => {
      duplicateKeys(child, location, `${pointer}/${index}`);
    });
  }
}

function readStrictPolicy() {
  const text = fs.readFileSync(POLICY_PATH, 'utf8');
  const errors = [];
  const tree = parseTree(text, errors, { allowTrailingComma: false, disallowComments: true });
  errors.forEach((error) => violation(
    `POLICY_${printParseErrorCode(error.error)}`,
    `config/pro-form-migration-entity-policy.json@${error.offset}`,
  ));
  duplicateKeys(tree, 'config/pro-form-migration-entity-policy.json');
  try {
    return JSON.parse(text);
  } catch {
    violation('POLICY_INVALID_JSON', 'config/pro-form-migration-entity-policy.json');
    return { entities: [] };
  }
}

function readSchemas() {
  const schemas = new Map();
  for (const fileName of fs.readdirSync(ENTITY_DIRECTORY).filter((name) => name.endsWith('.jsonc'))) {
    const relative = `base44/entities/${fileName}`;
    const text = fs.readFileSync(path.join(ENTITY_DIRECTORY, fileName), 'utf8');
    const errors = [];
    const schema = parse(text, errors, { allowTrailingComma: false, disallowComments: false });
    const treeErrors = [];
    const tree = parseTree(text, treeErrors, {
      allowTrailingComma: false,
      disallowComments: false,
    });
    [...errors, ...treeErrors].forEach((error) => violation(
      `SCHEMA_${printParseErrorCode(error.error)}`,
      `${relative}@${error.offset}`,
    ));
    duplicateKeys(tree, relative);
    if (!schema?.name) violation('SCHEMA_NAME_REQUIRED', relative);
    else if (schemas.has(schema.name)) violation('SCHEMA_ENTITY_DUPLICATE', schema.name);
    else schemas.set(schema.name, { schema, relative });
  }
  return schemas;
}

function resolveSchemaPath(schema, fieldPath) {
  let current = schema;
  for (const rawPart of String(fieldPath).split('.')) {
    const arrayPart = rawPart.endsWith('[]');
    const part = rawPart.replace(/\[\]$/u, '');
    current = current?.properties?.[part];
    if (!current) return null;
    if (arrayPart) current = current.items;
  }
  return current ?? null;
}

const policy = readStrictPolicy();
const schemas = readSchemas();
const entries = Array.isArray(policy.entities) ? policy.entities : [];
const policyByEntity = new Map();
const dependencyOrders = new Set();

if (!equal(policy.supportedDirections, ['blue_to_green', 'green_to_blue'])) {
  violation('SUPPORTED_DIRECTIONS_INVALID', 'manifest');
}
if (policy.singleActiveDirectionRequired !== true) {
  violation('SINGLE_ACTIVE_DIRECTION_REQUIRED', 'manifest');
}
if (policy.defaultNoDelete !== true) violation('DEFAULT_NO_DELETE_REQUIRED', 'manifest');

for (const [index, entry] of entries.entries()) {
  const location = `entities[${index}]`;
  for (const field of REQUIRED_POLICY_FIELDS) {
    if (!Object.hasOwn(entry, field)) violation('POLICY_FIELD_REQUIRED', `${location}.${field}`);
  }
  if (typeof entry.entityName !== 'string' || entry.entityName === '') {
    violation('ENTITY_NAME_INVALID', location);
    continue;
  }
  if (policyByEntity.has(entry.entityName)) violation('ENTITY_POLICY_DUPLICATE', entry.entityName);
  policyByEntity.set(entry.entityName, entry);

  if (!ALLOWED_POLICIES.has(entry.migrationPolicy)) {
    violation('MIGRATION_POLICY_INVALID', entry.entityName);
  }
  if (!ALLOWED_POLICIES.has(entry.reverseMigrationPolicy)) {
    violation('REVERSE_MIGRATION_POLICY_INVALID', entry.entityName);
  }
  if (!Number.isSafeInteger(entry.dependencyOrder) || entry.dependencyOrder < 1) {
    violation('DEPENDENCY_ORDER_INVALID', entry.entityName);
  } else if (dependencyOrders.has(entry.dependencyOrder)) {
    violation('DEPENDENCY_ORDER_DUPLICATE', String(entry.dependencyOrder));
  } else dependencyOrders.add(entry.dependencyOrder);

  if (entry.stagingAllowed !== false) violation('STAGING_MIGRATION_MUST_BE_DISABLED', entry.entityName);
  if (entry.testRecordPolicy !== 'never_migrate') {
    violation('TEST_RECORD_POLICY_INVALID', entry.entityName);
  }

  const source = schemas.get(entry.entityName);
  if (!source) {
    violation('CLASSIFIED_SCHEMA_MISSING', entry.entityName);
    continue;
  }
  for (const relationship of Array.isArray(entry.relationshipFields)
    ? entry.relationshipFields
    : []) {
    if (!resolveSchemaPath(source.schema, relationship.path)) {
      violation('RELATIONSHIP_PATH_MISSING', `${entry.entityName}.${relationship.path}`);
    }
    if (!schemas.has(relationship.targetEntity)) {
      violation('RELATIONSHIP_TARGET_MISSING', `${entry.entityName}.${relationship.targetEntity}`);
    }
  }
  for (const fieldName of Array.isArray(entry.sensitiveFields) ? entry.sensitiveFields : []) {
    if (!resolveSchemaPath(source.schema, fieldName)) {
      violation('SENSITIVE_FIELD_MISSING', `${entry.entityName}.${fieldName}`);
    }
  }
  for (const fieldName of Array.isArray(entry.contentHashExcludedFields)
    ? entry.contentHashExcludedFields
    : []) {
    if (HASH_MEANINGFUL_PATTERN.test(fieldName)) {
      violation('MEANINGFUL_CONTENT_HASH_EXCLUSION', `${entry.entityName}.${fieldName}`);
    }
    if (!resolveSchemaPath(source.schema, fieldName)
      && !entry.serverManagedFields.includes(fieldName)) {
      violation('CONTENT_HASH_EXCLUSION_MISSING', `${entry.entityName}.${fieldName}`);
    }
  }
  for (const fieldPath of Array.isArray(entry.fileReferencePaths)
    ? entry.fileReferencePaths
    : []) {
    if (!resolveSchemaPath(source.schema, fieldPath)) {
      violation('FILE_REFERENCE_PATH_MISSING', `${entry.entityName}.${fieldPath}`);
    }
  }
}

for (const entityName of schemas.keys()) {
  if (!policyByEntity.has(entityName)) violation('ENTITY_UNCLASSIFIED', entityName);
}
for (const [entityName, entry] of policyByEntity.entries()) {
  if (!schemas.has(entityName)) violation('POLICY_WITHOUT_ENTITY', entityName);
  if (REQUIRED_MIGRATABLE.has(entityName)
    && (entry.migrationPolicy !== 'required' || entry.reverseMigrationPolicy !== 'required')) {
    violation('REQUIRED_ENTITY_POLICY_INVALID', entityName);
  }
}

for (const entityName of REQUIRED_MIGRATABLE) {
  const schema = schemas.get(entityName)?.schema;
  if (!schema) continue;
  for (const [fieldName, definition] of Object.entries(ORIGIN_FIELDS)) {
    const actual = schema.properties?.[fieldName];
    if (!actual) {
      violation('ORIGIN_FIELD_MISSING', `${entityName}.${fieldName}`);
      continue;
    }
    if (actual.type !== definition.type || actual.format !== definition.format) {
      violation('ORIGIN_FIELD_TYPE_INVALID', `${entityName}.${fieldName}`);
    }
    if (!equal(actual.rls, ADMIN_FIELD_RLS)) {
      violation('ORIGIN_FIELD_RLS_INVALID', `${entityName}.${fieldName}`);
    }
    if (schema.required?.includes(fieldName)) {
      violation('ORIGIN_FIELD_MUST_BE_OPTIONAL', `${entityName}.${fieldName}`);
    }
  }
}

for (const [entityName, required] of [
  ['ProFormMigrationIdMap', [
    'source_app_id', 'source_entity', 'source_record_id',
    'destination_app_id', 'destination_entity', 'destination_record_id',
  ]],
  ['ProFormMigrationConflict', ['conflict_id', 'environment']],
]) {
  const schema = schemas.get(entityName)?.schema;
  if (!schema) continue;
  if (!equal(schema.required, required)) violation('CONTROL_ENTITY_REQUIRED_INVALID', entityName);
  if (!equal(schema.rls, ADMIN_ENTITY_RLS)) violation('CONTROL_ENTITY_RLS_INVALID', entityName);
}

const identitySourcePath = path.join(
  ROOT,
  'base44/functions/_shared/proDraftIdentity/entry.ts',
);
const identitySource = fs.readFileSync(identitySourcePath, 'utf8');
for (const requiredText of [
  'getLogicalCreatedAt',
  "'origin_record_id', 'source_record_id'",
]) {
  if (!identitySource.includes(requiredText)) {
    violation('LOGICAL_SELECTION_CONTRACT_MISSING', requiredText);
  }
}

if (violations.length > 0) {
  console.error('MIGRATION_POLICY_INVALID');
  violations.sort().forEach((item) => console.error(item));
  process.exit(1);
}

console.log(`MIGRATION_POLICY_VALID: ${schemas.size} entities classified`);
