import React from 'react';
import { Info } from 'lucide-react';

export default function InfoMessageQuestion({ guidance }) {
  return (
    <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-6">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
          <Info className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1">
          <p className="text-blue-900 leading-relaxed">
            {guidance}
          </p>
        </div>
      </div>
    </div>
  );
}