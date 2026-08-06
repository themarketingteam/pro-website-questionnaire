export const PRO_DRAFT_KILL_SWITCH_OUTCOMES = Object.freeze({
  CONTINUE_READ_ONLY: 'continue_read_only',
  CONTINUE_LOCAL_ONLY: 'continue_local_only',
  RECOVERY_ONLY: 'recovery_only',
  MAINTENANCE_REQUIRED: 'maintenance_required',
});

const ACTIVE_STATUSES = new Set(['active', 'submit_attempted', 'submit_failed']);
const TERMINAL_STATUSES = new Set(['submitted', 'superseded']);

export function decideProDraftKillSwitchOutcome(input = {}) {
  const status = typeof input.draftStatus === 'string' ? input.draftStatus : 'unknown';
  const hasLocalCanonicalState = input.hasLocalCanonicalState === true;
  const hasPersistentStorage = input.hasPersistentStorage === true;
  const hasFullRecoveryCode = input.hasFullRecoveryCode === true;
  const hasAuthorizedServerSession = input.hasAuthorizedServerSession === true;
  const isSubmitted = input.isSubmitted === true || TERMINAL_STATUSES.has(status);
  const isNewDraftStart = input.isNewDraftStart === true;
  const recoveryBackendEnabled = input.recoveryBackendEnabled === true;

  let outcome;
  if (isSubmitted && hasLocalCanonicalState) {
    outcome = PRO_DRAFT_KILL_SWITCH_OUTCOMES.CONTINUE_READ_ONLY;
  } else if (isNewDraftStart || !hasLocalCanonicalState) {
    outcome = PRO_DRAFT_KILL_SWITCH_OUTCOMES.MAINTENANCE_REQUIRED;
  } else if (ACTIVE_STATUSES.has(status) && hasPersistentStorage) {
    outcome = PRO_DRAFT_KILL_SWITCH_OUTCOMES.CONTINUE_LOCAL_ONLY;
  } else if (ACTIVE_STATUSES.has(status)) {
    outcome = PRO_DRAFT_KILL_SWITCH_OUTCOMES.RECOVERY_ONLY;
  } else {
    outcome = PRO_DRAFT_KILL_SWITCH_OUTCOMES.MAINTENANCE_REQUIRED;
  }

  return Object.freeze({
    outcome,
    readOnly: outcome === PRO_DRAFT_KILL_SWITCH_OUTCOMES.CONTINUE_READ_ONLY,
    localEditingAllowed: outcome === PRO_DRAFT_KILL_SWITCH_OUTCOMES.CONTINUE_LOCAL_ONLY,
    serverSyncPaused: true,
    startServerDraftAllowed: false,
    directEntityFallbackAllowed: false,
    destructiveResetAllowed: false,
    secureSaveClaimAllowed: false,
    recoveryRouteAvailable: recoveryBackendEnabled,
    copyRecoveryCodeWarning: outcome === PRO_DRAFT_KILL_SWITCH_OUTCOMES.RECOVERY_ONLY
      && hasFullRecoveryCode,
    credentialsRetained: hasFullRecoveryCode || hasAuthorizedServerSession,
    persistentStateRetained: hasPersistentStorage && hasLocalCanonicalState,
  });
}
