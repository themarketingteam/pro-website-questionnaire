#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parse,
  parseTree,
  printParseErrorCode,
} from 'jsonc-parser';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const MANIFEST_RELATIVE_PATH = 'docs/durable-draft-recovery/data/pro-form-field-manifest.json';
const MANIFEST_PATH = path.join(REPO_ROOT, MANIFEST_RELATIVE_PATH);

const EXPECTED_ENTITIES = Object.freeze([
  'ProFormDraft',
  'ProFormDraftEvent',
  'ProFormSubmission',
  'ProFormSubmissionIntake',
]);

const EXPECTED_CLASSIFICATIONS = Object.freeze([
  'public_compatibility',
  'admin_only',
  'backend_only',
  'sensitive_pii',
  'sensitive_hash',
  'migration_metadata',
  'audit_metadata',
  'retention_metadata',
  'test_metadata',
  'canonical_state',
  'submission_lock',
]);

const EXPECTED_COMMON_MIGRATION_TYPES = Object.freeze({
  environment: { type: 'string' },
  test_run_id: { type: 'string' },
  source_app_id: { type: 'string' },
  source_entity: { type: 'string' },
  source_record_id: { type: 'string' },
  source_created_date: { type: 'string', format: 'date-time' },
  source_updated_date: { type: 'string', format: 'date-time' },
  migration_batch_id: { type: 'string' },
  migration_direction: { type: 'string' },
  migrated_at: { type: 'string', format: 'date-time' },
  source_content_hash: { type: 'string' },
  migration_version: { type: 'number' },
});

const EXPECTED_ADMIN_BACKEND_ONLY_RLS = Object.freeze({
  read: { user_condition: { role: 'admin' } },
  write: { user_condition: { role: 'admin' } },
});

const REQUIRED_GROUP_POLICY_FIELDS = Object.freeze([
  'canonicalStateSource',
  'legacyFallback',
  'migrationBehavior',
  'adminProjectionBehavior',
  'retentionBehavior',
  'testRequirement',
]);

const IMPLEMENTATION_STATUSES = new Set([
  'planned',
  'local_schema_implemented_not_pushed',
]);

const SUPPORTED_TYPES = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'array',
  'object',
  'binary',
]);

const ALLOWED_ARGS = new Set(['--plan-only']);
const args = process.argv.slice(2);
const planOnly = args.includes('--plan-only');
const violations = [];

const addViolation = (code, location) => {
  violations.push(`${code}:${location}`);
};

const isRecord = (value) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
);

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
};

const valuesEqual = (left, right) => (
  JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right))
);

const unique = (values) => new Set(values).size === values.length;

const escapePointer = (value) => String(value).replace(/~/gu, '~0').replace(/\//gu, '~1');

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

const readStrictJson = (filePath) => {
  const text = fs.readFileSync(filePath, 'utf8');
  const parseErrors = [];
  const tree = parseTree(text, parseErrors, {
    allowTrailingComma: false,
    disallowComments: true,
  });
  for (const error of parseErrors) {
    addViolation(
      `MANIFEST_JSON_${printParseErrorCode(error.error)}`,
      `${MANIFEST_RELATIVE_PATH}@${error.offset}`,
    );
  }
  if (tree) collectDuplicateKeys(tree, '', MANIFEST_RELATIVE_PATH);
  try {
    return JSON.parse(text);
  } catch {
    addViolation('MANIFEST_INVALID_JSON', MANIFEST_RELATIVE_PATH);
    return null;
  }
};

const readJsoncSchema = (relativePath) => {
  const absolutePath = path.join(REPO_ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) {
    addViolation('ENTITY_FILE_MISSING', relativePath);
    return null;
  }
  const text = fs.readFileSync(absolutePath, 'utf8');
  const parseErrors = [];
  const schema = parse(text, parseErrors, {
    allowTrailingComma: false,
    disallowComments: false,
  });
  const treeErrors = [];
  const tree = parseTree(text, treeErrors, {
    allowTrailingComma: false,
    disallowComments: false,
  });
  for (const error of [...parseErrors, ...treeErrors]) {
    addViolation(
      `ENTITY_JSONC_${printParseErrorCode(error.error)}`,
      `${relativePath}@${error.offset}`,
    );
  }
  if (!isRecord(schema) || !tree || parseErrors.length > 0 || treeErrors.length > 0) {
    return null;
  }
  return { absolutePath, relativePath, text, schema, tree };
};

const collectDuplicateKeys = (node, pointer, relativePath) => {
  if (!node) return;
  if (node.type === 'object') {
    const seen = new Set();
    for (const propertyNode of node.children || []) {
      if (propertyNode.type !== 'property') continue;
      const keyNode = propertyNode.children?.[0];
      const valueNode = propertyNode.children?.[1];
      const key = String(keyNode?.value ?? '');
      const childPointer = `${pointer}/${escapePointer(key)}`;
      if (seen.has(key)) addViolation('DUPLICATE_JSON_PROPERTY', `${relativePath}${childPointer}`);
      seen.add(key);
      collectDuplicateKeys(valueNode, childPointer, relativePath);
    }
  } else if (node.type === 'array') {
    (node.children || []).forEach((child, index) => {
      collectDuplicateKeys(child, `${pointer}/${index}`, relativePath);
    });
  }
};

const collectMissingDescriptions = (schemaNode, pointer = '') => {
  const missing = [];
  if (!isRecord(schemaNode)) return missing;
  if (isRecord(schemaNode.properties)) {
    for (const [fieldName, fieldSchema] of Object.entries(schemaNode.properties)) {
      const fieldPointer = `${pointer}/properties/${escapePointer(fieldName)}`;
      if (
        !isRecord(fieldSchema)
        || typeof fieldSchema.description !== 'string'
        || fieldSchema.description.trim() === ''
      ) {
        missing.push(fieldPointer);
      }
      missing.push(...collectMissingDescriptions(fieldSchema, fieldPointer));
    }
  }
  if (isRecord(schemaNode.items)) {
    missing.push(...collectMissingDescriptions(schemaNode.items, `${pointer}/items`));
  }
  return missing;
};

const isForbiddenRawSecretField = (fieldName) => {
  const normalized = String(fieldName || '').toLowerCase();
  if (
    normalized === 'recovery_code'
    || normalized === 'raw_recovery_code'
    || normalized === 'recovery_code_value'
    || normalized === 'recovery_code_normalized_input'
  ) return true;
  if (normalized.includes('grant')) return true;
  if (normalized.includes('token') && !normalized.endsWith('_token_hash')) return true;
  return [
    'resume_token',
    'recovery_session_token',
    'draft_access_token',
    'signed_invitation_token',
  ].includes(normalized);
};

const validateManifestDefinition = (fieldName, definition, manifest) => {
  const location = `${MANIFEST_RELATIVE_PATH}#/fieldDefinitions/${fieldName}`;
  if (!isRecord(definition)) {
    addViolation('FIELD_DEFINITION_INVALID', location);
    return;
  }
  if (!SUPPORTED_TYPES.has(definition.type)) addViolation('FIELD_TYPE_INVALID', location);
  if (definition.required !== false) addViolation('PROPOSED_FIELD_REQUIRED', location);
  if (typeof definition.sensitive !== 'boolean') addViolation('SENSITIVE_FLAG_MISSING', location);
  if (!Array.isArray(definition.classifications) || definition.classifications.length === 0) {
    addViolation('CLASSIFICATION_MISSING', location);
  } else {
    for (const classification of definition.classifications) {
      if (!manifest.classifications.includes(classification)) {
        addViolation('CLASSIFICATION_UNSUPPORTED', `${location}/${classification}`);
      }
    }
    if (!unique(definition.classifications)) addViolation('CLASSIFICATION_DUPLICATE', location);
  }
  if (
    definition.sensitive === true
    && !definition.classifications?.some((classification) => (
      classification === 'sensitive_pii'
      || classification === 'sensitive_hash'
      || classification === 'admin_only'
    ))
  ) addViolation('SENSITIVE_CLASSIFICATION_REQUIRED', location);
  if (definition.fieldLevelRlsRequirement !== 'admin_backend_only') {
    addViolation('FIELD_RLS_REQUIREMENT_INVALID', location);
  }
  if (typeof definition.migrationUse !== 'string' || definition.migrationUse.trim() === '') {
    addViolation('MIGRATION_USE_MISSING', location);
  }
  if (
    typeof definition.publicProjectionRule !== 'string'
    || definition.publicProjectionRule.trim() === ''
  ) addViolation('PUBLIC_PROJECTION_RULE_MISSING', location);
  if (typeof definition.description !== 'string' || definition.description.trim() === '') {
    addViolation('PROPOSED_DESCRIPTION_MISSING', location);
  }
  if (!isRecord(manifest.groupPolicies?.[definition.group])) {
    addViolation('GROUP_POLICY_MISSING', `${location}/${definition.group || 'missing'}`);
  }
  if (isForbiddenRawSecretField(fieldName)) addViolation('RAW_SECRET_FIELD_FORBIDDEN', location);
};

const validateManifest = (manifest) => {
  if (!isRecord(manifest)) return;
  if (manifest.manifestVersion !== 1) addViolation('MANIFEST_VERSION_INVALID', MANIFEST_RELATIVE_PATH);
  if (manifest.status !== 'mixed_local_implementation_not_pushed') {
    addViolation('MANIFEST_STATUS_INVALID', MANIFEST_RELATIVE_PATH);
  }
  if (manifest.nonDeployable !== true) addViolation('MANIFEST_MUST_BE_NON_DEPLOYABLE', MANIFEST_RELATIVE_PATH);
  if (manifest.manifestPath !== MANIFEST_RELATIVE_PATH) {
    addViolation('MANIFEST_PATH_MISMATCH', MANIFEST_RELATIVE_PATH);
  }
  const entityDirectory = path.resolve(REPO_ROOT, manifest.entityDirectory || '');
  if (MANIFEST_PATH === entityDirectory || MANIFEST_PATH.startsWith(`${entityDirectory}${path.sep}`)) {
    addViolation('MANIFEST_INSIDE_ENTITY_DIRECTORY', MANIFEST_RELATIVE_PATH);
  }
  if (
    !Array.isArray(manifest.classifications)
    || !unique(manifest.classifications)
    || !valuesEqual([...manifest.classifications].sort(), [...EXPECTED_CLASSIFICATIONS].sort())
  ) {
    addViolation('CLASSIFICATION_CATALOG_INVALID', MANIFEST_RELATIVE_PATH);
  }
  if (!valuesEqual(
    manifest.fieldLevelRlsPolicies?.admin_backend_only,
    EXPECTED_ADMIN_BACKEND_ONLY_RLS,
  )) {
    addViolation('ADMIN_BACKEND_FIELD_RLS_POLICY_INVALID', MANIFEST_RELATIVE_PATH);
  }
  for (const [groupName, policy] of Object.entries(manifest.groupPolicies || {})) {
    if (!isRecord(policy)) {
      addViolation('GROUP_POLICY_INVALID', `${MANIFEST_RELATIVE_PATH}#/groupPolicies/${groupName}`);
      continue;
    }
    for (const policyField of REQUIRED_GROUP_POLICY_FIELDS) {
      if (typeof policy[policyField] !== 'string' || policy[policyField].trim() === '') {
        addViolation(
          'GROUP_POLICY_ATTRIBUTE_MISSING',
          `${MANIFEST_RELATIVE_PATH}#/groupPolicies/${groupName}/${policyField}`,
        );
      }
    }
  }
  const entityNames = Object.keys(manifest.entities || {});
  if (!valuesEqual([...entityNames].sort(), [...EXPECTED_ENTITIES].sort())) {
    addViolation('ENTITY_SET_INVALID', `${MANIFEST_RELATIVE_PATH}#/entities`);
  }
  const commonFields = Object.keys(EXPECTED_COMMON_MIGRATION_TYPES);
  if (!valuesEqual(manifest.commonMigrationFields, commonFields)) {
    addViolation('COMMON_MIGRATION_FIELD_SET_INVALID', `${MANIFEST_RELATIVE_PATH}#/commonMigrationFields`);
  }
  for (const [fieldName, expected] of Object.entries(EXPECTED_COMMON_MIGRATION_TYPES)) {
    const definition = manifest.fieldDefinitions?.[fieldName];
    if (!definition) {
      addViolation('COMMON_MIGRATION_DEFINITION_MISSING', fieldName);
      continue;
    }
    if (definition.type !== expected.type || (expected.format && definition.format !== expected.format)) {
      addViolation('COMMON_MIGRATION_TYPE_MISMATCH', fieldName);
    }
  }
  for (const [fieldName, definition] of Object.entries(manifest.fieldDefinitions || {})) {
    validateManifestDefinition(fieldName, definition, manifest);
  }
  for (const entityName of EXPECTED_ENTITIES) {
    const entity = manifest.entities?.[entityName];
    if (!isRecord(entity)) continue;
    const implementationStatus = entity.implementationStatus || 'planned';
    if (!IMPLEMENTATION_STATUSES.has(implementationStatus)) {
      addViolation('IMPLEMENTATION_STATUS_INVALID', `${entityName}.${implementationStatus}`);
    }
    if (
      implementationStatus === 'local_schema_implemented_not_pushed'
      && !/^[a-f0-9]{64}$/u.test(entity.implementedSchemaSha256 || '')
    ) {
      addViolation('IMPLEMENTED_SCHEMA_HASH_MISSING', entityName);
    }
    const proposedFields = entity.proposedFields || [];
    if (!Array.isArray(proposedFields) || !unique(proposedFields)) {
      addViolation('PROPOSED_FIELD_LIST_INVALID', `${entityName}.proposedFields`);
      continue;
    }
    for (const fieldName of commonFields) {
      if (!proposedFields.includes(fieldName)) {
        addViolation('COMMON_MIGRATION_FIELD_MISSING', `${entityName}.${fieldName}`);
      }
    }
    for (const fieldName of proposedFields) {
      if (!manifest.fieldDefinitions?.[fieldName]) {
        addViolation('PROPOSED_FIELD_DEFINITION_MISSING', `${entityName}.${fieldName}`);
      }
      if (Object.hasOwn(entity.existingFields || {}, fieldName)) {
        addViolation('PROPOSED_FIELD_ALREADY_EXISTS', `${entityName}.${fieldName}`);
      }
    }
  }
};

const validateImplementedField = (entityName, fieldName, actual, definition, requiredSet, manifest) => {
  const location = `${entityName}.${fieldName}`;
  if (requiredSet.has(fieldName)) addViolation('NEW_FIELD_MUST_BE_OPTIONAL', location);
  if (actual.type !== definition.type) addViolation('PROPOSED_TYPE_MISMATCH', location);
  if (definition.format && actual.format !== definition.format) {
    addViolation('PROPOSED_FORMAT_MISMATCH', location);
  }
  if (definition.enum && !valuesEqual(actual.enum, definition.enum)) {
    addViolation('PROPOSED_ENUM_MISMATCH', location);
  }
  if (Object.hasOwn(definition, 'default') && !valuesEqual(actual.default, definition.default)) {
    addViolation('PROPOSED_DEFAULT_MISMATCH', location);
  }
  if (typeof actual.description !== 'string' || actual.description.trim() === '') {
    addViolation('PROPOSED_DESCRIPTION_MISSING', location);
  }
  const expectedRls = manifest.fieldLevelRlsPolicies?.[definition.fieldLevelRlsRequirement];
  if (!valuesEqual(actual.rls, expectedRls)) addViolation('PROPOSED_FIELD_RLS_MISMATCH', location);
};

const validateSchema = (entityName, entityPlan, manifest) => {
  if (!isRecord(entityPlan)) return;
  const loaded = readJsoncSchema(entityPlan.schemaFile);
  if (!loaded) return;
  const { schema, tree, text, relativePath } = loaded;
  collectDuplicateKeys(tree, '', relativePath);
  if (schema.name !== entityName) addViolation('ENTITY_NAME_CHANGED', relativePath);
  if (schema.type !== 'object') addViolation('ENTITY_TOP_LEVEL_TYPE_INVALID', relativePath);
  if (!isRecord(schema.properties)) addViolation('ENTITY_PROPERTIES_INVALID', relativePath);
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const actualFieldNames = Object.keys(properties);
  const existingFieldNames = Object.keys(entityPlan.existingFields || {});
  const documentedFieldNames = new Set([...existingFieldNames, ...(entityPlan.proposedFields || [])]);
  for (const fieldName of actualFieldNames) {
    if (!documentedFieldNames.has(fieldName)) addViolation('UNDOCUMENTED_SCHEMA_FIELD', `${entityName}.${fieldName}`);
    if (isForbiddenRawSecretField(fieldName)) addViolation('RAW_SECRET_FIELD_FORBIDDEN', `${entityName}.${fieldName}`);
  }
  for (const fieldName of existingFieldNames) {
    const baseline = entityPlan.existingFields[fieldName];
    const actual = properties[fieldName];
    if (!isRecord(actual)) {
      addViolation('EXISTING_FIELD_MISSING', `${entityName}.${fieldName}`);
      continue;
    }
    if (actual.type !== baseline.type) addViolation('EXISTING_TYPE_CHANGED', `${entityName}.${fieldName}`);
    if (baseline.enum && !valuesEqual(actual.enum, baseline.enum)) {
      addViolation('EXISTING_ENUM_CHANGED', `${entityName}.${fieldName}`);
    }
    if (Object.hasOwn(baseline, 'default') && !valuesEqual(actual.default, baseline.default)) {
      addViolation('EXISTING_DEFAULT_CHANGED', `${entityName}.${fieldName}`);
    }
  }
  if (entityPlan.baselineExistingPropertiesSha256) {
    const existingProperties = Object.fromEntries(existingFieldNames.map((fieldName) => [
      fieldName,
      properties[fieldName],
    ]));
    const existingPropertiesHash = sha256(JSON.stringify(stableValue(existingProperties)));
    if (existingPropertiesHash !== entityPlan.baselineExistingPropertiesSha256) {
      addViolation('EXISTING_PROPERTY_SCHEMA_CHANGED', entityName);
    }
  }
  const required = Array.isArray(schema.required) ? schema.required : [];
  if (!unique(required)) addViolation('DUPLICATE_REQUIRED_FIELD', entityName);
  if (!valuesEqual([...required].sort(), [...entityPlan.existingRequired].sort())) {
    addViolation('REQUIRED_FIELD_SET_CHANGED', entityName);
  }
  const requiredSet = new Set(required);
  const implementedFields = [];
  for (const fieldName of entityPlan.proposedFields || []) {
    if (isRecord(properties[fieldName])) {
      implementedFields.push(fieldName);
      validateImplementedField(
        entityName,
        fieldName,
        properties[fieldName],
        manifest.fieldDefinitions[fieldName],
        requiredSet,
        manifest,
      );
    }
  }
  const actualRls = schema.rls ?? null;
  if (!valuesEqual(actualRls, entityPlan.expectedRls)) addViolation('ENTITY_RLS_CHANGED', entityName);
  if (
    entityName === 'ProFormDraft'
    && (properties.status?.type !== 'string' || Object.hasOwn(properties.status || {}, 'enum'))
  ) {
    addViolation('DRAFT_STATUS_COMPATIBILITY_CHANGED', `${entityName}.status`);
  }
  const missingDescriptions = collectMissingDescriptions(schema);
  const exceptions = entityPlan.legacyDescriptionExceptions || [];
  for (const pointer of missingDescriptions) {
    if (!exceptions.includes(pointer)) addViolation('PROPERTY_DESCRIPTION_MISSING', `${entityName}${pointer}`);
  }
  for (const pointer of exceptions) {
    if (!missingDescriptions.includes(pointer)) {
      addViolation('STALE_DESCRIPTION_EXCEPTION', `${entityName}${pointer}`);
    }
  }
  const implementationStatus = entityPlan.implementationStatus || 'planned';
  if (implementationStatus === 'local_schema_implemented_not_pushed') {
    const missingImplementedFields = (entityPlan.proposedFields || []).filter((fieldName) => (
      !implementedFields.includes(fieldName)
    ));
    for (const fieldName of missingImplementedFields) {
      addViolation('IMPLEMENTED_FIELD_MISSING', `${entityName}.${fieldName}`);
    }
    const expectedFieldNames = [...existingFieldNames, ...(entityPlan.proposedFields || [])];
    if (!valuesEqual([...actualFieldNames].sort(), [...expectedFieldNames].sort())) {
      addViolation('IMPLEMENTED_FIELD_SET_MISMATCH', entityName);
    }
    if (sha256(text) !== entityPlan.implementedSchemaSha256) {
      addViolation('IMPLEMENTED_SCHEMA_HASH_CHANGED', entityName);
    }
  } else if (planOnly) {
    if (sha256(text) !== entityPlan.baselineSha256) addViolation('PLAN_BASELINE_SCHEMA_CHANGED', entityName);
    if (implementedFields.length > 0) addViolation('PLAN_ONLY_SCHEMA_EXTENSION_DETECTED', entityName);
    if (!valuesEqual([...actualFieldNames].sort(), [...existingFieldNames].sort())) {
      addViolation('PLAN_ONLY_EXISTING_FIELD_SET_CHANGED', entityName);
    }
  }
};

for (const arg of args) {
  if (!ALLOWED_ARGS.has(arg)) addViolation('UNKNOWN_ARGUMENT', arg);
}

const manifest = readStrictJson(MANIFEST_PATH);
if (manifest) {
  validateManifest(manifest);
  for (const entityName of EXPECTED_ENTITIES) {
    validateSchema(entityName, manifest.entities?.[entityName], manifest);
  }
  const entityDirectory = path.join(REPO_ROOT, manifest.entityDirectory || '');
  if (fs.existsSync(entityDirectory)) {
    for (const fileName of fs.readdirSync(entityDirectory)) {
      if (fileName === 'pro-form-field-manifest.json') {
        addViolation('DEPLOYABLE_MANIFEST_COPY_FORBIDDEN', path.join(manifest.entityDirectory, fileName));
      }
    }
  }
}

if (violations.length > 0) {
  for (const violation of [...new Set(violations)].sort()) {
    console.error(`ENTITY_SCHEMA_VALIDATION_ERROR ${violation}`);
  }
  process.exitCode = 1;
} else {
  const counts = EXPECTED_ENTITIES.map((entityName) => (
    `${entityName}=${manifest.entities[entityName].proposedFields.length}`
  )).join(' ');
  const legacyDescriptionExceptions = EXPECTED_ENTITIES.reduce((sum, entityName) => (
    sum + manifest.entities[entityName].legacyDescriptionExceptions.length
  ), 0);
  console.log(
    `PRO_FORM_ENTITY_SCHEMA_PLAN_PASS mode=${planOnly ? 'plan-only' : 'schema'} entities=4 ${counts} legacy_description_exceptions=${legacyDescriptionExceptions}`,
  );
}
