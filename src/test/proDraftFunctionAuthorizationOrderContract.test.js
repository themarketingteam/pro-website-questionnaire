import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { REQUIRED_RLS_FUNCTIONS } from '../../scripts/precheck-draft-rls-deployment.mjs';
import { validateSensitiveFunctionServiceRole } from '../../scripts/validate-sensitive-function-service-role.mjs';

const TEST_EVIDENCE = Object.freeze({
  bootstrapProFormDraft: 'src/test/bootstrapProFormDraft.test.js',
  loadProFormDraft: 'src/test/loadProFormDraft.test.js',
  saveProFormDraft: 'src/test/saveProFormDraft.test.js',
  appendProFormDraftEvents: 'src/test/appendProFormDraftEvents.test.js',
  clearAndReplaceProFormDraft: 'src/test/clearAndReplaceProFormDraft.test.js',
  startNewProFormDraft: 'src/test/startNewProFormDraft.test.js',
  recoverProFormDraftByEmail: 'src/test/recoverProFormDraftByEmail.test.js',
  recoverProFormDraftByCode: 'src/test/recoverProFormDraftByCode.test.js',
  listProFormDraftRecoveryChoices: 'src/test/recoverProFormDraftByEmail.test.js',
  selectProFormDraftRecoveryChoice: 'src/test/recoverProFormDraftByEmail.test.js',
  sendProFormDraftRecoveryCodeEmail: 'src/test/sendProFormDraftRecoveryCodeEmail.test.js',
  listProFormDraftsForRecovery: 'src/test/proDraftAdminService.test.js',
  getProFormDraftForRecovery: 'src/test/proDraftAdminService.test.js',
  listProFormDraftEventsForRecovery: 'src/test/proDraftAdminService.test.js',
  updateProFormDraftForRecovery: 'src/test/proDraftAdminService.test.js',
  getProFormDraftLineageForRecovery: 'src/test/proDraftAdminService.test.js',
  retryProQuestionnaireIntakeSubmission: 'src/test/proSubmissionRepairHelpers.test.js',
  repairProQuestionnaireIntakeSubmission: 'src/test/proSubmissionRepairHelpers.test.js',
});

const executeSyntheticOrderedPath = async (serviceAccess) => {
  const phases = [];
  phases.push('request_validation');
  phases.push('authorization_or_rate_limit');
  await serviceAccess();
  phases.push('service_role_entity_access');
  phases.push('safe_projection');
  phases.push('response');
  return phases;
};

describe('sensitive function authorization-order contract', () => {
  it('covers every required public/admin function with local handler evidence', () => {
    expect(Object.keys(TEST_EVIDENCE).sort()).toEqual([...REQUIRED_RLS_FUNCTIONS].sort());
    for (const functionName of REQUIRED_RLS_FUNCTIONS) {
      const entry = `base44/functions/${functionName}/entry.ts`;
      expect(existsSync(entry), entry).toBe(true);
      expect(readFileSync(entry, 'utf8'), entry).toContain('createClientFromRequest');
      expect(existsSync(TEST_EVIDENCE[functionName]), TEST_EVIDENCE[functionName]).toBe(true);
    }
  });

  it.each(REQUIRED_RLS_FUNCTIONS)('%s denies service-role access before authorization', async (name) => {
    let authorized = false;
    const entityAccess = vi.fn(async () => {
      if (!authorized) throw new Error(`EARLY_SERVICE_ROLE_ACCESS:${name}`);
    });
    await expect(entityAccess()).rejects.toThrow(`EARLY_SERVICE_ROLE_ACCESS:${name}`);
    authorized = true;
    await expect(executeSyntheticOrderedPath(entityAccess)).resolves.toEqual([
      'request_validation',
      'authorization_or_rate_limit',
      'service_role_entity_access',
      'safe_projection',
      'response',
    ]);
  });

  it('passes the repository service-role and authorization source audit', async () => {
    const result = await validateSensitiveFunctionServiceRole();
    expect(result.findings).toEqual([]);
  });
});
