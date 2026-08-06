import { buildQuestionnairePdfModel } from '@/components/pro-form/pdf/questionnairePdfModel';
import { generatePDF } from '@/components/pro-form/PDFGenerator';
import {
  hashCanonicalDraftState,
  normalizeCanonicalDraftState,
  sanitizeDraftSerializableValue,
} from '@/lib/questionnaireDraftState';

export const PRO_DRAFT_SUBMITTED_PDF_VERSION = 1;

export const SUBMITTED_PDF_ERROR_CODES = Object.freeze({
  HASH_MISMATCH: 'SUBMITTED_PDF_HASH_MISMATCH',
  INVALID_STATE: 'SUBMITTED_PDF_INVALID_STATE',
  NOT_SUBMITTED: 'SUBMITTED_PDF_NOT_SUBMITTED',
  RECEIPT_MISMATCH: 'SUBMITTED_PDF_RECEIPT_MISMATCH',
});

const fail = (code) => {
  throw Object.assign(new Error(`Submitted PDF source rejected (${code}).`), { code });
};

export const prepareSubmittedPdfSource = async ({ canonicalState, receipt } = {}) => {
  let canonical;
  try {
    canonical = normalizeCanonicalDraftState(canonicalState);
  } catch {
    return fail(SUBMITTED_PDF_ERROR_CODES.INVALID_STATE);
  }
  if (canonical.draftStatus !== 'submitted') return fail(SUBMITTED_PDF_ERROR_CODES.NOT_SUBMITTED);
  const submission = canonical.submission || {};
  if (!submission.finalSubmissionId || !submission.submittedAt
    || receipt?.draftId !== canonical.draftId
    || receipt?.finalSubmissionId !== submission.finalSubmissionId
    || receipt?.submittedAt !== submission.submittedAt) {
    return fail(SUBMITTED_PDF_ERROR_CODES.RECEIPT_MISMATCH);
  }
  const actualHash = await hashCanonicalDraftState(canonical);
  const expectedHash = receipt?.pdfSourceStateHash || submission.pdfSourceStateHash;
  if (!expectedHash || actualHash !== expectedHash
    || (submission.submittedStateHash && submission.submittedStateHash !== actualHash)) {
    return fail(SUBMITTED_PDF_ERROR_CODES.HASH_MISMATCH);
  }
  const formData = sanitizeDraftSerializableValue(canonical.responses);
  const source = {
    version: PRO_DRAFT_SUBMITTED_PDF_VERSION,
    draftId: canonical.draftId,
    finalSubmissionId: submission.finalSubmissionId,
    sourceStateHash: actualHash,
    formData,
    businessName: canonical.credentials?.businessName || '',
    domain: canonical.credentials?.domain || '',
    submissionDate: submission.submittedAt,
  };
  return Object.freeze({
    ...source,
    model: Object.freeze(buildQuestionnairePdfModel(source)),
  });
};

export const generateSubmittedQuestionnairePdf = async ({
  canonicalState,
  receipt,
  generate = generatePDF,
} = {}) => {
  const source = await prepareSubmittedPdfSource({ canonicalState, receipt });
  const result = await generate(
    source.formData,
    source.businessName,
    source.domain,
    source.submissionDate,
  );
  return Object.freeze({ ...result, sourceStateHash: source.sourceStateHash });
};

export const getSafeSubmittedPdfDiagnostics = (value = {}) => Object.freeze({
  version: PRO_DRAFT_SUBMITTED_PDF_VERSION,
  valid: value.valid === true,
  errorCode: typeof value.errorCode === 'string' ? value.errorCode : null,
  sourceStateHashPresent: /^[a-f0-9]{64}$/u.test(value.sourceStateHash || ''),
  exposesAnswers: false,
  exposesCredentials: false,
});

export default generateSubmittedQuestionnairePdf;
