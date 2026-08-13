import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { base44 } from '@/api/base44Client';
import AdminQuestionnairePdfButton from '@/components/admin/AdminQuestionnairePdfButton';
import {
  buildQuestionnairePdfSnapshot,
  hashQuestionnairePdfSnapshot
} from '@/lib/questionnairePdfVersions';

const { createQuestionnairePdfFileMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  createQuestionnairePdfFileMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn()
}));

vi.mock('@/components/pro-form/PDFGenerator', () => ({
  createQuestionnairePdfFile: createQuestionnairePdfFileMock
}));

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock
  }
}));

const payload = {
  metadata: {
    business_name: 'Saved MSP',
    businessDomain: 'saved.example',
    submission_datetime: '2026-08-11T15:00:00.000Z'
  },
  userdata: {
    additional_pages_list: {},
    company_description: 'Saved response'
  }
};

const defaultProps = {
  sourceType: 'draft',
  sourceId: 'draft-1',
  sessionId: 'session-1',
  payload,
  recoveryGrant: 'signed-recovery-grant'
};

beforeEach(() => {
  createQuestionnairePdfFileMock.mockReset();
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  base44.functions.invoke.mockReset();
  base44.integrations.Core.UploadFile.mockReset();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:questionnaire-pdf')
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn()
  });
  globalThis.fetch = vi.fn();
});

describe('AdminQuestionnairePdfButton', () => {
  it('downloads the latest saved version without regenerating when the payload hash matches', async () => {
    const snapshot = buildQuestionnairePdfSnapshot({ payload });
    const payloadHash = await hashQuestionnairePdfSnapshot(snapshot);
    const savedPdf = new Blob(['saved-pdf'], { type: 'application/pdf' });
    globalThis.fetch.mockResolvedValue({ ok: true, blob: async () => savedPdf });
    base44.functions.invoke.mockResolvedValue({
      data: {
        success: true,
        version: {
          payload_hash: payloadHash,
          file_url: 'https://files.example/saved.pdf',
          file_name: 'SavedMSP.pdf',
          version_number: 2
        }
      }
    });

    render(<AdminQuestionnairePdfButton {...defaultProps} />);
    await userEvent.click(screen.getByRole('button', { name: /download pdf/i }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('https://files.example/saved.pdf');
      expect(toastSuccessMock).toHaveBeenCalledWith('PDF downloaded: SavedMSP.pdf');
    });
    expect(createQuestionnairePdfFileMock).not.toHaveBeenCalled();
    expect(base44.integrations.Core.UploadFile).not.toHaveBeenCalled();
  });

  it('generates, uploads, saves, and downloads a new version when no current PDF exists', async () => {
    const generatedFile = new File(['generated-pdf'], 'SavedMSP.pdf', { type: 'application/pdf' });
    createQuestionnairePdfFileMock.mockResolvedValue({
      success: true,
      filename: generatedFile.name,
      file: generatedFile
    });
    base44.integrations.Core.UploadFile.mockResolvedValue({
      file_url: 'https://files.example/generated.pdf'
    });
    base44.functions.invoke.mockImplementation(async (_name, body) => {
      if (body.action === 'latest') return { data: { success: true, version: null } };
      return {
        data: {
          success: true,
          created: true,
          version: {
            payload_hash: body.payloadHash,
            file_url: body.fileUrl,
            file_name: body.fileName,
            version_number: 1
          }
        }
      };
    });

    render(<AdminQuestionnairePdfButton {...defaultProps} />);
    await userEvent.click(screen.getByRole('button', { name: /download pdf/i }));

    await waitFor(() => {
      expect(createQuestionnairePdfFileMock).toHaveBeenCalledWith(
        expect.objectContaining({ '6': 'Saved response' }),
        'Saved MSP',
        'saved.example',
        { submissionDate: '2026-08-11T15:00:00.000Z' }
      );
      expect(base44.integrations.Core.UploadFile).toHaveBeenCalledWith({ file: generatedFile });
      expect(toastSuccessMock).toHaveBeenCalledWith('PDF version 1 saved and downloaded.');
    });
    expect(base44.functions.invoke).toHaveBeenCalledWith(
      'manageQuestionnairePdfVersions',
      expect.objectContaining({
        action: 'save',
        sourceType: 'draft',
        sourceId: 'draft-1',
        sessionId: 'session-1',
        fileUrl: 'https://files.example/generated.pdf',
        recoveryGrant: 'signed-recovery-grant'
      })
    );
  });

  it('replaces a legacy-template PDF once, then reuses the unchanged current revision', async () => {
    const snapshot = buildQuestionnairePdfSnapshot({ payload });
    const currentHash = await hashQuestionnairePdfSnapshot(snapshot);
    const generatedFile = new File(['current-template'], 'SavedMSP.pdf', {
      type: 'application/pdf'
    });
    let latestCalls = 0;

    createQuestionnairePdfFileMock.mockResolvedValue({
      success: true,
      filename: generatedFile.name,
      file: generatedFile
    });
    base44.integrations.Core.UploadFile.mockResolvedValue({
      file_url: 'https://files.example/current.pdf'
    });
    globalThis.fetch.mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['current-template'], { type: 'application/pdf' })
    });
    base44.functions.invoke.mockImplementation(async (_name, body) => {
      if (body.action === 'latest') {
        latestCalls += 1;
        return {
          data: {
            success: true,
            version: latestCalls === 1
              ? {
                payload_hash: 'legacy-payload-only-hash',
                file_url: 'https://files.example/legacy.pdf',
                file_name: 'Legacy.pdf',
                version_number: 2
              }
              : {
                payload_hash: currentHash,
                file_url: 'https://files.example/current.pdf',
                file_name: generatedFile.name,
                version_number: 3
              }
          }
        };
      }

      return {
        data: {
          success: true,
          created: true,
          version: {
            payload_hash: body.payloadHash,
            file_url: body.fileUrl,
            file_name: body.fileName,
            version_number: 3
          }
        }
      };
    });

    render(<AdminQuestionnairePdfButton {...defaultProps} />);
    const button = screen.getByRole('button', { name: /download pdf/i });
    await userEvent.click(button);

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith('PDF version 3 saved and downloaded.');
    });
    await userEvent.click(button);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('https://files.example/current.pdf');
      expect(toastSuccessMock).toHaveBeenCalledWith(`PDF downloaded: ${generatedFile.name}`);
    });
    expect(createQuestionnairePdfFileMock).toHaveBeenCalledTimes(1);
    expect(base44.integrations.Core.UploadFile).toHaveBeenCalledTimes(1);
    expect(base44.functions.invoke).toHaveBeenCalledWith(
      'manageQuestionnairePdfVersions',
      expect.objectContaining({ action: 'save', payloadHash: currentHash })
    );
  });
});
