import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import formReducer from '@/components/store/formSlice';
import { ProDraftCredentialProvider } from '@/contexts/ProDraftCredentialContext';

vi.mock('@/lib/proDraftRuntimeConfig', async () => {
  const actual = await vi.importActual('@/lib/proDraftRuntimeConfig');
  return {
    ...actual,
    frontendRuntimeConfig: Object.freeze({
      environment: 'staging',
      durableDraftV2Enabled: true,
      publicEmailRecoveryEnabled: true,
      killSwitchEnabled: false,
    }),
  };
});

vi.mock('@/components/pro-form/ProDraftBootstrapGate', () => ({
  default: ({ children }) => (
    <ProDraftCredentialProvider coordinator={{
      getRecoveryCodeForDisplay: () => null,
      getRecoveryCodeHint: () => 'JKMN',
      getCredentialStorageMode: () => 'indexeddb',
    }}>
      {children}
    </ProDraftCredentialProvider>
  ),
}));

import ProQuestionnaire from '@/pages/ProQuestionnaire';

describe('V2 questionnaire recovery panel integration', () => {
  it('renders one primary panel immediately before Question 1 and one compact footer disclosure', async () => {
    const store = configureStore({ reducer: { form: formReducer } });
    render(
      <Provider store={store}>
        <MemoryRouter>
          <ProQuestionnaire />
        </MemoryRouter>
      </Provider>,
    );

    const panel = await screen.findByTestId('pro-draft-recovery-panel');
    const questionOne = await screen.findByTestId('question-wrapper-1');
    expect(panel.compareDocumentPosition(questionOne) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(screen.getAllByTestId('pro-draft-recovery-panel')).toHaveLength(1);
    expect(screen.getByTestId('pro-draft-recovery-footer')).toBeInTheDocument();
    expect(document.querySelector('header')?.textContent || '').not.toContain('Draft recovery');
    expect(questionOne).toHaveAttribute('id', 'question-1');
  });
});
