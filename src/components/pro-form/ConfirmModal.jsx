import React, { useState, useEffect, useRef } from 'react';
import { X, Download, Loader2 } from 'lucide-react';
import { QUESTIONS } from './questionData';
import { generatePDF } from './PDFGenerator';
import { formatAnswerForDisplay } from './answerFormatting';
import { toast } from 'sonner';

const cleanDomainForSubmission = (domainStr) => {
  let cleaned = domainStr.trim();
  cleaned = cleaned.replace(/^https?:\/\//i, '');
  cleaned = cleaned.replace(/^www\./i, '');
  cleaned = cleaned.replace(/\/+$/, '');
  return cleaned;
};

export default function ConfirmModal({ 
  formData, 
  onConfirm, 
  onCancel,
  isSubmitting = false,
  initialBusinessName = '', 
  initialDomain = '' 
}) {
  const getSafeRecoveryMessage = (recoveryCode = 'unknown-session') => (
    `We saved your progress, but final submission could not complete. Please try submitting again. If it still does not work, send this recovery code to support so we can recover your questionnaire: ${recoveryCode}`
  );
  const [businessName, setBusinessName] = useState(initialBusinessName);
  const [domain, setDomain] = useState(initialDomain);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const submitAttemptRef = useRef(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const businessNameRef = useRef(null);
  const domainRef = useRef(null);

  const handleDownloadPDF = async () => {
    if (!businessName.trim()) {
      toast.error('Please enter a business name before downloading.');
      return;
    }
    setIsGeneratingPDF(true);
    try {
      const result = await generatePDF(formData, businessName, cleanDomainForSubmission(domain));
      if (result.success) {
        toast.success(`PDF downloaded: ${result.filename}`);
      } else {
        toast.error('Failed to generate PDF. Please try again.');
      }
    } catch (error) {
      toast.error('An error occurred while generating the PDF.');
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const validate = () => {
    const errors = {};
    if (!businessName.trim()) errors.businessName = 'Business name is required.';
    if (!domain.trim()) errors.domain = 'Domain is required.';
    return errors;
  };

  const handleSubmit = async () => {
    if (isSubmitting || submitAttemptRef.current) {
      if (import.meta.env.DEV) {
        console.warn('[ConfirmModal] Submit blocked — already submitting.');
      }
      return;
    }

    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      if (errors.businessName) businessNameRef.current?.focus();
      else if (errors.domain) domainRef.current?.focus();
      return;
    }

    submitAttemptRef.current = true;
    setFieldErrors({});
    setSubmitError('');

    try {
      await onConfirm(businessName, cleanDomainForSubmission(domain));
    } catch (err) {
      const recoveryCode = err?.recoveryCode || 'unknown-session';
      setSubmitError(err?.userMessage || getSafeRecoveryMessage(recoveryCode));
    } finally {
      submitAttemptRef.current = false;
    }
  };

  const isFormValid = businessName.trim().length > 0 && domain.trim().length > 0;

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  // Escape key: block if submitting to prevent accidental dismiss mid-flight
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && !isSubmitting) onCancel();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onCancel, isSubmitting]);

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget && !isSubmitting) onCancel();
  };


  const groupedAnswers = QUESTIONS.reduce((acc, question) => {
    if (!acc[question.section]) {
      acc[question.section] = [];
    }
    
    const answer = formData[question.id];
    const otherValue = formData[`${question.id}_other`];
    
    acc[question.section].push({
      id: question.id,
      title: question.title,
      answer: formatAnswerForDisplay(question.id, answer, otherValue, formData),
      hasConditional: question.conditionalChildren && answer === 'yes'
    });

    // Add conditional children if parent is 'yes'
    if (question.conditionalChildren && answer === 'yes') {
      question.conditionalChildren.forEach(child => {
        const childAnswer = formData[child.id];
        const childOther = formData[`${child.id}_other`];
        acc[question.section].push({
          id: child.id,
          title: child.title,
          answer: formatAnswerForDisplay(child.id, childAnswer, childOther, formData),
          isChild: true
        });
      });
    }

    return acc;
  }, {});



  return (
    <div 
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-slate-900">Review Your Answers</h2>
          <button
            onClick={onCancel}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {/* Business Info Section */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 space-y-4">
            <h3 className="font-semibold text-blue-900 text-lg">Business Information</h3>
            
            <div>
              <label htmlFor="modal-business-name" className="block text-sm font-medium text-slate-700 mb-2">
                Business Name <span className="text-red-500">*</span>
              </label>
              <input
                id="modal-business-name"
                ref={businessNameRef}
                type="text"
                value={businessName}
                onChange={(e) => { setBusinessName(e.target.value); setFieldErrors(prev => ({ ...prev, businessName: '' })); }}
                placeholder="Enter your business name"
                autoComplete="organization"
                disabled={isSubmitting}
                aria-invalid={!!fieldErrors.businessName}
                aria-describedby={fieldErrors.businessName ? 'error-business-name' : undefined}
                className={`w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-60 ${fieldErrors.businessName ? 'border-red-400 bg-red-50' : 'border-slate-300'}`}
              />
              {fieldErrors.businessName && (
                <p id="error-business-name" className="mt-1 text-sm text-red-600" role="alert">{fieldErrors.businessName}</p>
              )}
            </div>

            <div>
              <label htmlFor="modal-domain" className="block text-sm font-medium text-slate-700 mb-2">
                Domain <span className="text-red-500">*</span>
              </label>
              <input
                id="modal-domain"
                ref={domainRef}
                type="text"
                value={domain}
                onChange={(e) => { setDomain(e.target.value); setFieldErrors(prev => ({ ...prev, domain: '' })); }}
                placeholder="example.com or https://example.com"
                autoComplete="url"
                disabled={isSubmitting}
                aria-invalid={!!fieldErrors.domain}
                aria-describedby={fieldErrors.domain ? 'error-domain' : undefined}
                className={`w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors disabled:opacity-60 ${fieldErrors.domain ? 'border-red-400 bg-red-50' : 'border-slate-300'}`}
              />
              {fieldErrors.domain && (
                <p id="error-domain" className="mt-1 text-sm text-red-600" role="alert">{fieldErrors.domain}</p>
              )}
            </div>
          </div>

          {/* Questionnaire Answers */}
          {Object.entries(groupedAnswers).map(([sectionName, questions]) => (
            <div key={sectionName} className="space-y-3">
              <h3 className="font-semibold text-slate-900 text-lg border-b border-slate-200 pb-2">
                {sectionName}
              </h3>
              {questions.map((q) => (
                <div 
                  key={q.id} 
                  className={`bg-slate-50 rounded-lg p-4 ${q.isChild ? 'ml-6 border-l-2 border-blue-300' : ''}`}
                >
                  <div className="text-sm font-medium text-slate-700 mb-1">
                    Question {q.id}: {q.title}
                  </div>
                  <div className="text-sm text-slate-600 whitespace-pre-line">
                    {q.answer}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 space-y-3">
          {submitError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2" role="alert" aria-live="assertive">
              {submitError}
            </p>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className="flex-1 px-6 py-3 border border-slate-300 text-slate-700 font-medium rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Go Back & Edit
            </button>
            <button
              type="button"
              onClick={handleDownloadPDF}
              disabled={isGeneratingPDF || isSubmitting}
              className="px-6 py-3 border border-blue-500 text-blue-600 font-medium rounded-lg hover:bg-blue-50 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGeneratingPDF ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
              ) : (
                <><Download className="w-4 h-4" /> Download PDF</>
              )}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className={`flex-1 px-6 py-3 font-medium rounded-lg transition-colors flex items-center justify-center gap-2 ${
                isSubmitting
                  ? 'bg-green-400 text-white cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700 text-white'
              }`}
            >
              {isSubmitting ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Submitting...</>
              ) : (
                'Confirm & Submit'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}