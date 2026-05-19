import React, { useState } from 'react';
import { ChevronDown, ChevronUp, HelpCircle, RotateCcw, CheckCircle2, AlertCircle, AlertTriangle } from 'lucide-react';
import QuestionHelpModal from './QuestionHelpModal';

export default function QuestionWrapper({ 
  id,
  number, 
  title, 
  guidance, 
  why,
  examples,
  children, 
  isCollapsible = true,
  isExpanded = true,
  onToggle,
  required = false,
  onReset,
  hasAnswer = false,
  isComplete = false,
  wasTouched = false,
  isSubQuestion = false,
  validationStatus = 'neutral', // 'complete', 'needs_work', 'incomplete', 'neutral'
  showStatusIcon = false
}) {
  const [showModal, setShowModal] = useState(false);

  const getStatusIcon = () => {
    // Don't show icon if validation status is empty
    if (validationStatus === '') {
      return <div className="w-6 h-6" />;
    }

    // Use validation status if provided
    if (validationStatus === 'complete') {
      return <img src="https://img.icons8.com/?size=100&id=ZBQJIdqe73bi&format=png&color=22C55E" alt="Complete" className="w-7 h-7" />;
    }
    if (validationStatus === 'needs_work') {
      return <img src="https://img.icons8.com/?size=100&id=lwhK4j4bx2Zx&format=png&color=F59E0B" alt="Needs Work" className="w-7 h-7" />;
    }
    if (validationStatus === 'incomplete') {
      return <img src="https://img.icons8.com/?size=100&id=iQ230Rs1gOvf&format=png&color=DC2626" alt="Incomplete" className="w-7 h-7" />;
    }

    // Fallback
    return <div className="w-6 h-6" />;
  };

  return (
    <div id={id} data-testid={number ? `question-wrapper-${number}` : undefined} className={`space-y-4 ${isExpanded ? 'my-[5%]' : 'mb-[3%]'} relative`}>
      {/* Status icon: inline on mobile, absolute on desktop */}
      {!isSubQuestion && showStatusIcon && (
        <div className="md:absolute md:-left-[50px] md:top-0 inline-flex md:block mb-1 md:mb-0">
          {getStatusIcon()}
        </div>
      )}
      <div
        className={`flex items-start gap-2 ${isCollapsible ? 'cursor-pointer' : ''} min-h-[44px]`}
        onClick={isCollapsible ? onToggle : undefined}
      >
        {number && (
          <span className="text-base md:text-lg font-semibold text-[#122947] flex-shrink-0 pt-0.5">
            {number}.
          </span>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <span className="text-base md:text-lg font-semibold text-[#122947] flex-1 leading-snug">
              {title}
              {required && <span className="text-red-500 ml-1">*</span>}
            </span>
            
            <div className="flex items-center gap-1 flex-shrink-0">
              {(guidance || why || examples) && (
                <button
                  type="button"
                  className="w-9 h-9 md:w-8 md:h-8 rounded-full bg-[#5B8AC4] hover:bg-[#4A7AB3] active:bg-[#3A6AA3] flex items-center justify-center text-white transition-all shadow-sm"
                  aria-label="More information"
                  title="Helper Info"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowModal(true);
                  }}
                >
                  <HelpCircle className="w-5 h-5" />
                </button>
              )}
              
              {onReset && hasAnswer && isExpanded && (
                <button
                  type="button"
                  className="w-9 h-9 md:w-6 md:h-6 rounded-full border border-[#C1C6C8] hover:border-red-500 hover:bg-red-50 active:bg-red-100 flex items-center justify-center text-[#566C75] hover:text-red-500 transition-all"
                  aria-label="Reset question"
                  title="Clear Answer"
                  onClick={(e) => {
                    e.stopPropagation();
                    onReset();
                  }}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
              
              {isCollapsible && (
                isExpanded ? (
                  <ChevronUp className="w-5 h-5 text-[#566C75]" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-[#566C75]" />
                )
              )}
            </div>
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="animate-in fade-in slide-in-from-top-2 duration-200 my-[5%]">
          {children}
        </div>
      )}
      
      <QuestionHelpModal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={title}
        why={why}
        guidance={guidance}
        examples={examples}
      />
    </div>
  );
}