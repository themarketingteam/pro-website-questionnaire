import { useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { createQuestionnairePdfFile } from '@/components/pro-form/PDFGenerator';
import {
  buildQuestionnairePdfSnapshot,
  hashQuestionnairePdfSnapshot
} from '@/lib/questionnairePdfVersions';

const responseData = (response) => response?.data ?? response;

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

export default function AdminQuestionnairePdfButton({
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
  const [isGenerating, setIsGenerating] = useState(false);
  const inProgressRef = useRef(false);

  const handleDownload = async (event) => {
    event?.stopPropagation?.();
    if (inProgressRef.current || !sourceId) return;

    inProgressRef.current = true;
    setIsGenerating(true);

    try {
      const snapshot = buildQuestionnairePdfSnapshot({
        payload,
        fallbackResponses,
        businessName,
        domain,
        submissionDate
      });
      const payloadHash = await hashQuestionnairePdfSnapshot(snapshot);
      const latestResponse = await base44.functions.invoke('manageQuestionnairePdfVersions', {
        action: 'latest',
        sourceType,
        sourceId,
        recoveryGrant
      });
      const latestData = responseData(latestResponse);
      if (!latestData?.success) {
        throw new Error(latestData?.error || 'Saved PDF versions could not be checked.');
      }
      const latestVersion = latestData?.version;

      if (latestVersion?.payload_hash === payloadHash && latestVersion?.file_url) {
        await downloadStoredQuestionnairePdf({
          fileUrl: latestVersion.file_url,
          filename: latestVersion.file_name
        });
        toast.success(`PDF downloaded: ${latestVersion.file_name}`);
        return;
      }

      const generated = await createQuestionnairePdfFile(
        snapshot.formData,
        snapshot.businessName,
        snapshot.domain,
        { submissionDate: snapshot.submissionDate }
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
        businessName: snapshot.businessName,
        domain: snapshot.domain,
        recoveryGrant
      });
      const saveData = responseData(saveResponse);
      if (!saveData?.success || !saveData?.version) {
        throw new Error(saveData?.error || 'The generated PDF version could not be saved.');
      }

      downloadQuestionnairePdfFile(generated.file);
      toast.success(`PDF version ${saveData.version.version_number} saved and downloaded.`);
    } catch (error) {
      console.error('[Admin questionnaire PDF] download failed:', error);
      toast.error(getErrorMessage(error));
    } finally {
      inProgressRef.current = false;
      setIsGenerating(false);
    }
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
      onClick={handleDownload}
      disabled={disabled || isGenerating || !sourceId}
      title="Downloads the latest saved PDF, or creates a new saved version when the payload changed."
    >
      {isGenerating
        ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        : <Download className="h-3 w-3" aria-hidden="true" />}
      {isGenerating ? 'Preparing PDF...' : 'Download PDF'}
    </Button>
  );
}
