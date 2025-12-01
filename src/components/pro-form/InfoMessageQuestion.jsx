import React from 'react';
import { Info } from 'lucide-react';

export default function InfoMessageQuestion({ guidance, onLinkClick }) {
  // Split guidance text at "Question 12" to make it clickable
  const parts = guidance.split('Question 12');
  
  return (
    <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-6">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
          <Info className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1">
          <p className="text-blue-900 leading-relaxed">
            {parts[0]}
            {parts.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={onLinkClick}
                  className="text-blue-600 font-bold hover:text-blue-800 underline cursor-pointer"
                >
                  Question 12
                </button>
                {parts[1]}
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}