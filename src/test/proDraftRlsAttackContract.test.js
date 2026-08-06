import { describe, expect, it } from 'vitest';
import {
  assertValidProDraftRlsAttackContract,
  proDraftRlsAttackContract,
} from '../../tests/e2e/helpers/proDraftRlsAttackContract.js';

describe('future live draft RLS attack contract', () => {
  it('is synthetic-only until Prompt 4 and contains unique cases', () => {
    expect(assertValidProDraftRlsAttackContract()).toBe(true);
    expect(proDraftRlsAttackContract.executionPhase).toBe('prompt-4-live-staging-only');
    expect([
      ...proDraftRlsAttackContract.directDenialCases,
      ...proDraftRlsAttackContract.backendSuccessCases,
    ].every((entry) => entry.liveOnly)).toBe(true);
  });

  it.each(['anonymous', 'authenticated_non_admin'])(
    'covers every required direct denial for %s',
    (actor) => {
      const keys = proDraftRlsAttackContract.directDenialCases
        .filter((entry) => entry.actor === actor)
        .map((entry) => `${entry.entity}:${entry.operation}`);
      expect(keys).toEqual([
        'ProFormDraft:create',
        'ProFormDraft:read',
        'ProFormDraft:list',
        'ProFormDraft:filter',
        'ProFormDraft:update',
        'ProFormDraft:delete',
        'ProFormDraftEvent:create',
        'ProFormDraftEvent:read',
        'ProFormRecoverySecurityEvent:read',
      ]);
    },
  );

  it('covers authorized backend bootstrap/save/recovery and admin-grant list', () => {
    expect(proDraftRlsAttackContract.backendSuccessCases.map((entry) => entry.functionName))
      .toEqual([
        'bootstrapProFormDraft',
        'saveProFormDraft',
        'recoverProFormDraftByCode',
        'listProFormDraftsForRecovery',
      ]);
  });
});
