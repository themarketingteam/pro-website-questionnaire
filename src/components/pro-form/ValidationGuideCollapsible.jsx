import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

export default function ValidationGuideCollapsible() {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="mb-8 bg-white border border-[#C1C6C8] rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <h3 className="text-base font-bold text-[#122947]">Validation Status Guide</h3>
          <div className="flex items-center gap-2">
            <img 
              src="https://img.icons8.com/?size=100&id=ZBQJIdqe73bi&format=png&color=22C55E" 
              alt="Complete" 
              className="w-5 h-5" 
            />
            <span className="text-xs text-green-700 font-medium">Complete</span>
            <span className="text-gray-400">•</span>
            <img 
              src="https://img.icons8.com/?size=100&id=lwhK4j4bx2Zx&format=png&color=F59E0B" 
              alt="Passing" 
              className="w-5 h-5" 
            />
            <span className="text-xs text-amber-700 font-medium">Passing</span>
          </div>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-5 h-5 text-[#566C75]" />
        ) : (
          <ChevronDown className="w-5 h-5 text-[#566C75]" />
        )}
      </button>

      {isExpanded && (
        <div className="px-6 pb-6 pt-4 border-t border-[#C1C6C8] animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Green - Complete */}
            <div className="flex items-start gap-3 p-5 bg-green-50 border border-green-200 rounded-lg">
              <img 
                src="https://img.icons8.com/?size=100&id=ZBQJIdqe73bi&format=png&color=22C55E" 
                alt="Complete" 
                className="w-7 h-7 flex-shrink-0 mt-0.5" 
              />
              <div>
                <h4 className="font-semibold text-green-900 mb-1 text-sm">Complete</h4>
                <p className="text-xs text-green-700">
                  Your answer meets all requirements and is ready for submission.
                </p>
              </div>
            </div>

            {/* Yellow - Passing (Needs Work) */}
            <div className="flex items-start gap-3 p-5 bg-amber-50 border border-amber-200 rounded-lg">
              <img 
                src="https://img.icons8.com/?size=100&id=lwhK4j4bx2Zx&format=png&color=F59E0B" 
                alt="Passing" 
                className="w-7 h-7 flex-shrink-0 mt-0.5" 
              />
              <div>
                <h4 className="font-semibold text-amber-900 mb-1 text-sm">Passing (Could Improve)</h4>
                <p className="text-xs text-amber-700">
                  Your answer is acceptable but could be enhanced with more detail or context.
                </p>
              </div>
            </div>

            {/* Red - Incomplete */}
            <div className="flex items-start gap-3 p-5 bg-red-50 border border-red-200 rounded-lg">
              <img 
                src="https://img.icons8.com/?size=100&id=iQ230Rs1gOvf&format=png&color=DC2626" 
                alt="Incomplete" 
                className="w-7 h-7 flex-shrink-0 mt-0.5" 
              />
              <div>
                <h4 className="font-semibold text-red-900 mb-1 text-sm">Incomplete</h4>
                <p className="text-xs text-red-700">
                  This question requires your attention. Please provide a complete answer.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}