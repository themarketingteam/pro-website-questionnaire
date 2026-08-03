import React from 'react';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConfirmModal from '@/components/pro-form/ConfirmModal';
import ThankYouModal from '@/components/pro-form/ThankYouModal';
import { useQuestionnairePdfDownload } from '@/components/pro-form/pdf/useQuestionnairePdfDownload';
import TestZapier from '@/pages/TestZapier';

const { generatePDFMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  generatePDFMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock('@/components/pro-form/PDFGenerator', () => ({
  default: vi.fn(),
  generatePDF: generatePDFMock,
}));

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}));

const createHookProps = (overrides = {}) => ({
  formData: { '6': 'A retained company description' },
  businessName: 'Example Company',
  domain: 'example.com',
  ...overrides,
});

const renderConfirmModal = (props = {}) => {
  const formData = props.formData || { '6': 'Live modal response' };

  render(
    React.createElement(ConfirmModal, {
      formData,
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
      ...props,
    })
  );

  return formData;
};

describe('useQuestionnairePdfDownload', () => {
  beforeEach(() => {
    generatePDFMock.mockReset();
    toastErrorMock.mockReset();
    toastSuccessMock.mockReset();
  });

  it('blocks duplicate downloads while the first PDF is still generating', async () => {
    let resolveGeneration;
    generatePDFMock.mockImplementation(
      () => new Promise((resolve) => {
        resolveGeneration = resolve;
      })
    );

    const { result } = renderHook(() =>
      useQuestionnairePdfDownload(createHookProps())
    );

    let firstDownload;
    act(() => {
      firstDownload = result.current.downloadPDF();
    });

    await waitFor(() => expect(result.current.isGeneratingPDF).toBe(true));

    let duplicateResult;
    await act(async () => {
      duplicateResult = await result.current.downloadPDF();
    });

    expect(duplicateResult).toEqual({ success: false, blocked: true });
    expect(generatePDFMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveGeneration({ success: true, filename: 'responses.pdf' });
      await firstDownload;
    });
  });

  it('reports a successful PDF download', async () => {
    generatePDFMock.mockResolvedValue({
      success: true,
      filename: 'responses.pdf',
    });
    const props = createHookProps();
    const { result } = renderHook(() => useQuestionnairePdfDownload(props));

    await act(async () => {
      await result.current.downloadPDF();
    });

    expect(generatePDFMock).toHaveBeenCalledWith(
      props.formData,
      props.businessName,
      props.domain
    );
    expect(toastSuccessMock).toHaveBeenCalledWith(
      'PDF downloaded: responses.pdf'
    );
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('reports a declared PDF generation failure', async () => {
    generatePDFMock.mockResolvedValue({ success: false });
    const { result } = renderHook(() =>
      useQuestionnairePdfDownload(createHookProps())
    );

    await act(async () => {
      await result.current.downloadPDF();
    });

    expect(toastErrorMock).toHaveBeenCalledWith(
      'Failed to generate PDF. Please try again.'
    );
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it('catches thrown PDF errors without logging form data', async () => {
    const generationError = new Error('canvas failed');
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    generatePDFMock.mockRejectedValue(generationError);
    const props = createHookProps({
      formData: { secretResponse: 'must-not-be-logged' },
    });
    const { result } = renderHook(() => useQuestionnairePdfDownload(props));

    await act(async () => {
      await result.current.downloadPDF();
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Questionnaire PDF] generation failed:',
      generationError
    );
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      props.formData
    );
    expect(toastErrorMock).toHaveBeenCalledWith(
      'Failed to generate PDF. Please try again.'
    );
  });

  it('always clears the generating state after generation settles', async () => {
    generatePDFMock.mockRejectedValue(new Error('generation failed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() =>
      useQuestionnairePdfDownload(createHookProps())
    );

    await act(async () => {
      await result.current.downloadPDF();
    });

    expect(result.current.isGeneratingPDF).toBe(false);
  });
});

describe('questionnaire PDF download call sites', () => {
  beforeEach(() => {
    generatePDFMock.mockReset();
    generatePDFMock.mockResolvedValue({
      success: true,
      filename: 'responses.pdf',
    });
    toastErrorMock.mockReset();
    toastSuccessMock.mockReset();
  });

  it('uses the ConfirmModal live business name and cleaned domain', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const formData = renderConfirmModal({
      initialBusinessName: 'Old Business',
      initialDomain: 'old.example',
    });

    const businessNameInput = screen.getByLabelText(/business name/i);
    const domainInput = screen.getByLabelText(/^domain/i);
    await user.clear(businessNameInput);
    await user.type(businessNameInput, 'Live Business');
    await user.clear(domainInput);
    await user.type(domainInput, 'https://www.live.example/');
    await user.click(screen.getByRole('button', { name: /download pdf/i }));

    await waitFor(() => {
      expect(generatePDFMock).toHaveBeenCalledWith(
        formData,
        'Live Business',
        'live.example'
      );
    });
  });

  it('requires a ConfirmModal business name but allows a blank PDF domain', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderConfirmModal();

    await user.click(screen.getByRole('button', { name: /download pdf/i }));

    expect(toastErrorMock).toHaveBeenCalledWith(
      'Please enter a business name before downloading.'
    );
    expect(generatePDFMock).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/business name/i), 'Domain Optional');
    await user.click(screen.getByRole('button', { name: /download pdf/i }));

    await waitFor(() => {
      expect(generatePDFMock).toHaveBeenCalledWith(
        expect.any(Object),
        'Domain Optional',
        ''
      );
    });
  });

  it('uses the submitted snapshot supplied to ThankYouModal', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const responseSnapshot = {
      '6': 'Snapshot retained after reset',
      '24': 'Schedule a Consultation',
    };

    render(
      React.createElement(ThankYouModal, {
        businessName: 'Submitted Business',
        domain: 'submitted.example',
        formData: responseSnapshot,
      })
    );

    await user.click(
      screen.getByRole('button', {
        name: /download your responses \(pdf\)/i,
      })
    );

    await waitFor(() => {
      expect(generatePDFMock).toHaveBeenCalledWith(
        responseSnapshot,
        'Submitted Business',
        'submitted.example'
      );
    });
  });

  it('keeps the TestZapier thank-you preview compatible with PDF generation', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(React.createElement(TestZapier));

    await user.click(screen.getByRole('button', { name: /show preview/i }));
    await user.click(
      screen.getByRole('button', {
        name: /download your responses \(pdf\)/i,
      })
    );

    await waitFor(() => {
      expect(generatePDFMock).toHaveBeenCalledWith(
        expect.objectContaining({
          '6': expect.stringContaining('leading provider of managed IT services'),
          '24': 'Schedule a Consultation',
        }),
        'Test Company',
        'test.com'
      );
    });
  });
});
