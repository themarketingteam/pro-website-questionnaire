#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIRMATION = 'DELETE_ONLY_THIS_TEST_RUN';
const SAFE_TEST_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
const APPROVED_FUNCTION = 'cleanupDurableDraftTestData';
export const CLEANUP_ENTITY_NAMES = Object.freeze([
  'ProFormDraft',
  'ProFormDraftEvent',
  'ProFormSubmission',
  'ProFormSubmissionIntake',
  'ProFormRecoverySecurityEvent',
  'ProFormEmailVerificationAttempt',
  'ProFormMigrationCheckpoint',
  'ProFormMigrationIdMap',
  'ProFormMigrationConflict',
]);

export const validateCleanupRequest = ({
  apply = false,
  confirmation = '',
  environment,
  testRunId,
}) => {
  if (environment !== 'staging') throw new Error('CLEANUP_STAGING_ONLY');
  if (!SAFE_TEST_RUN_ID.test(String(testRunId || '')) || /[*?]/.test(testRunId)) {
    throw new Error('CLEANUP_TEST_RUN_ID_INVALID');
  }
  if (apply && confirmation !== CONFIRMATION) throw new Error('CLEANUP_CONFIRMATION_REQUIRED');
  return { apply, environment, testRunId };
};

const safeCounts = (value) => Object.fromEntries(Object.entries(value || {})
  .filter(([key, count]) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) && Number.isFinite(Number(count)))
  .map(([key, count]) => [key, Math.max(0, Number(count))]));

export const runCleanupCoordinator = async (request, { invokeApprovedFunction }) => {
  const validated = validateCleanupRequest(request);
  if (typeof invokeApprovedFunction !== 'function') throw new Error('CLEANUP_BACKEND_NOT_CONFIGURED');
  const previewResponse = await invokeApprovedFunction(APPROVED_FUNCTION, {
    action: 'preview',
    environment: validated.environment,
    testRunId: validated.testRunId,
  });
  const previewCounts = safeCounts(previewResponse?.counts);
  if (!CLEANUP_ENTITY_NAMES.every((entityName) => entityName in previewCounts)) {
    throw new Error('CLEANUP_PREVIEW_INCOMPLETE');
  }
  if (!validated.apply) {
    return { applied: false, previewCounts, remainingCounts: previewCounts, verifiedZero: false };
  }

  const applyResponse = await invokeApprovedFunction(APPROVED_FUNCTION, {
    action: 'delete',
    confirmation: CONFIRMATION,
    environment: validated.environment,
    testRunId: validated.testRunId,
  });
  const deletedCounts = safeCounts(applyResponse?.deletedCounts);
  const verification = await invokeApprovedFunction(APPROVED_FUNCTION, {
    action: 'verify',
    environment: validated.environment,
    testRunId: validated.testRunId,
  });
  const remainingCounts = safeCounts(verification?.counts);
  const verifiedZero = CLEANUP_ENTITY_NAMES.every((entityName) => remainingCounts[entityName] === 0);
  if (!verifiedZero) throw new Error('CLEANUP_VERIFICATION_FAILED');
  return { applied: true, deletedCounts, previewCounts, remainingCounts, verifiedZero };
};

const parseArguments = (argv) => {
  const options = {
    appId: process.env.BASE44_APP_ID || '',
    environment: '',
    testRunId: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') {
      options.apply = true;
      options.confirmation = argv[index + 1] || '';
      index += 1;
      continue;
    }
    const [flag, inlineValue] = argument.split('=', 2);
    const key = { '--app-id': 'appId', '--environment': 'environment', '--test-run-id': 'testRunId' }[flag];
    if (!key) throw new Error('CLEANUP_ARGUMENT_INVALID');
    const value = inlineValue || argv[++index];
    if (!value) throw new Error('CLEANUP_ARGUMENT_VALUE_MISSING');
    options[key] = value;
  }
  return options;
};

const createInvoker = async ({ appId }) => {
  const stagingAppId = String(process.env.BASE44_STAGING_APP_ID || '');
  const productionAppId = String(process.env.BASE44_PRODUCTION_APP_ID || '');
  if (!appId || !stagingAppId || appId !== stagingAppId || appId === productionAppId) {
    throw new Error('CLEANUP_APP_TARGET_REJECTED');
  }
  const adminGrant = String(process.env.PRO_FORM_ADMIN_GRANT || '');
  if (!adminGrant) throw new Error('CLEANUP_ADMIN_GRANT_MISSING');
  const { createClient } = await import('@base44/sdk');
  const base44 = createClient({
    appId,
    ...(process.env.BASE44_ACCESS_TOKEN ? { token: process.env.BASE44_ACCESS_TOKEN } : {}),
  });
  return async (functionName, payload) => {
    const response = await base44.functions.invoke(functionName, { ...payload, adminGrant });
    return response.data;
  };
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const options = parseArguments(process.argv.slice(2));
    validateCleanupRequest(options);
    const invokeApprovedFunction = await createInvoker(options);
    const result = await runCleanupCoordinator(options, { invokeApprovedFunction });
    process.stdout.write(`${JSON.stringify({
      applied: result.applied,
      deletedCounts: result.deletedCounts || {},
      previewCounts: result.previewCounts,
      remainingCounts: result.remainingCounts,
      verifiedZero: result.verifiedZero,
    })}\n`);
  } catch (error) {
    process.stderr.write(`${error?.message || 'CLEANUP_FAILED'}\n`);
    process.exitCode = 1;
  }
}
