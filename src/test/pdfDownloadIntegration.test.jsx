import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConfirmModal from '@/components/pro-form/ConfirmModal';
import ThankYouModal from '@/components/pro-form/ThankYouModal';
import ThankYou from '@/pages/ThankYou';

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

const realisticFormData = {
  '1': 'yes',
  '1.1': 'We combine strategic consulting with responsive local support.',
  '2': 'no',
  '3': ['Managed IT', 'Cybersecurity', 'Cloud Services'],
  '4': ['Healthcare / Medical', 'Financial Services'],
  '5': [{ label: 'Chicago, IL', lat: 41.8781, lon: -87.6298 }],
  '6': 'Example MSP provides secure managed technology services.',
  '7': 'Fully Managed IT Provider',
  '8': ['Per-user pricing'],
  '9': 'Our senior engineers resolve complex issues without handoffs.',
  '10': ['Increase recurring revenue'],
  '11': 'Professional & Corporate',
  '12': 'no',
  '13': 'Discovery, assessment, proposal, onboarding, and optimization.',
  '14': 'no',
  '15': 'Referrals / Word of Mouth',
  '16': ['Generate qualified leads'],
  '17': '10-50 employees',
  '18': ['Frequent downtime or outages'],
  '19': 'Clients are frustrated by reactive support and unclear ownership.',
  '20': ['Reliable systems and less downtime'],
  '21': 'Reliable, proactive, and easy to work with.',
  '22': 'A growing regulated business with a lean internal IT team.',
  '23': 'no',
  '24': 'Schedule a Consultation',
  '25': 'no',
};

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
};

const renderConfirmModal = (overrides = {}) => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();

  render(
    <ConfirmModal
      formData={realisticFormData}
      initialBusinessName="Initial Business"
      initialDomain="initial.example"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />
  );

  return { onConfirm, onCancel };
};

const renderThankYouModal = (overrides = {}) => {
  const props = {
    businessName: 'Submitted MSP',
    domain: 'submitted.example',
    formData: realisticFormData,
    ...overrides,
  };

  render(<ThankYouModal {...props} />);
  return props;
};

beforeEach(() => {
  generatePDFMock.mockReset();
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ConfirmModal PDF download integration', () => {
  it('downloads exactly once with live form data, edited business details, and no submission', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    generatePDFMock.mockResolvedValue({
      success: true,
      filename: 'LiveMSP_questionnaire.pdf',
    });
    const { onConfirm } = renderConfirmModal();

    const businessNameInput = screen.getByLabelText(/business name/i);
    const domainInput = screen.getByLabelText(/^domain/i);
    await user.clear(businessNameInput);
    await user.type(businessNameInput, 'Live MSP');
    await user.clear(domainInput);
    await user.type(domainInput, 'https://www.live.example/client/');
    await user.click(screen.getByRole('button', { name: /download pdf/i }));

    await waitFor(() => {
      expect(generatePDFMock).toHaveBeenCalledTimes(1);
      expect(generatePDFMock).toHaveBeenCalledWith(
        realisticFormData,
        'Live MSP',
        'live.example/client'
      );
      expect(toastSuccessMock).toHaveBeenCalledWith(
        'PDF downloaded: LiveMSP_questionnaire.pdf'
      );
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('blocks an empty business name with the exact validation toast', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderConfirmModal({ initialBusinessName: '' });

    await user.click(screen.getByRole('button', { name: /download pdf/i }));

    expect(generatePDFMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(
      'Please enter a business name before downloading.'
    );
  });

  it('shows loading, disables the button, and blocks a rapid duplicate click', async () => {
    const deferred = createDeferred();
    generatePDFMock.mockReturnValue(deferred.promise);
    renderConfirmModal();
    const downloadButton = screen.getByRole('button', { name: /download pdf/i });

    act(() => {
      fireEvent.click(downloadButton);
      fireEvent.click(downloadButton);
    });

    await waitFor(() => {
      expect(generatePDFMock).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: /generating/i })).toBeDisabled();
    });

    await act(async () => {
      deferred.resolve({ success: true, filename: 'pending.pdf' });
      await deferred.promise;
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /download pdf/i })).toBeEnabled();
    });
  });

  it('shows the declared-failure toast and restores the button', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    generatePDFMock.mockResolvedValue({ success: false });
    renderConfirmModal();

    await user.click(screen.getByRole('button', { name: /download pdf/i }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        'Failed to generate PDF. Please try again.'
      );
      expect(screen.getByRole('button', { name: /download pdf/i })).toBeEnabled();
    });
  });

  it('shows the unexpected-error toast after a thrown exception', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const generationError = new Error('canvas failed');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    generatePDFMock.mockRejectedValue(generationError);
    renderConfirmModal();

    await user.click(screen.getByRole('button', { name: /download pdf/i }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        'An error occurred while generating the PDF.'
      );
      expect(screen.getByRole('button', { name: /download pdf/i })).toBeEnabled();
    });
  });
});

describe('ThankYouModal PDF download integration', () => {
  it('downloads once with the exact submitted snapshot and business details without Redux', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    generatePDFMock.mockResolvedValue({
      success: true,
      filename: 'SubmittedMSP_questionnaire.pdf',
    });
    const props = renderThankYouModal();

    await user.click(
      screen.getByRole('button', { name: /download your responses \(pdf\)/i })
    );

    await waitFor(() => {
      expect(generatePDFMock).toHaveBeenCalledTimes(1);
      expect(generatePDFMock).toHaveBeenCalledWith(
        props.formData,
        props.businessName,
        props.domain
      );
      expect(toastSuccessMock).toHaveBeenCalledWith(
        'PDF downloaded: SubmittedMSP_questionnaire.pdf'
      );
    });
  });

  it('shows loading, disables the button, and blocks a rapid duplicate click', async () => {
    const deferred = createDeferred();
    generatePDFMock.mockReturnValue(deferred.promise);
    renderThankYouModal();
    const downloadButton = screen.getByRole('button', {
      name: /download your responses \(pdf\)/i,
    });

    act(() => {
      fireEvent.click(downloadButton);
      fireEvent.click(downloadButton);
    });

    expect(generatePDFMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /generating pdf/i })).toBeDisabled();

    await act(async () => {
      deferred.resolve({ success: true, filename: 'pending.pdf' });
      await deferred.promise;
    });

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /download your responses \(pdf\)/i })
      ).toBeEnabled();
    });
  });

  it('shows the declared-failure toast', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    generatePDFMock.mockResolvedValue({ success: false });
    renderThankYouModal();

    await user.click(
      screen.getByRole('button', { name: /download your responses \(pdf\)/i })
    );

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        'Failed to generate PDF. Please try again.'
      );
    });
  });

  it('restores the button and shows the unexpected-error toast after rejection', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    generatePDFMock.mockRejectedValue(new Error('rendering failed'));
    renderThankYouModal();

    await user.click(
      screen.getByRole('button', { name: /download your responses \(pdf\)/i })
    );

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        'An error occurred while generating the PDF.'
      );
      expect(
        screen.getByRole('button', { name: /download your responses \(pdf\)/i })
      ).toBeEnabled();
    });
  });
});

describe('standalone ThankYou route', () => {
  it('does not expose a PDF download without a submitted response snapshot', () => {
    window.history.replaceState(
      {},
      '',
      '/thank-you?businessName=Route%20Only%20MSP'
    );

    render(<ThankYou />);

    expect(screen.getByText('Route Only MSP')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /download.*pdf/i })
    ).not.toBeInTheDocument();
    expect(generatePDFMock).not.toHaveBeenCalled();
  });
});
