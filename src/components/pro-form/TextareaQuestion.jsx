import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import AIContentModal from './AIContentModal';

export default function TextareaQuestion({ 
  value, 
  onChange, 
  placeholder = "Enter your response...", 
  rows = 6,
  questionContext = "General question"
}) {
  const [showAIModal, setShowAIModal] = useState(false);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setShowAIModal(true)}
        className="text-sm text-purple-600 hover:text-purple-700 flex items-center gap-1.5 transition-colors"
      >
        <Sparkles className="w-3.5 h-3.5" />
        Generate with AI (Beta)
      </button>

      <textarea
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full p-3 border border-[#C1C6C8] rounded focus:outline-none focus:ring-2 focus:ring-[#1C82DE] focus:border-transparent resize-y min-h-[120px]"
      />

      <AIContentModal
        open={showAIModal}
        onClose={() => setShowAIModal(false)}
        currentValue={value}
        questionContext={questionContext}
        onInject={onChange}
      />
    </div>
  );
}