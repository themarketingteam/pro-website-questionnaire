import { defaultResilientStorage } from '@/lib/resilientStorage';
import {
  buildQuestionnaireStorageKey,
  deriveQuestionnaireBrowserNamespace,
} from '@/lib/questionnaireBrowserNamespace';
import { readLegacyQuestionnaireValueForMigration } from '@/lib/legacyQuestionnaireStorage';

const inMemorySessions = new Map();
let fallbackSequence = 0;

const safeCrypto = () => {
  try { return typeof crypto === 'undefined' ? null : crypto; } catch { return null; }
};

export const createQuestionnaireSessionId = ({
  cryptoObject = safeCrypto(),
  now = Date.now,
  random = Math.random,
} = {}) => {
  try {
    if (typeof cryptoObject?.randomUUID === 'function') return cryptoObject.randomUUID();
    if (typeof cryptoObject?.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      cryptoObject.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  } catch {
    // Fall through to the best launch-local entropy available.
  }

  fallbackSequence += 1;
  const entropy = [now(), random(), random(), fallbackSequence].join(':');
  return `pro_${entropy.replace(/[^a-z\d]/gi, '')}`;
};

const resolveNamespace = (namespace) => namespace || deriveQuestionnaireBrowserNamespace();

/** @param {{ namespace?: string, storage?: any }} [options] */
export const getOrCreateQuestionnaireSessionId = async ({
  namespace,
  storage = defaultResilientStorage,
} = {}) => {
  const resolvedNamespace = resolveNamespace(namespace);
  if (inMemorySessions.has(resolvedNamespace)) return inMemorySessions.get(resolvedNamespace);

  const key = buildQuestionnaireStorageKey({
    namespace: resolvedNamespace,
    purpose: 'legacy-session',
  });
  try {
    const existing = await storage.getItem(key);
    if (typeof existing === 'string' && existing.length > 0) {
      inMemorySessions.set(resolvedNamespace, existing);
      return existing;
    }
  } catch {
    // A fresh page-lifetime session remains available.
  }

  const sessionId = createQuestionnaireSessionId();
  inMemorySessions.set(resolvedNamespace, sessionId);
  try { await storage.setItem(key, sessionId); } catch {}
  return sessionId;
};

/** @param {{ namespace?: string, storage?: any }} [options] */
export const clearQuestionnaireSessionId = async ({
  namespace,
  storage = defaultResilientStorage,
} = {}) => {
  const resolvedNamespace = resolveNamespace(namespace);
  const key = buildQuestionnaireStorageKey({
    namespace: resolvedNamespace,
    purpose: 'legacy-session',
  });
  inMemorySessions.delete(resolvedNamespace);
  try {
    await storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
};

/** @param {{ storage?: Storage | null, authorized?: boolean }} [options] */
export const readLegacyQuestionnaireSessionIdForMigration = ({
  storage,
  authorized = false,
} = {}) => readLegacyQuestionnaireValueForMigration({
  keyType: 'session-id',
  storage,
  authorized,
});

export const resetQuestionnaireSessionCacheForTests = () => {
  inMemorySessions.clear();
  fallbackSequence = 0;
};
