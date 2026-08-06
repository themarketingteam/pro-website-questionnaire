import { tryGetLocalStorage } from '@/lib/resilientStorage';

export const LEGACY_QUESTIONNAIRE_STORAGE_KEYS = Object.freeze({
  REDUX_STATE: 'persist:pro-questionnaire-root',
  SESSION_ID: 'pro_questionnaire_session_id',
  FAILURE_BACKUP_PREFIX: 'pro_questionnaire_local_backup_',
});

const safeByteSize = (value) => {
  if (typeof value !== 'string') return 0;
  try {
    return new TextEncoder().encode(value).byteLength;
  } catch {
    return value.length * 2;
  }
};

const listStorageEntries = (storage) => {
  if (!storage) return [];
  const entries = [];
  try {
    for (let index = 0; index < Number(storage.length || 0); index += 1) {
      const key = storage.key(index);
      if (typeof key !== 'string') continue;
      let value = null;
      try { value = storage.getItem(key); } catch {}
      entries.push({ key, byteSize: safeByteSize(value) });
    }
  } catch {
    return [];
  }
  return entries;
};

/** @param {{ storage?: Storage | null }} [options] */
export const inspectLegacyQuestionnaireStorage = ({
  storage = tryGetLocalStorage(),
} = {}) => {
  const entries = listStorageEntries(storage);
  const redux = entries.find(({ key }) => key === LEGACY_QUESTIONNAIRE_STORAGE_KEYS.REDUX_STATE);
  const session = entries.find(({ key }) => key === LEGACY_QUESTIONNAIRE_STORAGE_KEYS.SESSION_ID);
  const backups = entries.filter(({ key }) => (
    key.startsWith(LEGACY_QUESTIONNAIRE_STORAGE_KEYS.FAILURE_BACKUP_PREFIX)
  ));

  return Object.freeze([
    Object.freeze({
      keyType: 'redux-state',
      presence: Boolean(redux),
      byteSize: redux?.byteSize || 0,
    }),
    Object.freeze({
      keyType: 'session-id',
      presence: Boolean(session),
      byteSize: session?.byteSize || 0,
    }),
    Object.freeze({
      keyType: 'failure-backup',
      presence: backups.length > 0,
      byteSize: backups.reduce((total, entry) => total + entry.byteSize, 0),
    }),
  ]);
};

// Explicit migration-only access. Callers must have already resolved client
// ownership; ambiguous global data is never returned by default.
/** @param {{
 *   keyType?: string,
 *   legacyKey?: string,
 *   storage?: Storage | null,
 *   authorized?: boolean,
 * }} [options]
 */
export const readLegacyQuestionnaireValueForMigration = ({
  keyType,
  legacyKey,
  storage = tryGetLocalStorage(),
  authorized = false,
} = {}) => {
  if (!authorized || !storage) return null;
  const key = keyType === 'redux-state'
    ? LEGACY_QUESTIONNAIRE_STORAGE_KEYS.REDUX_STATE
    : keyType === 'session-id'
      ? LEGACY_QUESTIONNAIRE_STORAGE_KEYS.SESSION_ID
      : keyType === 'failure-backup'
        && String(legacyKey || '').startsWith(
          LEGACY_QUESTIONNAIRE_STORAGE_KEYS.FAILURE_BACKUP_PREFIX,
        )
        ? String(legacyKey)
        : null;
  if (!key) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};
