import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Download, FileStack, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { createQuestionnairePdfFile } from '@/components/pro-form/PDFGenerator';
import {
  buildQuestionnairePdfSnapshot,
  hashQuestionnairePdfSnapshot,
  stableQuestionnairePdfSnapshot
} from '@/lib/questionnairePdfVersions';

const CURRENT_VALUES_OPTION = '__current_questionnaire_values__';

const responseData = (response) => response?.data ?? response;

const sortVersions = (versions) => [...versions].sort(
  (left, right) => Number(right?.version_number || 0) - Number(left?.version_number || 0)
);

const clickDownloadLink = ({ url, filename, openInNewTab = false }) => {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'questionnaire-responses.pdf';
  link.rel = 'noopener noreferrer';
  if (openInNewTab) link.target = '_blank';
  document.body.appendChild(link);
  link.click();
  link.remove();
};

export const downloadQuestionnairePdfFile = (file) => {
  const objectUrl = URL.createObjectURL(file);
  clickDownloadLink({ url: objectUrl, filename: file.name });
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
};

export const downloadStoredQuestionnairePdf = async ({ fileUrl, filename }) => {
  try {
    const response = await fetch(fileUrl);
    if (!response.ok) throw new Error(`Saved PDF request failed with HTTP ${response.status}.`);
    const blob = await response.blob();
    const file = new File([blob], filename || 'questionnaire-responses.pdf', {
      type: blob.type || 'application/pdf'
    });
    downloadQuestionnairePdfFile(file);
    return;
  } catch {
    // Cross-origin storage can reject fetch while still allowing a direct browser download.
    clickDownloadLink({ url: fileUrl, filename, openInNewTab: true });
  }
};

const getErrorMessage = (error) => (
  error?.response?.data?.error
  || error?.response?.data?.message
  || error?.message
  || 'Unable to download this questionnaire PDF.'
);

const formatVersionDate = (value) => {
  if (!value) return 'date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'date unavailable' : date.toLocaleString();
};

export default function AdminQuestionnairePdfSection({
  sourceType,
  sourceId,
  sessionId,
  payload,
  fallbackResponses,
  businessName,
  domain,
  submissionDate,
  recoveryGrant,
  disabled = false
}) {
  const [versions, setVersions] = useState([]);
  const [selectedVersionId, setSelectedVersionId] = useState(CURRENT_VALUES_OPTION);
  const [currentPayloadHash, setCurrentPayloadHash] = useState('');
  const [isLoadingVersions, setIsLoadingVersions] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [loadError, setLoadError] = useState('');
  const inProgressRef = useRef(false);

  const snapshot = buildQuestionnairePdfSnapshot({
    payload,
    fallbackResponses,
    businessName,
    domain,
    submissionDate
  });
  const snapshotKey = stableQuestionnairePdfSnapshot(snapshot);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  useEffect(() => {
    let cancelled = false;

    const loadVersions = async () => {
      setIsLoadingVersions(true);
      setLoadError('');

      try {
        const [listResponse, payloadHash] = await Promise.all([
          base44.functions.invoke('manageQuestionnairePdfVersions', {
            action: 'list',
            sourceType,
            sourceId,
            recoveryGrant
          }),
          hashQuestionnairePdfSnapshot(snapshotRef.current)
        ]);
        if (cancelled) return;

        const listData = responseData(listResponse);
        if (!listData?.success) {
          throw new Error(listData?.error || 'Saved PDF versions could not be loaded.');
        }

        const nextVersions = sortVersions(Array.isArray(listData.versions) ? listData.versions : []);
        const latest = nextVersions[0];
        setVersions(nextVersions);
        setCurrentPayloadHash(payloadHash);
        setSelectedVersionId(
          latest?.payload_hash === payloadHash && latest?.file_url
            ? latest.id
            : CURRENT_VALUES_OPTION
        );
      } catch (error) {
        if (cancelled) return;
        console.error('[Admin questionnaire PDF] version list failed:', error);
        setVersions([]);
        setSelectedVersionId(CURRENT_VALUES_OPTION);
        setLoadError(getErrorMessage(error));
      } finally {
        if (!cancelled) setIsLoadingVersions(false);
      }
    };

    if (sourceId) loadVersions();
    else setIsLoadingVersions(false);

    return () => { cancelled = true; };
  }, [recoveryGrant, snapshotKey, sourceId, sourceType]);

  const selectedVersion = useMemo(
    () => versions.find((version) => version.id === selectedVersionId) || null,
    [selectedVersionId, versions]
  );
  const latestVersion = versions[0];
  const currentValuesNeedPdf = !latestVersion?.file_url
    || latestVersion.payload_hash !== currentPayloadHash;

  const handleDownload = async (event) => {
    event?.stopPropagation?.();
    if (inProgressRef.current || !sourceId) return;

    inProgressRef.current = true;
    setIsGenerating(true);

    try {
      if (selectedVersionId !== CURRENT_VALUES_OPTION && selectedVersion?.file_url) {
        await downloadStoredQuestionnairePdf({
          fileUrl: selectedVersion.file_url,
          filename: selectedVersion.file_name
        });
        toast.success(`PDF version ${selectedVersion.version_number} downloaded.`);
        return;
      }

      const currentSnapshot = snapshotRef.current;
      const payloadHash = currentPayloadHash || await hashQuestionnairePdfSnapshot(currentSnapshot);
      const generated = await createQuestionnairePdfFile(
        currentSnapshot.formData,
        currentSnapshot.businessName,
        currentSnapshot.domain,
        { submissionDate: currentSnapshot.submissionDate }
      );

      if (!generated?.success || !generated.file) {
        throw new Error(generated?.error || 'PDF generation failed.');
      }

      const upload = await base44.integrations.Core.UploadFile({ file: generated.file });
      if (!upload?.file_url) throw new Error('The generated PDF could not be saved.');

      const saveResponse = await base44.functions.invoke('manageQuestionnairePdfVersions', {
        action: 'save',
        sourceType,
        sourceId,
        sessionId: sessionId || '',
        payloadHash,
        fileUrl: upload.file_url,
        fileName: generated.filename,
        businessName: currentSnapshot.businessName,
        domain: currentSnapshot.domain,
        recoveryGrant
      });
      const saveData = responseData(saveResponse);
      if (!saveData?.success || !saveData?.version) {
        throw new Error(saveData?.error || 'The generated PDF version could not be saved.');
      }

      const savedVersion = saveData.version;
      setVersions((previous) => sortVersions([
        savedVersion,
        ...previous.filter((version) => version.id !== savedVersion.id)
      ]));
      setSelectedVersionId(savedVersion.id);
      setCurrentPayloadHash(payloadHash);
      downloadQuestionnairePdfFile(generated.file);
      toast.success(`PDF version ${savedVersion.version_number} saved and downloaded.`);
    } catch (error) {
      console.error('[Admin questionnaire PDF] download failed:', error);
      toast.error(getErrorMessage(error));
    } finally {
      inProgressRef.current = false;
      setIsGenerating(false);
    }
  };

  const selectedSummary = selectedVersion
    ? `Version ${selectedVersion.version_number} · ${formatVersionDate(selectedVersion.generated_at || selectedVersion.created_date)}`
    : currentValuesNeedPdf
      ? 'Current questionnaire values · a new saved version will be created'
      : 'Select a saved PDF version';

  return (
    <section
      aria-label="Questionnaire PDFs"
      className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 space-y-3"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">PDF Downloads</p>
          <p className="mt-1 text-xs text-slate-600" aria-live="polite">
            {isLoadingVersions ? 'Checking saved PDFs…' : selectedSummary}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
            onClick={handleDownload}
            disabled={disabled || isGenerating || isLoadingVersions || !sourceId}
          >
            {isGenerating
              ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              : <Download className="h-3 w-3" aria-hidden="true" />}
            {isGenerating ? 'Preparing PDF...' : 'Download PDF'}
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-2 border-slate-300 text-slate-700 hover:bg-white"
            onClick={(event) => {
              event.stopPropagation();
              setIsHistoryOpen((open) => !open);
            }}
            aria-expanded={isHistoryOpen}
          >
            <FileStack className="h-3 w-3" aria-hidden="true" />
            Saved PDFs ({versions.length})
            {isHistoryOpen
              ? <ChevronUp className="h-3 w-3" aria-hidden="true" />
              : <ChevronDown className="h-3 w-3" aria-hidden="true" />}
          </Button>
        </div>
      </div>

      {isHistoryOpen && (
        <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
          <label htmlFor={`pdf-version-${sourceType}-${sourceId}`} className="block text-xs font-medium text-slate-700">
            PDF version to download
          </label>
          <select
            id={`pdf-version-${sourceType}-${sourceId}`}
            className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
            value={selectedVersionId}
            onChange={(event) => setSelectedVersionId(event.target.value)}
            disabled={isLoadingVersions || isGenerating}
          >
            {currentValuesNeedPdf && (
              <option value={CURRENT_VALUES_OPTION}>Current questionnaire values (create new PDF)</option>
            )}
            {versions.map((version, index) => (
              <option key={version.id} value={version.id}>
                Version {version.version_number}{index === 0 ? ' (newest saved)' : ''} — {formatVersionDate(version.generated_at || version.created_date)}
              </option>
            ))}
          </select>
          {loadError ? (
            <p className="text-xs text-red-700">Saved PDFs could not be listed: {loadError}</p>
          ) : versions.length === 0 ? (
            <p className="text-xs text-slate-500">No PDF has been saved yet. Download PDF will create version 1 from the current values.</p>
          ) : (
            <p className="text-xs text-slate-500">Older PDFs remain available. Download PDF uses the version selected above.</p>
          )}
        </div>
      )}
    </section>
  );
}
