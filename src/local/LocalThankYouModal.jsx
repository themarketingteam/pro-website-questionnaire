import { CheckCircle2, Download, Loader2 } from 'lucide-react';
import { useQuestionnairePdfDownload } from '@/components/pro-form/pdf/useQuestionnairePdfDownload';
export default function LocalThankYouModal({ businessName, domain, formData }) {
  const { isGeneratingPDF, downloadPDF } = useQuestionnairePdfDownload({ formData, businessName, domain });
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-50 p-6"><div className="w-full max-w-xl rounded-2xl border bg-white p-8 text-center shadow-lg">
    <CheckCircle2 className="mx-auto h-14 w-14 text-green-600" />
    <h1 className="mt-5 text-3xl font-bold text-[#122947]">Test submission saved locally</h1>
    <p className="mt-3 text-slate-600">The questionnaire for <strong>{businessName}</strong> and its outgoing webhook payload were saved on this computer. Nothing was sent to Base44 or Zapier.</p>
    <p className="mt-3 text-sm text-slate-500">Return to the form, then open Submission captures to inspect or download the saved JSON.</p>
    <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
      <button type="button" className="rounded-lg bg-[#1C82DE] px-5 py-3 font-semibold text-white" onClick={() => window.location.reload()}>Return to local test form</button>
      <button type="button" className="inline-flex items-center justify-center gap-2 rounded-lg border px-5 py-3 font-semibold text-[#122947] disabled:opacity-50" onClick={downloadPDF} disabled={isGeneratingPDF}>{isGeneratingPDF ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}Download PDF</button>
    </div>
  </div></div>;
}
