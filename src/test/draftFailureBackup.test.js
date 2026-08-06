import { describe, expect, it } from 'vitest';
import { createResilientStorage, STORAGE_MODES } from '@/lib/resilientStorage';
import {
  readDraftFailureBackup,
  writeDraftFailureBackup,
} from '@/lib/draftPersistence';
import {
  buildQuestionnaireStorageKey,
  deriveQuestionnaireBrowserNamespace,
} from '@/lib/questionnaireBrowserNamespace';
import { createMemoryStorage } from '@/test/utils/storage';

describe('namespaced draft failure backups', () => {
  it('writes current serializable state to the exact namespace and supports safe reads', async () => {
    const localStorage = createMemoryStorage();
    const storage = createResilientStorage({ indexedDB: null, localStorage });
    const namespaceA = deriveQuestionnaireBrowserNamespace({ userId: 'backup-client-a' });
    const namespaceB = deriveQuestionnaireBrowserNamespace({ userId: 'backup-client-b' });

    const result = await writeDraftFailureBackup({
      namespace: namespaceA,
      storage,
      questionnaireSessionId: 'synthetic-session-a',
      responses: { '6': 'Synthetic backup answer' },
      validationStatus: { '6': 'complete' },
      touchedQuestions: { '6': true },
      expandedQuestions: { '6': true },
      textValidationMeta: { '6': { isDirty: false } },
      error: new Error('must not be persisted'),
    });

    expect(result).toEqual({
      written: true,
      storageMode: STORAGE_MODES.LOCALSTORAGE,
      durable: true,
    });
    const backup = await readDraftFailureBackup({ namespace: namespaceA, storage });
    expect(backup).toMatchObject({
      namespaceVersion: 'v5',
      sessionId: 'synthetic-session-a',
      storageMode: STORAGE_MODES.LOCALSTORAGE,
      form: {
        responses: { '6': 'Synthetic backup answer' },
        textValidationMeta: { '6': { isDirty: false } },
      },
    });
    expect(backup).not.toHaveProperty('error');
    expect(await readDraftFailureBackup({ namespace: namespaceB, storage })).toBeNull();

    const key = buildQuestionnaireStorageKey({ namespace: namespaceA, purpose: 'failure-backup' });
    expect(key).not.toContain('backup-client-a');
  });

  it('reports memory-only backup state truthfully', async () => {
    const storage = createResilientStorage({
      indexedDB: null,
      localStorage: null,
      sessionStorage: null,
    });
    const namespace = deriveQuestionnaireBrowserNamespace({ userId: 'memory-backup-client' });

    const result = await writeDraftFailureBackup({
      namespace,
      storage,
      questionnaireSessionId: 'memory-session',
      responses: {},
      validationStatus: {},
      touchedQuestions: {},
      expandedQuestions: {},
    });

    expect(result).toMatchObject({
      written: true,
      storageMode: STORAGE_MODES.MEMORY_ONLY,
      durable: false,
    });
  });
});
