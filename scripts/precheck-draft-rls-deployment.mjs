#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parse } from 'jsonc-parser';
import { validateSensitiveEntityAccess } from './validate-sensitive-entity-access.mjs';
import { validateSensitiveFunctionServiceRole } from './validate-sensitive-function-service-role.mjs';

export const REQUIRED_RLS_FUNCTIONS = Object.freeze([
  'bootstrapProFormDraft',
  'loadProFormDraft',
  'saveProFormDraft',
  'appendProFormDraftEvents',
  'clearAndReplaceProFormDraft',
  'startNewProFormDraft',
  'recoverProFormDraftByEmail',
  'recoverProFormDraftByCode',
  'listProFormDraftRecoveryChoices',
  'selectProFormDraftRecoveryChoice',
  'sendProFormDraftRecoveryCodeEmail',
  'listProFormDraftsForRecovery',
  'getProFormDraftForRecovery',
  'listProFormDraftEventsForRecovery',
  'updateProFormDraftForRecovery',
  'getProFormDraftLineageForRecovery',
  'retryProQuestionnaireIntakeSubmission',
  'repairProQuestionnaireIntakeSubmission',
]);

const PROTECTED_ENTITIES = Object.freeze([
  'ProFormDraft',
  'ProFormDraftEvent',
  'ProFormRecoverySecurityEvent',
  'ProFormEmailVerificationAttempt',
]);

const ADMIN_ONLY = Object.freeze({ user_condition: { role: 'admin' } });
const ADMIN_RLS = Object.freeze({
  create: ADMIN_ONLY,
  read: ADMIN_ONLY,
  update: ADMIN_ONLY,
  delete: ADMIN_ONLY,
});

const EVIDENCE = Object.freeze([
  {
    key: 'api',
    file: 'docs/durable-draft-recovery/backend/staging-authoritative-draft-api-certification.md',
    accepted: /Classification:\s*\*\*(?:AUTHORITATIVE_DRAFT_APIS_(?:PASSED|CERTIFIED))\*\*/u,
  },
  {
    key: 'admin',
    file: 'docs/durable-draft-recovery/admin/staging-password-only-admin-recovery-certification.md',
    accepted: /Classification:\s*\*\*(?:PASSWORD_ONLY_ADMIN_RECOVERY_(?:PASSED|CERTIFIED))\*\*/u,
  },
  {
    key: 'lifecycle',
    file: 'docs/durable-draft-recovery/testing/staging-full-draft-lifecycle-certification.md',
    accepted: /Classification:\s*\*\*(?:FULL_DRAFT_LIFECYCLE_(?:PASSED|CERTIFIED))\*\*/u,
  },
]);

const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
};

const equal = (left, right) => JSON.stringify(stable(left)) === JSON.stringify(stable(right));
const fingerprint = (value) => createHash('sha256').update(value).digest('hex');

export function evaluateDraftRlsPrecheck(facts) {
  const failures = [];
  if (facts.branch !== 'feature/durable-draft-recovery') failures.push('FEATURE_BRANCH_REQUIRED');
  if (!facts.schemaRlsValid) failures.push('TARGET_RLS_INVALID');
  if ((facts.sourceFindings || []).length > 0) failures.push('FRONTEND_DIRECT_ACCESS_DETECTED');
  if (!facts.builtOutputPresent) failures.push('BUILT_OUTPUT_MISSING');
  if ((facts.builtFindings || []).length > 0) failures.push('BUILT_DIRECT_ACCESS_DETECTED');
  if ((facts.missingFunctions || []).length > 0) failures.push('REQUIRED_FUNCTION_MISSING');
  if ((facts.serviceRoleFindings || []).length > 0) failures.push('SERVICE_ROLE_POLICY_FAILED');
  for (const key of ['api', 'admin', 'lifecycle']) {
    if (facts.evidence?.[key] !== true) failures.push(`STAGING_${key.toUpperCase()}_CERTIFICATION_MISSING`);
  }
  if (!facts.stagingSecretsDocumented) failures.push('STAGING_SECRETS_NOT_DOCUMENTED_CONFIGURED');
  if (!facts.stagingFlagsValid) failures.push('STAGING_FLAGS_INVALID');
  if (facts.appLinkKind === 'production') failures.push('PRODUCTION_APP_LINK_FORBIDDEN');
  else if (facts.appLinkKind !== 'staging') failures.push('STAGING_APP_LINK_REQUIRED');
  return Object.freeze({ ok: failures.length === 0, failures: Object.freeze(failures) });
}

async function readOptional(root, relative) {
  try {
    return await readFile(path.join(root, relative), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

function parseJsonc(text) {
  const errors = [];
  const value = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  return errors.length === 0 ? value : null;
}

async function schemaRlsValid(root) {
  for (const entity of PROTECTED_ENTITIES) {
    const schema = parseJsonc(await readOptional(root, `base44/entities/${entity}.jsonc`));
    if (!schema || !equal(schema.rls, ADMIN_RLS)) return false;
  }
  return true;
}

async function missingFunctions(root) {
  const directory = path.join(root, 'base44/functions');
  const entries = existsSync(directory) ? await readdir(directory, { withFileTypes: true }) : [];
  const available = new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
  return REQUIRED_RLS_FUNCTIONS.filter((name) => !available.has(name)
    || !existsSync(path.join(directory, name, 'entry.ts')));
}

async function appLinkKind(root) {
  const [appText, registration] = await Promise.all([
    readOptional(root, 'base44/.app.jsonc'),
    readOptional(root, 'docs/durable-draft-recovery/environments/staging-app-registration.md'),
  ]);
  const app = parseJsonc(appText);
  if (!app?.id) return 'missing';
  const localFingerprint = fingerprint(String(app.id));
  const production = registration.match(/Production app-ID SHA-256 fingerprint:\s*`([a-f0-9]{64})`/u)?.[1];
  const staging = registration.match(/Staging app-ID SHA-256 fingerprint:\s*`([a-f0-9]{64})`/u)?.[1];
  if (production && localFingerprint === production) return 'production';
  if (staging && localFingerprint === staging) return 'staging';
  return 'unknown';
}

export async function collectDraftRlsPrecheckFacts(root = process.cwd()) {
  const [source, built, serviceRole, missing, linkKind, secretInventory, flagTemplate] = await Promise.all([
    validateSensitiveEntityAccess({ root, sourceOnly: true }),
    validateSensitiveEntityAccess({ root, builtOnly: true }),
    validateSensitiveFunctionServiceRole({ root }),
    missingFunctions(root),
    appLinkKind(root),
    readOptional(root, 'docs/durable-draft-recovery/environments/staging-secret-inventory.md'),
    readOptional(root, '.env.staging.example'),
  ]);
  const evidence = {};
  for (const item of EVIDENCE) {
    evidence[item.key] = item.accepted.test(await readOptional(root, item.file));
  }
  let branch = '';
  try {
    branch = execFileSync('git', ['branch', '--show-current'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    branch = '';
  }
  return Object.freeze({
    branch,
    schemaRlsValid: await schemaRlsValid(root),
    sourceFindings: source.findings,
    builtOutputPresent: existsSync(path.join(root, 'dist')),
    builtFindings: built.findings,
    missingFunctions: missing,
    serviceRoleFindings: serviceRole.findings,
    evidence,
    stagingSecretsDocumented: /Status:\s*\*\*STAGING_CRYPTOGRAPHIC_SECRETS_CONFIGURED\*\*/u.test(secretInventory),
    stagingFlagsValid: [
      'PRO_DEPLOY_ENVIRONMENT=staging',
      'ALLOW_PRODUCTION_DEPLOY=false',
      'EXPECTED_GIT_BRANCH=feature/durable-draft-recovery',
      'VITE_APP_ENVIRONMENT=staging',
      'VITE_PRO_DRAFT_V2_ENABLED=false',
      'VITE_PRO_DRAFT_V2_KILL_SWITCH=true',
      'PRO_DRAFT_V2_SERVER_ENABLED=false',
      'PRO_DRAFT_V2_KILL_SWITCH=true',
    ].every((line) => flagTemplate.includes(line)),
    appLinkKind: linkKind,
  });
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const facts = await collectDraftRlsPrecheckFacts();
  const result = evaluateDraftRlsPrecheck(facts);
  if (!result.ok) {
    console.error('DRAFT_RLS_DEPLOYMENT_PRECHECK_FAILED');
    for (const code of result.failures) console.error(code);
    process.exitCode = 1;
  } else {
    console.log('DRAFT_RLS_DEPLOYMENT_PRECHECK_PASSED');
  }
}
