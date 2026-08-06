import { afterEach, describe, expect, it } from 'vitest';
import { createResilientStorage, STORAGE_MODES } from '@/lib/resilientStorage';
import {
  clearQuestionnaireSessionId,
  createQuestionnaireSessionId,
  getOrCreateQuestionnaireSessionId,
  resetQuestionnaireSessionCacheForTests,
} from '@/lib/sessionId';
import {
  buildQuestionnaireStorageKey,
  deriveQuestionnaireBrowserNamespace,
} from '@/lib/questionnaireBrowserNamespace';
import { createMemoryStorage } from '@/test/utils/storage';

afterEach(() => resetQuestionnaireSessionCacheForTests());

describe('scoped questionnaire sessions', () => {
  it('uses randomUUID when available', () => {
    expect(createQuestionnaireSessionId({
      cryptoObject: { randomUUID: () => 'synthetic-uuid' },
    })).toBe('synthetic-uuid');
  });

  it('keeps one stable session per namespace and isolates two clients', async () => {
    const localStorage = createMemoryStorage();
    const storage = createResilientStorage({ indexedDB: null, localStorage });
    const namespaceA = deriveQuestionnaireBrowserNamespace({ userId: 'client-a' });
    const namespaceB = deriveQuestionnaireBrowserNamespace({ userId: 'client-b' });

    const firstA = await getOrCreateQuestionnaireSessionId({ namespace: namespaceA, storage });
    const secondA = await getOrCreateQuestionnaireSessionId({ namespace: namespaceA, storage });
    const firstB = await getOrCreateQuestionnaireSessionId({ namespace: namespaceB, storage });

    expect(secondA).toBe(firstA);
    expect(firstB).not.toBe(firstA);
    const keyA = buildQuestionnaireStorageKey({ namespace: namespaceA, purpose: 'legacy-session' });
    const keyB = buildQuestionnaireStorageKey({ namespace: namespaceB, purpose: 'legacy-session' });
    expect(keyA).not.toBe(keyB);

    await clearQuestionnaireSessionId({ namespace: namespaceA, storage });
    resetQuestionnaireSessionCacheForTests();
    expect(await getOrCreateQuestionnaireSessionId({ namespace: namespaceB, storage }))
      .toBe(firstB);
    expect(await getOrCreateQuestionnaireSessionId({ namespace: namespaceA, storage }))
      .not.toBe(firstA);
  });

  it('returns a page-lifetime session in memory-only mode without claiming durability', async () => {
    const storage = createResilientStorage({
      indexedDB: null,
      localStorage: null,
      sessionStorage: null,
    });
    const namespace = deriveQuestionnaireBrowserNamespace({ userId: 'memory-client' });

    const first = await getOrCreateQuestionnaireSessionId({ namespace, storage });
    const second = await getOrCreateQuestionnaireSessionId({ namespace, storage });

    expect(second).toBe(first);
    expect(storage.getMode()).toBe(STORAGE_MODES.MEMORY_ONLY);
    expect(storage.getDiagnostics().durable).toBe(false);
  });
});
