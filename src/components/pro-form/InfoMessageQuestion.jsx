import React from 'react';
import { Info } from 'lucide-react';

export default function InfoMessageQuestion({ textBefore, linkLabel, textAfter, onLinkClick, guidance }) {
  // Backward compatibility: if only guidance is provided, render as plain text without dynamic splitting
  const hasExplicit = typeof textBefore === 'string' || typeof linkLabel === 'string' || typeof textAfter === 'string';

  return (
    <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-6">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
          <Info className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1">
          {hasExplicit ? (
            <p className="text-blue-900 leading-relaxed">
              {textBefore}
              {linkLabel && (
                <button
                  type="button"
                  onClick={onLinkClick}
                  className="text-blue-600 font-bold hover:text-blue-800 underline cursor-pointer mx-1"
                >
                  {linkLabel}
                </button>
              )}
              {textAfter}
            </p>
          ) : (
            <p className="text-blue-900 leading-relaxed">{guidance}</p>
          )}
        </div>
      </div>
    </div>
  );
}