import React from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import ProQuestionnaire from '@/pages/ProQuestionnaire';
import { readDraftFailureBackup, writeDraftFailureBackup } from '@/lib/draftPersistence';
import { renderWithStore } from '@/test/utils/renderWithStore';
import { createResilientStorage } from '@/lib/resilientStorage';
import {
  buildQuestionnaireStorageKey,
  deriveQuestionnaireBrowserNamespace,
} from '@/lib/questionnaireBrowserNamespace';

const emptyFormState = (overrides = {}) => ({
  form: {
    responses: {},
    validationStatus: {},
    touchedQuestions: {},
    expandedQuestions: {},
    credentials: {},
    textValidationMeta: {},
    ...overrides,
  },
});

let base44;

describe('baseline characterization: server restore and failure backups', () => {
  beforeAll(async () => {
    ({ base44 } = await import('@/api/base44Client'));
  });

  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(
      {},
      '',
      '/?businessName=Synthetic%20Recovery%20Client&domainName=recovery.invalid'
    );
    base44.entities.ProFormDraft.filter.mockReset();
    base44.entities.ProFormDraft.create.mockReset();
    base44.entities.ProFormDraft.update.mockReset();
    base44.entities.ProFormDraftEvent.create.mockReset();
  });

  it('[BC-REC-001][DR-REC-001][DR-SAVE-001] does not request or hydrate a matching server draft', async () => {
    base44.entities.ProFormDraft.filter.mockResolvedValue([{
      id: 'synthetic-server-draft',
      session_id: 'synthetic-server-session',
      business_name: 'Synthetic Recovery Client',
      domain: 'recovery.invalid',
      responses_json: JSON.stringify({ '6': 'Synthetic server-only answer' }),
    }]);

    const { store } = renderWithStore(
      <ProQuestionnaire />,
      { preloadedState: emptyFormState() }
    );

    expect(await screen.findByTestId('question-wrapper-6')).toBeInTheDocument();
    expect(store.getState().form.responses['6']).toBeUndefined();
    expect(base44.entities.ProFormDraft.filter).not.toHaveBeenCalled();
  });

  it('[BC-REC-002][DR-REC-001][DR-LOCAL-001] renders Redux state instead of the mocked server draft', async () => {
    base44.entities.ProFormDraft.filter.mockResolvedValue([{
      id: 'synthetic-server-draft',
      responses_json: JSON.stringify({ '6': 'Synthetic server answer' }),
    }]);

    renderWithStore(
      <ProQuestionnaire />,
      {
        preloadedState: emptyFormState({
          responses: { '6': 'Synthetic browser Redux answer' },
          expandedQuestions: { '6': true },
        }),
      }
    );

    const question = await screen.findByTestId('question-wrapper-6');
    expect(within(question).getByRole('textbox')).toHaveValue('Synthetic browser Redux answer');
    expect(base44.entities.ProFormDraft.filter).not.toHaveBeenCalled();
  });

  it('[BC-LOCAL-005][DR-LOCAL-001][DR-LOCAL-002] writes a scoped failure backup without auto-hydrating it', async () => {
    const namespace = deriveQuestionnaireBrowserNamespace({ userId: 'synthetic-client-a' });
    const storage = createResilientStorage({ indexedDB: null, localStorage });
    await writeDraftFailureBackup({
      namespace,
      storage,
      questionnaireSessionId: 'synthetic-session-a',
      responses: { '6': 'Synthetic backup answer' },
      validationStatus: { '6': 'complete' },
      touchedQuestions: { '6': true },
      expandedQuestions: { '6': true },
    });

    const backupKey = buildQuestionnaireStorageKey({
      namespace,
      purpose: 'failure-backup',
    });
    const backup = await readDraftFailureBackup({ namespace, storage });

    expect(backup.form.responses['6']).toBe('Synthetic backup answer');
    expect(backup.storageMode).toBe('localstorage');
    expect(backupKey).not.toContain('synthetic-client-a');
    expect(localStorage.getItem('pro_questionnaire_local_backup_synthetic-session-a')).toBeNull();
  });

  it('[BC-REC-003][DR-REC-001][DR-BOOT-001] ignores both valid and malformed stored backups on page bootstrap', async () => {
    localStorage.setItem(
      'pro_questionnaire_local_backup_synthetic-valid',
      JSON.stringify({ responses: { '6': 'Synthetic valid backup answer' } })
    );
    localStorage.setItem(
      'pro_questionnaire_local_backup_synthetic-malformed',
      '{not-valid-json'
    );

    const { store } = renderWithStore(
      <ProQuestionnaire />,
      { preloadedState: emptyFormState() }
    );

    expect(await screen.findByTestId('question-wrapper-6')).toBeInTheDocument();
    expect(store.getState().form.responses['6']).toBeUndefined();
    expect(base44.entities.ProFormDraft.filter).not.toHaveBeenCalled();
  });
});
