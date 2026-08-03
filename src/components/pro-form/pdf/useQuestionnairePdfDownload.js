import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { generatePDF } from '../PDFGenerator';

const PDF_FAILURE_MESSAGE = 'Failed to generate PDF. Please try again.';
const PDF_EXCEPTION_MESSAGE = 'An error occurred while generating the PDF.';

export const useQuestionnairePdfDownload = ({
  formData,
  businessName,
  domain,
  validateBeforeDownload,
}) => {
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const isDownloadInProgressRef = useRef(false);

  const downloadPDF = useCallback(async () => {
    if (isDownloadInProgressRef.current) {
      return { success: false, blocked: true };
    }

    isDownloadInProgressRef.current = true;

    try {
      if (validateBeforeDownload) {
        const validation = await validateBeforeDownload();

        if (!validation?.ok) {
          toast.error(validation?.message || PDF_FAILURE_MESSAGE);
          return { success: false, validationFailed: true };
        }
      }

      setIsGeneratingPDF(true);
      const result = await generatePDF(formData, businessName, domain);

      if (result?.success) {
        toast.success(`PDF downloaded: ${result.filename}`);
      } else {
        toast.error(PDF_FAILURE_MESSAGE);
      }

      return result;
    } catch (error) {
      console.error('[Questionnaire PDF] generation failed:', error);
      toast.error(PDF_EXCEPTION_MESSAGE);
      return { success: false, error };
    } finally {
      isDownloadInProgressRef.current = false;
      setIsGeneratingPDF(false);
    }
  }, [businessName, domain, formData, validateBeforeDownload]);

  return { isGeneratingPDF, downloadPDF };
};

export default useQuestionnairePdfDownload;
