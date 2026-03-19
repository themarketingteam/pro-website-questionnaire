import React, { useState, useEffect } from 'react';
import { X, Check, AlertCircle } from 'lucide-react';
import { QUESTIONS } from './questionData';

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
  initialBusinessName = '', 
  initialDomain = '' 
}) {
  const [businessName, setBusinessName] = useState(initialBusinessName);
  const [domain, setDomain] = useState(initialDomain);

  const isFormValid = businessName.trim().length > 0 && domain.trim().length > 0;

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onCancel]);

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onCancel();
  };

  const formatAnswer = (questionId, answer, otherValue) => {
    if (!answer && !otherValue) return 'Not answered';
    
    let mainAnswer = '';
    if (Array.isArray(answer)) {
      mainAnswer = answer.length > 0 ? answer.join(', ') : '';
    } else if (typeof answer === 'string') {
      mainAnswer = answer;
    }

    if (otherValue) {
      if (Array.isArray(otherValue)) {
        const filtered = otherValue.filter(v => v?.trim());
        if (filtered.length > 0) {
          return mainAnswer ? `${mainAnswer}, Other: ${filtered.join(', ')}` : `Other: ${filtered.join(', ')}`;
        }
      } else if (otherValue.trim()) {
        return mainAnswer ? `${mainAnswer}, Other: ${otherValue}` : `Other: ${otherValue}`;
      }
    }

    return mainAnswer || 'Not answered';
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
      answer: formatAnswer(question.id, answer, otherValue),
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
          answer: formatAnswer(child.id, childAnswer, childOther),
          isChild: true
        });
      });
    }

    return acc;
  }, {});

  const getDomainBorderColor = () => {
    if (domain.trim().length === 0) return 'border-slate-300';
    return isDomainValid ? 'border-green-500' : 'border-red-500';
  };

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
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Business Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="Enter your business name"
                className="w-full p-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Domain <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={domain}
                  onChange={(e) => setDomain(cleanDomain(e.target.value))}
                  placeholder="example.com"
                  className={`w-full p-3 border ${getDomainBorderColor()} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors`}
                />
                {domain.trim().length > 0 && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {isDomainValid ? (
                      <Check className="w-5 h-5 text-green-500" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-red-500" />
                    )}
                  </div>
                )}
              </div>
              {domain.trim().length > 0 && (
                <p className={`text-sm mt-2 ${isDomainValid ? 'text-green-600' : 'text-red-600'}`}>
                  {isDomainValid ? (
                    <span className="flex items-center gap-1">
                      <Check className="w-4 h-4" />
                      Valid domain format
                    </span>
                  ) : (
                    "Please enter a valid domain without http://, https://, or www. (e.g., example.com or support.example.com)"
                  )}
                </p>
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
                  <div className="text-sm text-slate-600">
                    {q.answer}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-6 py-3 border border-slate-300 text-slate-700 font-medium rounded-lg hover:bg-slate-50 transition-colors"
          >
            Go Back & Edit
          </button>
          <button
            onClick={() => onConfirm(businessName, domain)}
            disabled={!isFormValid}
            className={`flex-1 px-6 py-3 font-medium rounded-lg transition-colors ${
              isFormValid
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : 'bg-slate-300 text-slate-500 cursor-not-allowed'
            }`}
          >
            Confirm & Submit
          </button>
        </div>
      </div>
    </div>
  );
}