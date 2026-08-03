import { useEffect } from 'react';
import { CheckCircle2, Download, Loader2 } from 'lucide-react';
import { useQuestionnairePdfDownload } from './pdf/useQuestionnairePdfDownload';

export default function ThankYouModal({ businessName, domain, formData }) {
  const { isGeneratingPDF, downloadPDF: handleDownloadPDF } =
    useQuestionnairePdfDownload({ formData, businessName, domain });

  // Set document title and prevent body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  return (
    <div className="fixed inset-0 bg-gradient-to-b from-gray-100 to-white z-50 flex items-center justify-center p-6">
      <div className="max-w-2xl w-full text-center space-y-8">
        {/* Success Icon */}
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
            <CheckCircle2 className="w-10 h-10 text-green-600" />
          </div>
        </div>

        {/* Heading */}
        <div className="space-y-2">
          <h1 className="text-4xl font-bold text-gray-900">Thank You!</h1>
          <p className="text-lg text-gray-600">
            We've received your questionnaire for <span className="font-semibold text-gray-900">{businessName}</span>
          </p>
        </div>

        {/* Download PDF Button */}
        <div>
          <button
            onClick={handleDownloadPDF}
            disabled={isGeneratingPDF}
            className="inline-flex items-center gap-3 px-8 py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-lg transition-colors shadow-lg hover:shadow-xl disabled:cursor-not-allowed"
          >
            {isGeneratingPDF ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Generating PDF...
              </>
            ) : (
              <>
                <Download className="w-5 h-5" />
                Download Your Responses (PDF)
              </>
            )}
          </button>
        </div>

        {/* What Happens Next Card */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-left">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">What happens next?</h2>
          
          <div className="space-y-6">
            {/* Step 1 */}
            <div className="flex gap-4">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-semibold">
                  1
                </div>
              </div>
              <div>
                <p className="text-gray-900">
                  <span className="font-semibold">Review:</span> Our team will review your responses within 1-2 business days
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex gap-4">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-semibold">
                  2
                </div>
              </div>
              <div>
                <p className="text-gray-900">
                  <span className="font-semibold">Contact:</span> We'll reach out to discuss next steps and timeline
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex gap-4">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-semibold">
                  3
                </div>
              </div>
              <div>
                <p className="text-gray-900">
                  <span className="font-semibold">Development:</span> We'll begin crafting your custom website content
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Text */}
        <p className="text-gray-600 text-sm">
          You can safely close this page. We'll be in touch soon!
        </p>
      </div>
    </div>
  );
}
