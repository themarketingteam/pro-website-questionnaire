import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle } from 'lucide-react';
import { useTextValidation } from './useTextValidation';

export default function TextareaQuestion({ 
  value, 
  onChange, 
  placeholder = "Enter your response...", 
  rows = 6,
  questionContext = "General question",
  questionId = ""
}) {
  const validation = useTextValidation(value, questionId, 3000);

  const getStatusIcon = () => {
    switch (validation.status) {
      case 'red':
        return <AlertCircle className="w-4 h-4 text-red-600" />;
      case 'yellow':
        return <AlertTriangle className="w-4 h-4 text-amber-600" />;
      case 'green':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      default:
        return null;
    }
  };

  const getStatusBorderClass = () => {
    switch (validation.status) {
      case 'red':
        return 'border-red-500 focus:ring-red-500';
      case 'yellow':
        return 'border-amber-500 focus:ring-amber-500';
      case 'green':
        return 'border-green-500 focus:ring-green-500';
      default:
        return 'border-[#C1C6C8] focus:ring-[#1C82DE]';
    }
  };

  const getStatusBgClass = () => {
    switch (validation.status) {
      case 'red':
        return 'bg-red-50 border-red-200 text-red-800';
      case 'yellow':
        return 'bg-amber-50 border-amber-200 text-amber-800';
      case 'green':
        return 'bg-green-50 border-green-200 text-green-800';
      default:
        return 'bg-gray-50 border-gray-200 text-gray-600';
    }
  };

  return (
    <div className="space-y-2">
      <textarea
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={`w-full p-3 border rounded focus:outline-none focus:ring-2 focus:border-transparent resize-y min-h-[120px] transition-colors ${getStatusBorderClass()}`}
      />

      {validation.status !== 'neutral' && validation.message && (
        <div className={`flex items-start gap-2 p-3 border rounded text-sm ${getStatusBgClass()}`}>
          {getStatusIcon()}
          <div className="flex-1">
            <p className="font-medium">{validation.message}</p>
            {validation.charCount > 0 && (
              <p className="text-xs mt-1 opacity-75">
                Character count: {validation.charCount}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}