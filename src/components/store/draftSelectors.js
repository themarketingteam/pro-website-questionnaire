import { createSelector } from '@reduxjs/toolkit';
import {
  DRAFT_STATE_ERROR_CODES,
  DRAFT_STATE_SOURCE_TYPES,
  PRO_FORM_DRAFT_SCHEMA_VERSION,
  createEmptyCanonicalDraftState,
  getSafeCanonicalDraftDiagnostics,
  normalizeCanonicalDraftState,
} from '@/lib/questionnaireDraftState';

const EMPTY_OBJECT = Object.freeze({});
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const selectFormState = (state) => state?.form || state || EMPTY_OBJECT;

export const selectUiDraftState = createSelector(
  [selectFormState],
  (form) => form.uiDraftState || EMPTY_OBJECT,
);

export const selectUiDraftStateScope = createSelector(
  [selectUiDraftState, (_state, scopeKey) => scopeKey],
  (uiDraftState, scopeKey) => (
    typeof scopeKey === 'string' && !FORBIDDEN_KEYS.has(scopeKey)
      ? uiDraftState[scopeKey]
      : undefined
  ),
);

export const selectFieldChangeMetadata = createSelector(
  [selectFormState],
  (form) => form.fieldChangeMetadata || EMPTY_OBJECT,
);

export const selectDraftContext = createSelector(
  [selectFormState],
  (form) => form.draftContext || EMPTY_OBJECT,
);

export const selectDraftBootstrapStatus = createSelector(
  [selectFormState],
  (form) => form.draftBootstrapStatus || EMPTY_OBJECT,
);

export const selectDraftSyncStatus = createSelector(
  [selectFormState],
  (form) => form.draftSyncStatus || EMPTY_OBJECT,
);

export const selectCurrentQuestionId = createSelector(
  [selectFormState],
  (form) => form.currentQuestionId ?? null,
);

export const selectLastChangedQuestionId = createSelector(
  [selectFormState],
  (form) => form.lastChangedQuestionId ?? null,
);

export const selectSubmittedReceipt = createSelector(
  [selectFormState],
  (form) => form.submittedReceipt ?? null,
);

export const selectIsDraftReadOnly = createSelector(
  [selectDraftContext],
  (context) => ['submitted', 'expired', 'deleted'].includes(context.draftStatus),
);

export const selectCanonicalDraftState = createSelector(
  [selectFormState],
  (form) => {
    try {
      const context = form.draftContext || EMPTY_OBJECT;
      const receipt = form.submittedReceipt;
      const state = normalizeCanonicalDraftState({
        ...createEmptyCanonicalDraftState(),
        schemaVersion: context.schemaVersion ?? PRO_FORM_DRAFT_SCHEMA_VERSION,
        draftId: context.draftId ?? null,
        sessionId: context.sessionId ?? null,
        draftStatus: context.draftStatus || 'active',
        clientRevision: context.clientRevision ?? 0,
        serverRevision: context.serverRevision ?? 0,
        // Cache-envelope timestamps and Redux sync indicators are operational
        // metadata. Keeping them out of this projection prevents save-status
        // actions from scheduling another canonical write.
        savedAtClient: null,
        savedAtServer: null,
        sourceTabId: context.sourceTabId ?? null,
        responses: form.responses || {},
        validationStatus: form.validationStatus || {},
        touchedQuestions: form.touchedQuestions || {},
        expandedQuestions: form.expandedQuestions || {},
        textValidationMeta: form.textValidationMeta || {},
        credentials: form.credentials || {},
        uiDraftState: form.uiDraftState || {},
        fieldChangeMetadata: form.fieldChangeMetadata || {},
        currentQuestionId: form.currentQuestionId ?? null,
        lastChangedQuestionId: form.lastChangedQuestionId ?? null,
        lastMutation: form.lastMutation ?? null,
        submission: {
          finalSubmissionId: receipt?.finalSubmissionId ?? null,
          submittedAt: receipt?.submittedAt ?? null,
          submittedStateHash: null,
          pdfSourceStateHash: null,
          lastSubmissionErrorCode: null,
        },
        compatibility: {
          sourceType: DRAFT_STATE_SOURCE_TYPES.CANONICAL,
          sourceVersion: context.schemaVersion ?? PRO_FORM_DRAFT_SCHEMA_VERSION,
          migratedAtClient: null,
          migrationWarnings: [],
        },
      });
      return Object.freeze({
        ok: true,
        state,
        errorCode: null,
        issues: [],
        safeDiagnostics: getSafeCanonicalDraftDiagnostics({ state }),
      });
    } catch (error) {
      const errorCode = error?.code || DRAFT_STATE_ERROR_CODES.INVALID_INPUT;
      return Object.freeze({
        ok: false,
        state: null,
        errorCode,
        issues: [{ code: errorCode, path: error?.path || '$' }],
        safeDiagnostics: getSafeCanonicalDraftDiagnostics({ errorCode }),
      });
    }
  },
);

export const selectSafeDraftDiagnostics = createSelector(
  [
    selectCanonicalDraftState,
    selectDraftBootstrapStatus,
    selectDraftSyncStatus,
    selectIsDraftReadOnly,
  ],
  (canonical, bootstrap, sync, readOnly) => Object.freeze({
    ...canonical.safeDiagnostics,
    canonicalValid: canonical.ok,
    bootstrapState: bootstrap.state || null,
    syncState: sync.state || null,
    storageMode: sync.storageMode || null,
    retryCount: Number.isSafeInteger(sync.retryCount) ? sync.retryCount : 0,
    readOnly,
  }),
);
