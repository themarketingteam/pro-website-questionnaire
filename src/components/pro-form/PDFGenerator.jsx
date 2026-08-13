import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import questionnaireLogoUrl from '@/assets/mspSuccessDigitalLogo';
import { trackClarityEvent } from '@/lib/clarity';
import { buildQuestionnairePdfModel } from './pdf/questionnairePdfModel';
import {
  createQuestionnairePdfContainer
} from './pdf/questionnairePdfTemplate';
import {
  getSafeQuestionnaireCanvasScale,
  QUESTIONNAIRE_PDF_THEME
} from './pdf/questionnairePdfTheme';

const waitForImage = async (image) => {
  if (image.complete && image.naturalWidth > 0) {
    if (typeof image.decode === 'function') {
      await image.decode().catch(() => undefined);
    }
    return;
  }

  await new Promise((resolve, reject) => {
    image.addEventListener('load', resolve, { once: true });
    image.addEventListener('error', () => reject(new Error('PDF logo failed to load.')), {
      once: true
    });
  });
};

export const waitForQuestionnairePdfAssets = async (container) => {
  const ownerDocument = container.ownerDocument;
  const fontSet = ownerDocument.fonts;

  if (fontSet) {
    await Promise.all([
      fontSet.load('400 8pt Inter'),
      fontSet.load('600 8pt Inter'),
      fontSet.load('700 8pt Inter'),
      fontSet.ready
    ]);
  }

  const images = [...container.querySelectorAll('img')];
  await Promise.all(images.map(waitForImage));
};

const buildFilename = (businessName, now) => {
  const condensedName = String(businessName ?? '')
    .replace(/[.,\s]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '') || 'Questionnaire';
  const dateString = `${now.getMonth() + 1}-${now.getDate()}-${String(now.getFullYear()).slice(-2)}`;

  return `${condensedName}_KaseyaWebsite_ContentQuestionnaire_Responses_${dateString}.pdf`;
};

const renderQuestionnairePdf = async (
  formData,
  businessName,
  domain,
  { submissionDate } = {}
) => {
  const now = new Date();
  const filename = buildFilename(businessName, now);
  const model = buildQuestionnairePdfModel({
    formData,
    businessName,
    domain,
    submissionDate: submissionDate || now
  });
  const container = createQuestionnairePdfContainer({
    model,
    logoUrl: questionnaireLogoUrl
  });
  document.body.appendChild(container);

  try {
    await waitForQuestionnairePdfAssets(container);

    const documentElement = container.querySelector('[data-questionnaire-pdf-document]');
    const widthPx = documentElement.scrollWidth;
    const heightPx = documentElement.scrollHeight;
    const scale = getSafeQuestionnaireCanvasScale({ widthPx, heightPx });

    if (scale < QUESTIONNAIRE_PDF_THEME.canvas.minimumReadableScale) {
      throw new Error('Questionnaire content is too long to render clearly in one safe canvas.');
    }

    const canvas = await html2canvas(documentElement, {
      scale,
      useCORS: false,
      allowTaint: false,
      logging: false,
      backgroundColor: QUESTIONNAIRE_PDF_THEME.page.background,
      imageTimeout: 10_000,
      removeContainer: true,
      windowWidth: widthPx,
      windowHeight: heightPx
    });

    if (!canvas.width || !canvas.height) {
      throw new Error('PDF rendering produced a blank canvas.');
    }

    const pageWidthPt = QUESTIONNAIRE_PDF_THEME.page.widthPt;
    const pageHeightPt = (canvas.height * pageWidthPt) / canvas.width;
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: [pageWidthPt, pageHeightPt],
      compress: true,
      precision: 16
    });

    pdf.addImage(
      canvas.toDataURL('image/png'),
      'PNG',
      0,
      0,
      pageWidthPt,
      pageHeightPt,
      undefined,
      'FAST'
    );
    return { pdf, filename };
  } finally {
    container.remove();
  }
};

export const createQuestionnairePdfFile = async (
  formData,
  businessName,
  domain,
  options = {}
) => {
  try {
    const { pdf, filename } = await renderQuestionnairePdf(
      formData,
      businessName,
      domain,
      options
    );
    const blob = pdf.output('blob');

    if (!(blob instanceof Blob) || blob.size === 0) {
      throw new Error('PDF generation produced an empty file.');
    }

    return {
      success: true,
      filename,
      file: new File([blob], filename, { type: 'application/pdf' })
    };
  } catch (error) {
    console.error('[Questionnaire PDF] generation failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'PDF generation failed.' };
  }
};

export const generatePDF = async (formData, businessName, domain) => {
  try {
    const { pdf, filename } = await renderQuestionnairePdf(formData, businessName, domain);
    pdf.save(filename);

    trackClarityEvent('pro_questionnaire_pdf_downloaded', {
      business_domain: domain || 'unknown'
    });

    return { success: true, filename };
  } catch (error) {
    console.error('[Questionnaire PDF] generation failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'PDF generation failed.' };
  }
};

export default function PDFGenerator() {
  return null;
}
