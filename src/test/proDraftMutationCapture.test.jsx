import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it, vi } from 'vitest';
import formReducer, {
  applyFormMutation,
  resetQuestionState,
  setUiDraftState,
} from '@/components/store/formSlice';
import { createDraftMutationMetadata } from '@/components/store/formMutationFactory';
import NumericRangeQuestion from '@/components/pro-form/NumericRangeQuestion';
import ConfirmModal from '@/components/pro-form/ConfirmModal';
import MultiCertificationQuestion from '@/components/pro-form/MultiCertificationQuestion';
import MultiGuaranteeQuestion from '@/components/pro-form/MultiGuaranteeQuestion';
import AIContentModal from '@/components/pro-form/AIContentModal';

const metadata = (mutationType, reason = 'response_change') => (
  createDraftMutationMetadata({
    mutationId: `${mutationType.replace(/[^a-z]/giu, 'a')}11111111111111111111111111111111`.slice(0, 32),
    mutationType,
    reason,
    changedAtClient: '2026-08-06T12:00:00.000Z',
    sourceTabId: null,
    baseServerRevision: 0,
  })
);

const store = () => configureStore({ reducer: { form: formReducer } });

describe('complete mutation capture', () => {
  it.each(['location_add', 'location_update', 'location_remove', 'location_primary_set'])(
    'captures Q5 %s atomically',
    (mutationType) => {
      const runtime = store();
      runtime.dispatch(applyFormMutation({
        setResponses: {
          '5': [{ name: 'Austin', label: 'Austin', lat: null, lon: null }],
          '5_primary': 0,
        },
        setValidationStatus: { '5': 'complete' },
        setTouchedQuestions: { '5': true },
        lastChangedQuestionId: '5',
        mutationMetadata: metadata(mutationType),
      }));
      const form = runtime.getState().form;
      expect(form.draftContext.clientRevision).toBe(1);
      expect(form.lastMutation.mutationType).toBe(mutationType);
      expect(form.lastChangedQuestionId).toBe('5');
      expect(form.responses['5_primary']).toBe(0);
    },
  );

  it('removes all conditional-child categories in one cleanup revision', () => {
    const runtime = store();
    runtime.dispatch(applyFormMutation({
      setResponses: { '12': 'yes', '12.1': [{ name: 'Certificate' }], '12.1_other': 'legacy' },
      setValidationStatus: { '12.1': 'complete' },
      setTouchedQuestions: { '12.1': true },
      setExpandedQuestions: { '12.1': true },
      setTextValidationMeta: { '12.1': { isDirty: true } },
      setUiDraftState: {
        'question:12.1:certification-editor': {
          kind: 'certification-editor', version: 1, data: { editingIndex: 0 },
          updatedAtClient: '2026-08-06T12:00:00.000Z', sourceTabId: null,
        },
      },
      mutationMetadata: metadata('seed'),
    }));
    runtime.dispatch(applyFormMutation({
      setResponses: { '12': 'no' },
      deleteResponseKeys: ['12.1', '12.1_other', '12.1_primary'],
      setValidationStatus: { '12': 'complete' },
      deleteValidationKeys: ['12.1'],
      deleteTouchedKeys: ['12.1'],
      deleteExpandedKeys: ['12.1'],
      deleteTextValidationMetaKeys: ['12.1'],
      deleteUiDraftStateKeys: ['question:12.1:certification-editor'],
      lastChangedQuestionId: '12',
      mutationMetadata: metadata('conditional_cleanup', 'conditional_cleanup'),
    }));
    const form = runtime.getState().form;
    expect(Object.hasOwn(form.responses, '12.1')).toBe(false);
    expect(Object.hasOwn(form.validationStatus, '12.1')).toBe(false);
    expect(Object.hasOwn(form.uiDraftState, 'question:12.1:certification-editor')).toBe(false);
    expect(form.draftContext.clientRevision).toBe(2);
  });

  it('resets one question and every editor scope without touching another question', () => {
    let form = formReducer(undefined, applyFormMutation({
      setResponses: { '5': ['Austin'], '6': 'keep me' },
      setUiDraftState: {
        'question:5:manual-geographic': {
          kind: 'manual-geographic', version: 1, data: { manualInput: 'Dal' },
          updatedAtClient: '2026-08-06T12:00:00.000Z', sourceTabId: null,
        },
      },
      mutationMetadata: metadata('seed'),
    }));
    form = formReducer(form, resetQuestionState({
      responseKey: '5',
      auxiliaryResponseKeys: ['5_primary'],
      uiDraftScopeKeys: ['question:5:manual-geographic'],
    }));
    expect(form.responses['5']).toBeUndefined();
    expect(form.uiDraftState).toEqual({});
    expect(form.responses['6']).toBe('keep me');
  });

  it('persists and restores incomplete numeric-range input', () => {
    const runtime = store();
    const first = render(
      <Provider store={runtime}>
        <NumericRangeQuestion
          questionId="17"
          draftCaptureEnabled
          value=""
          onChange={vi.fn()}
        />
      </Provider>,
    );
    fireEvent.change(screen.getByLabelText('Smallest company size'), { target: { value: '12' } });
    expect(runtime.getState().form.uiDraftState['question:17:numeric-range'].data.smallestInput)
      .toBe('12');
    first.unmount();
    render(
      <Provider store={runtime}>
        <NumericRangeQuestion
          questionId="17"
          draftCaptureEnabled
          value=""
          onChange={vi.fn()}
        />
      </Provider>,
    );
    expect(screen.getByLabelText('Smallest company size')).toHaveValue('12');
  });

  it('restores confirmation edits and retains an invalid domain draft', () => {
    const change = vi.fn();
    render(
      <ConfirmModal
        formData={{}}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        initialBusinessName="Original"
        initialDomain="original.example"
        confirmationDraft={{ businessName: 'Recovered', domain: 'invalid domain' }}
        onConfirmationDraftChange={change}
      />,
    );
    expect(screen.getByLabelText(/Business Name/u)).toHaveValue('Recovered');
    expect(screen.getByLabelText(/Domain/u)).toHaveValue('invalid domain');
    fireEvent.change(screen.getByLabelText(/Domain/u), { target: { value: 'still invalid' } });
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ domain: 'still invalid' }));
  });

  it('rejects raw File values but accepts safe upload metadata', () => {
    const runtime = store();
    expect(() => runtime.dispatch(setUiDraftState({
      scopeKey: 'question:1:file-upload',
      entry: {
        kind: 'file-upload', version: 1, data: { file: new File(['x'], 'secret.txt') },
        updatedAtClient: '2026-08-06T12:00:00.000Z', sourceTabId: null,
      },
    }))).toThrow();
    runtime.dispatch(setUiDraftState({
      scopeKey: 'question:1:file-upload',
      entry: {
        kind: 'file-upload', version: 1,
        data: {
          originalFileName: 'logo.png', mimeType: 'image/png', sizeBytes: 42,
          uploadStatus: 'uploaded', uploadedUrl: 'https://files.invalid/logo.png',
          base44FileId: null, errorCode: null,
        },
        updatedAtClient: '2026-08-06T12:00:00.000Z', sourceTabId: null,
      },
    }));
    expect(runtime.getState().form.uiDraftState['question:1:file-upload'].data.uploadStatus)
      .toBe('uploaded');
  });

  it.each([
    {
      scopeKey: 'question:12.1:certification-editor',
      kind: 'certification-editor',
      value: [{ name: 'Recovered certification', type: 'certification', saved: true, files: [] }],
      Component: MultiCertificationQuestion,
    },
    {
      scopeKey: 'question:15.1:guarantee-editor',
      kind: 'guarantee-editor',
      value: [{
        name: 'Recovered guarantee', type: 'guarantee', description: 'Details', saved: true,
      }],
      Component: MultiGuaranteeQuestion,
    },
  ])('restores the $kind editing position', ({ scopeKey, kind, value, Component }) => {
    const runtime = store();
    runtime.dispatch(setUiDraftState({
      scopeKey,
      entry: {
        kind,
        version: 1,
        data: { editingIndex: 0, validationCodes: [] },
        updatedAtClient: '2026-08-06T12:00:00.000Z',
        sourceTabId: null,
      },
    }));
    render(
      <Provider store={runtime}>
        <Component
          questionId={scopeKey.split(':')[1]}
          draftCaptureEnabled
          value={value}
          onChange={vi.fn()}
        />
      </Provider>,
    );
    expect(screen.getByDisplayValue(value[0].name)).toBeVisible();
  });

  it('restores client-authored AI instructions, draft text, questions, and status', () => {
    const onRecoverableStateChange = vi.fn();
    render(
      <AIContentModal
        open
        onClose={vi.fn()}
        currentValue=""
        questionContext="Question 6: Company description"
        onInject={vi.fn()}
        recoverableState={{
          userInstruction: 'Keep this instruction',
          draftContent: 'Recovered client draft',
          aiQuestions: 'Which audience? What outcome?',
          status: 'needs_information',
        }}
        onRecoverableStateChange={onRecoverableStateChange}
      />,
    );
    expect(screen.getByDisplayValue('Keep this instruction')).toBeVisible();
    expect(screen.getByDisplayValue('Recovered client draft')).toBeVisible();
    expect(screen.getByText('Which audience? What outcome?')).toBeVisible();
    fireEvent.change(screen.getByDisplayValue('Keep this instruction'), {
      target: { value: 'Updated instruction' },
    });
    expect(onRecoverableStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
      userInstruction: 'Updated instruction',
      status: 'editing',
    }));
  });
});
