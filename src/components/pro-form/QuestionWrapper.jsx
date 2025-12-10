import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Info, RotateCcw, CheckCircle2, AlertCircle, AlertTriangle } from 'lucide-react';
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
  wasTouched = false
}) {
  const [showModal, setShowModal] = useState(false);

  const getStatusIcon = () => {
    if (isComplete) {
      return <CheckCircle2 className="w-6 h-6 text-green-600" />;
    }
    if (wasTouched && !isComplete) {
      return <AlertCircle className="w-6 h-6 text-red-600" />;
    }
    return <div className="w-6 h-6" />;
  };

  return (
    <div id={id} className={`space-y-4 ${isExpanded ? 'my-[5%]' : 'mb-[3%]'} relative`}>
      <div className="absolute -left-10 top-1">
        {getStatusIcon()}
      </div>
      <div className="flex items-start">
        <div 
          className={`block flex-1 ${isCollapsible ? 'cursor-pointer' : ''}`}
          onClick={isCollapsible ? onToggle : undefined}
        >
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-[#122947]">
              {number}. {title}
              {required && <span className="text-red-500 ml-1">*</span>}
            </span>
            
            {(guidance || why || examples) && (
              <button
                type="button"
                className="w-6 h-6 rounded-full border border-[#C1C6C8] hover:border-[#1C82DE] hover:bg-[#E8F3FC] flex items-center justify-center text-[#566C75] hover:text-[#1C82DE] transition-all"
                aria-label="More information"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowModal(true);
                }}
              >
                <Info className="w-3.5 h-3.5" />
              </button>
            )}
            
            {onReset && hasAnswer && isExpanded && (
              <button
                type="button"
                className="w-6 h-6 rounded-full border border-[#C1C6C8] hover:border-red-500 hover:bg-red-50 flex items-center justify-center text-[#566C75] hover:text-red-500 transition-all"
                aria-label="Reset question"
                title="Clear answer"
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
                <ChevronUp className="w-5 h-5 text-[#566C75] ml-auto" />
              ) : (
                <ChevronDown className="w-5 h-5 text-[#566C75] ml-auto" />
              )
            )}
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