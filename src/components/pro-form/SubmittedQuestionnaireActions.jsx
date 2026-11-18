import { toast } from 'sonner';
import { buildDraftShareUrl, copyTextToClipboard } from '@/lib/draftShareLink';
import { useQuestionnairePdfDownload } from './pdf/useQuestionnairePdfDownload';
export default function SubmittedQuestionnaireActions({ formData, businessName, domain, resumeCredential }) {
  const { isGeneratingPDF, downloadPDF } = useQuestionnairePdfDownload({ formData, businessName, domain, validateBeforeDownload: undefined });
  return <div className="mt-4 flex flex-wrap gap-3">
    <button type="button" onClick={async () => { try { await copyTextToClipboard(buildDraftShareUrl(resumeCredential)); toast.success('Questionnaire link copied.'); } catch (error) { toast.error(error.message); } }} className="min-h-11 rounded-md border border-[#176BB7] bg-white px-4 py-2 font-semibold">Copy questionnaire link</button>
    <button type="button" disabled={isGeneratingPDF} onClick={downloadPDF} className="min-h-11 rounded-md border border-[#176BB7] bg-white px-4 py-2 font-semibold disabled:opacity-50">{isGeneratingPDF ? 'Generating PDF…' : 'Download responses (PDF)'}</button>
  </div>;
}
