import {
  safeNowIso
} from '@/lib/browserSafety';
import { defaultResilientStorage, STORAGE_MODES } from '@/lib/resilientStorage';
import {
  QUESTIONNAIRE_STORAGE_KEY_VERSIONS,
  buildQuestionnaireStorageKey,
  deriveQuestionnaireBrowserNamespace,
} from '@/lib/questionnaireBrowserNamespace';
import { normalizePersistedQuestionnaireState } from '@/components/store/normalization';

const safeFormRecord = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);

const isDurableStorageMode = (mode) => (
  mode === STORAGE_MODES.INDEXEDDB || mode === STORAGE_MODES.LOCALSTORAGE
);

export const writeDraftFailureBackup = async ({
  namespace = deriveQuestionnaireBrowserNamespace(),
  storage = defaultResilientStorage,
  questionnaireSessionId,
  responses,
  validationStatus,
  touchedQuestions,
  expandedQuestions,
  textValidationMeta,
}) => {
  const key = buildQuestionnaireStorageKey({ namespace, purpose: 'failure-backup' });
  const savedAt = safeNowIso();
  try {
    try { await storage.probe?.(); } catch {}
    let storageMode = storage.getMode?.() || STORAGE_MODES.UNKNOWN;
    let backup = {
      namespaceVersion: QUESTIONNAIRE_STORAGE_KEY_VERSIONS.CURRENT,
      sessionId: String(questionnaireSessionId || ''),
      savedAt,
      storageMode,
      form: {
        responses: safeFormRecord(responses),
        validationStatus: safeFormRecord(validationStatus),
        touchedQuestions: safeFormRecord(touchedQuestions),
        expandedQuestions: safeFormRecord(expandedQuestions),
        textValidationMeta: safeFormRecord(textValidationMeta),
      },
    };
    await storage.setJson(key, backup);

    const actualMode = storage.getMode?.() || storageMode;
    if (actualMode !== storageMode) {
      storageMode = actualMode;
      backup = { ...backup, storageMode };
      await storage.setJson(key, backup);
    }
    return Object.freeze({
      written: true,
      storageMode,
      durable: isDurableStorageMode(storageMode),
    });
  } catch {
    return Object.freeze({
      written: false,
      storageMode: storage.getMode?.() || STORAGE_MODES.UNKNOWN,
      durable: false,
    });
  }
};

export const readDraftFailureBackup = async ({
  namespace = deriveQuestionnaireBrowserNamespace(),
  storage = defaultResilientStorage,
} = {}) => {
  const key = buildQuestionnaireStorageKey({ namespace, purpose: 'failure-backup' });
  try {
    const backup = await storage.getJson(key, null);
    if (
      !backup
      || backup.namespaceVersion !== QUESTIONNAIRE_STORAGE_KEY_VERSIONS.CURRENT
      || typeof backup.sessionId !== 'string'
      || typeof backup.savedAt !== 'string'
      || !Object.values(STORAGE_MODES).includes(backup.storageMode)
      || !backup.form
      || typeof backup.form !== 'object'
      || Array.isArray(backup.form)
    ) return null;
    return Object.freeze({
      namespaceVersion: backup.namespaceVersion,
      sessionId: backup.sessionId,
      savedAt: backup.savedAt,
      storageMode: backup.storageMode,
      form: normalizePersistedQuestionnaireState(backup.form),
    });
  } catch {
    return null;
  }
};
