import React from 'react';
import { Save } from 'lucide-react';

export default function AutoSaveIndicator() {
  return (
    <div className="fixed bottom-6 right-6 bg-white border border-slate-200 shadow-lg rounded-xl px-4 py-3 flex items-center gap-3 z-50">
      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
        <Save className="w-4 h-4 text-blue-600" />
      </div>
      <div>
        <p className="font-semibold text-slate-900 text-sm">💾 Auto-Save</p>
        <p className="text-xs text-slate-500">Your responses are automatically saved as a secure cookie.</p>
      </div>
    </div>
  );
}