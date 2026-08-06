import { describe, expect, it } from 'vitest';
import {
  LEGACY_QUESTIONNAIRE_STORAGE_KEYS,
  inspectLegacyQuestionnaireStorage,
  readLegacyQuestionnaireValueForMigration,
} from '@/lib/legacyQuestionnaireStorage';
import { createMemoryStorage } from '@/test/utils/storage';

describe('legacy questionnaire storage policy', () => {
  it('reports metadata without returning values or deleting ambiguous data', () => {
    const storage = createMemoryStorage({
      [LEGACY_QUESTIONNAIRE_STORAGE_KEYS.REDUX_STATE]: 'client-a-state',
      [LEGACY_QUESTIONNAIRE_STORAGE_KEYS.SESSION_ID]: 'client-a-session',
      [`${LEGACY_QUESTIONNAIRE_STORAGE_KEYS.FAILURE_BACKUP_PREFIX}one`]: 'backup-one',
      [`${LEGACY_QUESTIONNAIRE_STORAGE_KEYS.FAILURE_BACKUP_PREFIX}two`]: 'backup-two',
    });

    const metadata = inspectLegacyQuestionnaireStorage({ storage });

    expect(metadata).toEqual([
      { keyType: 'redux-state', presence: true, byteSize: expect.any(Number) },
      { keyType: 'session-id', presence: true, byteSize: expect.any(Number) },
      { keyType: 'failure-backup', presence: true, byteSize: expect.any(Number) },
    ]);
    expect(JSON.stringify(metadata)).not.toContain('client-a-state');
    expect(JSON.stringify(metadata)).not.toContain('client-a-session');
    expect(readLegacyQuestionnaireValueForMigration({
      keyType: 'redux-state',
      storage,
    })).toBeNull();
    expect(storage.getItem(LEGACY_QUESTIONNAIRE_STORAGE_KEYS.REDUX_STATE))
      .toBe('client-a-state');
    expect(storage.getItem(LEGACY_QUESTIONNAIRE_STORAGE_KEYS.SESSION_ID))
      .toBe('client-a-session');
  });

  it('requires an explicit authorized migration read after ownership is resolved', () => {
    const legacyBackupKey = `${LEGACY_QUESTIONNAIRE_STORAGE_KEYS.FAILURE_BACKUP_PREFIX}resolved`;
    const storage = createMemoryStorage({
      [LEGACY_QUESTIONNAIRE_STORAGE_KEYS.SESSION_ID]: 'resolved-session',
      [legacyBackupKey]: 'resolved-backup',
    });

    expect(readLegacyQuestionnaireValueForMigration({
      keyType: 'session-id',
      storage,
      authorized: true,
    })).toBe('resolved-session');
    expect(readLegacyQuestionnaireValueForMigration({
      keyType: 'failure-backup',
      legacyKey: legacyBackupKey,
      storage,
      authorized: true,
    })).toBe('resolved-backup');
  });
});
