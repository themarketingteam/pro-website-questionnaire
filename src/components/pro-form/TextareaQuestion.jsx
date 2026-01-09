import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import { useTextValidation } from './useTextValidation';

export default function TextareaQuestion({ 
  value, 
  onChange, 
  placeholder = "Enter your response...", 
  rows = 6,
  questionContext = "General question",
  questionId = "",
  debounceMs = 8000,
  onValidationChange,
  currentValidationStatus = 'neutral'
}) {
  const [isManualValidating, setIsManualValidating] = useState(false);
  const [localValue, setLocalValue] = useState(value || '');
  const debounceTimeoutRef = useRef(null);
  
  // Map parent validation status to internal status
  const statusMap = {
    'complete': 'green',
    'needs_work': 'yellow',
    'incomplete': 'red',
    'neutral': 'neutral',
    '': 'neutral'
  };
  const initialStatus = statusMap[currentValidationStatus] || 'neutral';
  
  const validation = useTextValidation(value, questionId, 250, isManualValidating, setIsManualValidating, initialStatus);

  // Sync local value when value prop changes externally
  useEffect(() => {
    setLocalValue(value || '');
  }, [value]);

  // Debounced save handler
  const handleTextChange = (newValue) => {
    setLocalValue(newValue);
    
    // Clear existing timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    
    // Set new timeout for 8 seconds
    debounceTimeoutRef.current = setTimeout(() => {
      console.log(`💾 [Q${questionId}] Auto-saving after 8 seconds of inactivity`);
      onChange(newValue);
    }, 8000);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  const handleManualValidate = () => {
    if (!localValue || localValue.trim().length === 0) return;
    console.log(`🔘 [Q${questionId}] Manual validation triggered`);
    
    // Save immediately before validating
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    onChange(localValue);
    
    setIsManualValidating(true);
  };

  // Report validation status to parent
  React.useEffect(() => {
    if (onValidationChange) {
      // Map internal status to validation status
      const statusMap = {
        'green': 'complete',
        'yellow': 'needs_work',
        'red': 'incomplete',
        'neutral': 'incomplete'
      };
      onValidationChange(statusMap[validation.status] || 'incomplete');
    }
  }, [validation.status, onValidationChange]);

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
    <div className="space-y-3">
      <textarea
        value={localValue}
        onChange={(e) => handleTextChange(e.target.value)}
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
                {validation.expectedRange && ` • Expected range: ${validation.expectedRange}`}
              </p>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={handleManualValidate}
        disabled={isManualValidating || !localValue || localValue.trim().length === 0}
        className="px-4 py-2 bg-[#1C82DE] hover:bg-[#075DA7] text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
      >
        {isManualValidating ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Validating...
          </>
        ) : (
          'Validate Now'
        )}
      </button>
    </div>
  );
}