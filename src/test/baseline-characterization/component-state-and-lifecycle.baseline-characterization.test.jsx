import React from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProQuestionnaire from '@/pages/ProQuestionnaire';
import ConfirmModal from '@/components/pro-form/ConfirmModal';
import { renderWithStore } from '@/test/utils/renderWithStore';

const formState = (overrides = {}) => ({
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

const renderQuestionnaireWithStore = async (options) => {
  let rendered;

  await act(async () => {
    rendered = renderWithStore(<ProQuestionnaire />, options);
    await Promise.resolve();
    await Promise.resolve();
  });

  return rendered;
};

let base44;

describe('baseline characterization: component-local editor state', () => {
  beforeAll(async () => {
    ({ base44 } = await import('@/api/base44Client'));
  });

  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/?businessName=Synthetic%20UI%20Client&domainName=ui.invalid');
    window.google = {
      maps: {
        importLibrary: vi.fn().mockResolvedValue({}),
        places: {
          PlaceAutocompleteElement: function PlaceAutocompleteElement() {
            return document.createElement('div');
          },
        },
      },
    };
    base44.entities.ProFormDraft.filter.mockResolvedValue([]);
    base44.entities.ProFormDraft.create.mockResolvedValue({ id: 'synthetic-draft' });
    base44.entities.ProFormDraft.update.mockResolvedValue({ id: 'synthetic-draft' });
  });

  it('[BC-UI-001][DR-SAVE-001][DR-MUT-001] loses an unconfirmed numeric range on page remount', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const first = await renderQuestionnaireWithStore(
      { preloadedState: formState({ expandedQuestions: { '17': true } }) }
    );

    const firstWrapper = await screen.findByTestId('question-wrapper-17');
    const firstInputs = within(firstWrapper).getAllByRole('textbox');
    await act(async () => {
      await user.clear(firstInputs[0]);
      await user.type(firstInputs[0], '7');
    });

    expect(firstInputs[0]).toHaveValue('7');
    expect(first.store.getState().form.responses['17']).toBe('');

    const reloadedState = { form: first.store.getState().form };
    first.unmount();
    await renderQuestionnaireWithStore({ preloadedState: reloadedState });

    const reloadedWrapper = await screen.findByTestId('question-wrapper-17');
    expect(within(reloadedWrapper).getAllByRole('textbox')[0]).toHaveValue('1');
  });

  it('[BC-UI-002][DR-SAVE-001][DR-MUT-001] loses manual geographic text that was not added', async () => {
    const first = await renderQuestionnaireWithStore(
      { preloadedState: formState({ expandedQuestions: { '5': true } }) }
    );

    fireEvent.click(await screen.findByRole('button', { name: /add manually/i }));
    const manualInput = screen.getByPlaceholderText(/enter location manually/i);
    fireEvent.change(manualInput, { target: { value: 'Synthetic Uncommitted Region' } });

    expect(manualInput).toHaveValue('Synthetic Uncommitted Region');
    expect(first.store.getState().form.responses['5']).toBeUndefined();

    const reloadedState = { form: first.store.getState().form };
    first.unmount();
    await renderQuestionnaireWithStore({ preloadedState: reloadedState });

    fireEvent.click(await screen.findByRole('button', { name: /add manually/i }));
    expect(screen.getByPlaceholderText(/enter location manually/i)).toHaveValue('');
  });

  it('[BC-UI-003][DR-SAVE-001][DR-MUT-001] loses a partially completed image-person editor', async () => {
    const canonicalPhoto = {
      url: 'https://example.invalid/synthetic-team.png',
      name: 'synthetic-team.png',
      type: 'image/png',
      tags: [],
    };
    const first = await renderQuestionnaireWithStore(
      {
        preloadedState: formState({
          responses: { '2': 'yes', '2.2': canonicalPhoto },
          expandedQuestions: { '2': true, '2.2': true },
        }),
      }
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Tag People' }));
    const image = await screen.findByAltText('Team');
    vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      right: 100,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.click(image, { clientX: 25, clientY: 40 });
    fireEvent.change(await screen.findByPlaceholderText('John Smith'), {
      target: { value: 'Synthetic Person' },
    });

    expect(screen.getByPlaceholderText('John Smith')).toHaveValue('Synthetic Person');
    expect(first.store.getState().form.responses['2.2'].tags).toEqual([]);

    const reloadedState = { form: first.store.getState().form };
    first.unmount();
    await renderQuestionnaireWithStore({ preloadedState: reloadedState });

    fireEvent.click(await screen.findByRole('button', { name: 'Tag People' }));
    expect(screen.queryByPlaceholderText('John Smith')).not.toBeInTheDocument();
    expect(screen.getByText(/tagged people \(0\)/i)).toBeInTheDocument();
  });

  it('[BC-UI-004][DR-SAVE-001] loses unsubmitted confirmation business/domain edits on remount', async () => {
    const onConfirm = vi.fn();
    const first = render(
      <ConfirmModal
        formData={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        initialBusinessName="Synthetic Initial Business"
        initialDomain="initial.invalid"
      />
    );

    const businessInput = screen.getByLabelText(/business name/i);
    const domainInput = screen.getByLabelText(/domain/i);
    fireEvent.change(businessInput, { target: { value: 'Synthetic Edited Business' } });
    fireEvent.change(domainInput, { target: { value: 'edited.invalid' } });

    expect(businessInput).toHaveValue('Synthetic Edited Business');
    expect(domainInput).toHaveValue('edited.invalid');
    expect(onConfirm).not.toHaveBeenCalled();

    first.unmount();
    render(
      <ConfirmModal
        formData={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        initialBusinessName="Synthetic Initial Business"
        initialDomain="initial.invalid"
      />
    );

    expect(screen.getByLabelText(/business name/i)).toHaveValue('Synthetic Initial Business');
    expect(screen.getByLabelText(/domain/i)).toHaveValue('initial.invalid');
  });
});

describe('baseline characterization: lifecycle registration and save paths', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/?businessName=Synthetic%20Lifecycle%20Client');
    window.google = {
      maps: {
        importLibrary: vi.fn().mockResolvedValue({}),
        places: {
          PlaceAutocompleteElement: function PlaceAutocompleteElement() {
            return document.createElement('div');
          },
        },
      },
    };
    base44.entities.ProFormDraft.create.mockClear();
    base44.entities.ProFormDraft.update.mockClear();
    base44.entities.ProFormDraftEvent.create.mockClear();
  });

  it('[BC-LIFE-001][DR-OFFLINE-001][DR-LOCAL-001] registers only beforeunload and writes only a local backup', async () => {
    const windowAddSpy = vi.spyOn(window, 'addEventListener');
    const documentAddSpy = vi.spyOn(document, 'addEventListener');

    await renderQuestionnaireWithStore(
      {
        preloadedState: formState({
          responses: { '6': 'Synthetic lifecycle answer' },
          validationStatus: { '6': 'complete' },
        }),
      }
    );

    expect(await screen.findByTestId('question-wrapper-6')).toBeInTheDocument();

    const windowTypes = windowAddSpy.mock.calls.map(([type]) => type);
    const documentTypes = documentAddSpy.mock.calls.map(([type]) => type);

    expect(windowTypes).toContain('beforeunload');
    expect([...windowTypes, ...documentTypes]).not.toContain('visibilitychange');
    expect(windowTypes).not.toContain('pagehide');
    expect(windowTypes).not.toContain('online');
    expect(windowTypes).not.toContain('offline');

    window.dispatchEvent(new Event('beforeunload'));

    await waitFor(() => {
      const backupKey = Object.keys(localStorage).find((key) =>
        key.startsWith('pro_questionnaire_local_backup_')
      );
      expect(backupKey).toBeTruthy();
      const backup = JSON.parse(localStorage.getItem(backupKey));
      expect(backup.responses['6']).toBe('Synthetic lifecycle answer');
    });

    expect(base44.entities.ProFormDraft.create).not.toHaveBeenCalled();
    expect(base44.entities.ProFormDraft.update).not.toHaveBeenCalled();
    expect(base44.entities.ProFormDraftEvent.create).not.toHaveBeenCalled();
  });
});
