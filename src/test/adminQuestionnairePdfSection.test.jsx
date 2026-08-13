import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { base44 } from '@/api/base44Client';
import AdminQuestionnairePdfSection from '@/components/admin/AdminQuestionnairePdfSection';
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

const version = (number, hash, suffix = number) => ({
  id: `pdf-${suffix}`,
  payload_hash: hash,
  file_url: `https://files.example/version-${suffix}.pdf`,
  file_name: `SavedMSP-v${suffix}.pdf`,
  version_number: number,
  generated_at: `2026-08-${String(10 + number).padStart(2, '0')}T12:00:00.000Z`
});

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

describe('AdminQuestionnairePdfSection', () => {
  it('defaults to the newest saved version and downloads the version selected in the field', async () => {
    const payloadHash = await hashQuestionnairePdfSnapshot(
      buildQuestionnairePdfSnapshot({ payload })
    );
    const newest = version(3, payloadHash, 3);
    const older = version(2, 'older-payload-hash', 2);
    base44.functions.invoke.mockResolvedValue({
      data: { success: true, versions: [newest, older] }
    });
    globalThis.fetch.mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['saved-pdf'], { type: 'application/pdf' })
    });

    render(<AdminQuestionnairePdfSection {...defaultProps} />);

    await screen.findByText(/Version 3/);
    await userEvent.click(screen.getByRole('button', { name: /saved pdfs \(2\)/i }));
    const select = screen.getByRole('combobox', { name: /pdf version to download/i });
    expect(select).toHaveValue(newest.id);

    await userEvent.selectOptions(select, older.id);
    await userEvent.click(screen.getByRole('button', { name: /^download pdf$/i }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(older.file_url);
      expect(toastSuccessMock).toHaveBeenCalledWith('PDF version 2 downloaded.');
    });
    expect(createQuestionnairePdfFileMock).not.toHaveBeenCalled();
    expect(base44.integrations.Core.UploadFile).not.toHaveBeenCalled();
  });

  it('creates, saves, and selects version 1 when no saved PDF exists', async () => {
    const generatedFile = new File(['generated-pdf'], 'SavedMSP.pdf', { type: 'application/pdf' });
    const saved = version(1, 'placeholder', 1);
    createQuestionnairePdfFileMock.mockResolvedValue({
      success: true,
      filename: generatedFile.name,
      file: generatedFile
    });
    base44.integrations.Core.UploadFile.mockResolvedValue({
      file_url: saved.file_url
    });
    base44.functions.invoke.mockImplementation(async (_name, body) => {
      if (body.action === 'list') return { data: { success: true, versions: [] } };
      return {
        data: {
          success: true,
          created: true,
          version: {
            ...saved,
            payload_hash: body.payloadHash,
            file_name: body.fileName,
            file_url: body.fileUrl
          }
        }
      };
    });

    render(<AdminQuestionnairePdfSection {...defaultProps} />);
    await screen.findByRole('button', { name: /saved pdfs \(0\)/i });
    await userEvent.click(screen.getByRole('button', { name: /^download pdf$/i }));

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
    expect(await screen.findByRole('button', { name: /saved pdfs \(1\)/i })).toBeEnabled();
    expect(base44.functions.invoke).toHaveBeenCalledWith(
      'manageQuestionnairePdfVersions',
      expect.objectContaining({
        action: 'save',
        sourceType: 'draft',
        sourceId: 'draft-1',
        sessionId: 'session-1',
        fileUrl: saved.file_url,
        recoveryGrant: 'signed-recovery-grant'
      })
    );
  });

  it('offers current values as a new version while retaining older selectable PDFs', async () => {
    const oldVersion = version(4, 'previous-payload-hash', 4);
    const generatedFile = new File(['current-pdf'], 'SavedMSP.pdf', { type: 'application/pdf' });
    createQuestionnairePdfFileMock.mockResolvedValue({
      success: true,
      filename: generatedFile.name,
      file: generatedFile
    });
    base44.integrations.Core.UploadFile.mockResolvedValue({
      file_url: 'https://files.example/version-5.pdf'
    });
    base44.functions.invoke.mockImplementation(async (_name, body) => {
      if (body.action === 'list') {
        return { data: { success: true, versions: [oldVersion] } };
      }
      return {
        data: {
          success: true,
          created: true,
          version: version(5, body.payloadHash, 5)
        }
      };
    });
    globalThis.fetch.mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['old-pdf'], { type: 'application/pdf' })
    });

    render(<AdminQuestionnairePdfSection {...defaultProps} />);
    await screen.findByText(/new saved version will be created/i);
    await userEvent.click(screen.getByRole('button', { name: /saved pdfs \(1\)/i }));
    const select = screen.getByRole('combobox', { name: /pdf version to download/i });
    expect(select).toHaveValue('__current_questionnaire_values__');
    expect(screen.getByRole('option', { name: /current questionnaire values/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^download pdf$/i }));
    await screen.findByRole('button', { name: /saved pdfs \(2\)/i });
    expect(select).toHaveValue('pdf-5');

    await userEvent.selectOptions(select, oldVersion.id);
    await userEvent.click(screen.getByRole('button', { name: /^download pdf$/i }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(oldVersion.file_url));
    expect(createQuestionnairePdfFileMock).toHaveBeenCalledTimes(1);
  });
});

describe('questionnaire PDF version backend contract', () => {
  it('returns the full retained history for the admin version selector', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'base44/functions/manageQuestionnairePdfVersions/entry.ts'),
      'utf8'
    );

    expect(source).toContain("if (action === 'list')");
    expect(source).toContain("action === 'list' ? 100 : 1");
    expect(source).toContain('versions: Array.isArray(versions) ? versions.map(publicVersion) : []');
  });
});
