import React from 'react';

export default function ValidationGuide() {
  return (
    <div className="mt-16 pt-8 border-t-2 border-[#C1C6C8]">
      <h3 className="text-lg font-bold text-[#122947] mb-4">Validation Status Guide</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Green - Complete */}
        <div className="flex items-start gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
          <img 
            src="https://img.icons8.com/?size=100&id=ZBQJIdqe73bi&format=gif&color=22C55E" 
            alt="Complete" 
            className="w-8 h-8 flex-shrink-0 mt-0.5" 
          />
          <div>
            <h4 className="font-semibold text-green-900 mb-1">Complete</h4>
            <p className="text-sm text-green-700">
              Your answer meets all requirements and is ready for submission.
            </p>
          </div>
        </div>

        {/* Yellow - Needs Work */}
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <img 
            src="https://img.icons8.com/?size=100&id=lwhK4j4bx2Zx&format=gif&color=F59E0B" 
            alt="Needs Improvement" 
            className="w-8 h-8 flex-shrink-0 mt-0.5" 
          />
          <div>
            <h4 className="font-semibold text-amber-900 mb-1">Needs Improvement</h4>
            <p className="text-sm text-amber-700">
              Your answer is acceptable but could be enhanced. Consider adding more detail or context to strengthen your response.
            </p>
          </div>
        </div>

        {/* Red - Incomplete */}
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
          <img 
            src="https://img.icons8.com/?size=100&id=iQ230Rs1gOvf&format=gif&color=DC2626" 
            alt="Incomplete" 
            className="w-8 h-8 flex-shrink-0 mt-0.5" 
          />
          <div>
            <h4 className="font-semibold text-red-900 mb-1">Incomplete</h4>
            <p className="text-sm text-red-700">
              This question requires your attention. Please provide a complete answer to proceed.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}