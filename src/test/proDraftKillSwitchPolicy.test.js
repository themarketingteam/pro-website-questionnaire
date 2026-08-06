import { describe, expect, it } from 'vitest';
import {
  PRO_DRAFT_KILL_SWITCH_OUTCOMES,
  decideProDraftKillSwitchOutcome,
} from '@/lib/proDraftKillSwitchPolicy';

describe('draft kill-switch policy', () => {
  it('keeps submitted local state read-only', () => {
    expect(decideProDraftKillSwitchOutcome({
      draftStatus: 'submitted',
      hasLocalCanonicalState: true,
      hasPersistentStorage: true,
    })).toMatchObject({
      outcome: PRO_DRAFT_KILL_SWITCH_OUTCOMES.CONTINUE_READ_ONLY,
      readOnly: true,
      persistentStateRetained: true,
    });
  });

  it('keeps an active persistent draft local-only with sync visibly paused', () => {
    expect(decideProDraftKillSwitchOutcome({
      draftStatus: 'active',
      hasLocalCanonicalState: true,
      hasPersistentStorage: true,
    })).toMatchObject({
      outcome: PRO_DRAFT_KILL_SWITCH_OUTCOMES.CONTINUE_LOCAL_ONLY,
      localEditingAllowed: true,
      serverSyncPaused: true,
      secureSaveClaimAllowed: false,
    });
  });

  it('makes memory-only active state recovery-only and warns to copy a full code', () => {
    expect(decideProDraftKillSwitchOutcome({
      draftStatus: 'active',
      hasLocalCanonicalState: true,
      hasPersistentStorage: false,
      hasFullRecoveryCode: true,
    })).toMatchObject({
      outcome: PRO_DRAFT_KILL_SWITCH_OUTCOMES.RECOVERY_ONLY,
      copyRecoveryCodeWarning: true,
      credentialsRetained: true,
    });
  });

  it('blocks a new draft start during maintenance', () => {
    expect(decideProDraftKillSwitchOutcome({ isNewDraftStart: true })).toMatchObject({
      outcome: PRO_DRAFT_KILL_SWITCH_OUTCOMES.MAINTENANCE_REQUIRED,
      startServerDraftAllowed: false,
    });
  });

  it('exposes recovery only when its backend remains enabled', () => {
    expect(decideProDraftKillSwitchOutcome({
      draftStatus: 'active', hasLocalCanonicalState: true, recoveryBackendEnabled: false,
    }).recoveryRouteAvailable).toBe(false);
    expect(decideProDraftKillSwitchOutcome({
      draftStatus: 'active', hasLocalCanonicalState: true, recoveryBackendEnabled: true,
    }).recoveryRouteAvailable).toBe(true);
  });

  it.each([
    { draftStatus: 'active', hasLocalCanonicalState: true, hasPersistentStorage: true },
    { draftStatus: 'active', hasLocalCanonicalState: true, hasPersistentStorage: false },
    { draftStatus: 'submitted', hasLocalCanonicalState: true, hasPersistentStorage: true },
    { isNewDraftStart: true },
  ])('never enables direct fallback or destructive reset', (input) => {
    expect(decideProDraftKillSwitchOutcome(input)).toMatchObject({
      directEntityFallbackAllowed: false,
      destructiveResetAllowed: false,
      startServerDraftAllowed: false,
    });
  });
});
