import { useEffect, useMemo, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { QUESTIONS } from './questionData';
import { formatAnswerForDisplay } from './answerFormatting';
import { selectCanonicalDraftState, selectSubmittedReceipt } from '@/components/store/draftSelectors';
import {
  generateSubmittedQuestionnairePdf,
  prepareSubmittedPdfSource,
} from '@/lib/proDraftSubmittedPdfService';
import ProDraftReplacementActions from './ProDraftReplacementActions';

const isYes = (value) => String(value || '').trim().toLowerCase() === 'yes';

export default function ProQuestionnaireReadOnlyView() {
  const selected = useSelector(selectCanonicalDraftState);
  const receipt = useSelector(selectSubmittedReceipt);
  const [pdfSource, setPdfSource] = useState(null);
  const [pdfError, setPdfError] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const canonical = selected?.ok ? selected.state : null;

  useEffect(() => {
    let active = true;
    setPdfError(null);
    prepareSubmittedPdfSource({ canonicalState: canonical, receipt })
      .then((source) => { if (active) setPdfSource(source); })
      .catch((error) => {
        if (active) {
          setPdfSource(null);
          setPdfError(error?.code || 'SUBMITTED_PDF_INVALID_STATE');
        }
      });
    return () => { active = false; };
  }, [canonical, receipt]);

  const sections = useMemo(() => {
    if (!canonical) return [];
    return [...new Set(QUESTIONS.map((question) => question.section))].map((title) => ({
      title,
      questions: QUESTIONS.filter((question) => question.section === title),
    }));
  }, [canonical]);

  const download = async () => {
    if (!canonical || !receipt || downloading) return;
    setDownloading(true);
    setPdfError(null);
    try {
      await generateSubmittedQuestionnairePdf({ canonicalState: canonical, receipt });
    } catch (error) {
      setPdfError(error?.code || 'SUBMITTED_PDF_GENERATION_FAILED');
    } finally {
      setDownloading(false);
    }
  };

  if (!canonical || !receipt) {
    return <p role="alert" className="mx-auto max-w-4xl p-6">Submitted questionnaire data is unavailable.</p>;
  }

  const renderAnswer = (question, parentId = null) => {
    if (parentId && !isYes(canonical.responses[parentId])) return null;
    return (
      <article
        key={question.id}
        data-question-id={question.id}
        className={`rounded-lg border border-slate-200 bg-white p-4 ${parentId ? 'ml-4 border-l-4 border-l-[#6464FF]' : ''}`}
      >
        <h3 className="font-semibold text-slate-900">Question {question.id}: {question.title}</h3>
        <p className="mt-2 whitespace-pre-wrap text-slate-700">
          {question.type === 'info_message'
            ? 'Information only'
            : formatAnswerForDisplay(
              question.id,
              canonical.responses[question.id],
              canonical.responses[`${question.id}_other`],
              canonical.responses,
            )}
        </p>
      </article>
    );
  };

  return (
    <main aria-readonly="true" data-testid="pro-questionnaire-read-only" className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <header className="rounded-xl border border-green-200 bg-green-50 p-5">
          <p className="text-sm font-bold uppercase tracking-wide text-green-800">Submitted — read only</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">{pdfSource?.businessName || 'Website Content Questionnaire'}</h1>
          <p className="mt-2 text-slate-700">
            Submitted {new Date(receipt.submittedAt).toLocaleString()}. Answers are locked and cannot be changed.
          </p>
          {receipt.submissionLockPending && (
            <p role="status" className="mt-2 text-amber-900">Submission received. The final draft lock is retrying safely.</p>
          )}
        </header>

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={download}
            disabled={!pdfSource || downloading}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded bg-blue-700 px-6 font-semibold text-white disabled:bg-slate-400"
          >
            {downloading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
            Download submitted responses (PDF)
          </button>
          <ProDraftReplacementActions mode="start_new" />
          <Link className="inline-flex min-h-12 items-center justify-center px-4 font-semibold text-blue-700 underline" to="/recover-draft">
            Recover a different questionnaire
          </Link>
        </div>
        {pdfError && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-red-900">PDF verification failed ({pdfError}).</p>}

        {sections.map((section) => (
          <section key={section.title} aria-labelledby={`readonly-${section.title.replaceAll(' ', '-')}`} className="space-y-3">
            <h2 id={`readonly-${section.title.replaceAll(' ', '-')}`} className="rounded bg-[#6464FF] px-4 py-3 text-lg font-bold text-white">
              {section.title}
            </h2>
            {section.questions.flatMap((question) => [
              renderAnswer(question),
              ...(question.conditionalChildren || []).map((child) => renderAnswer(child, question.id)),
            ])}
          </section>
        ))}
      </div>
    </main>
  );
}
