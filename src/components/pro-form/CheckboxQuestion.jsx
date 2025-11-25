import React from 'react';
import { Check } from 'lucide-react';

export default function CheckboxQuestion({ 
  options, 
  value = [], 
  onChange, 
  min, 
  max,
  showOther = false,
  otherValue = '',
  onOtherChange
}) {
  const handleToggle = (option) => {
    const newValue = value.includes(option)
      ? value.filter(v => v !== option)
      : [...value, option];
    
    // Enforce max limit
    if (max && newValue.length > max) return;
    
    onChange(newValue);
  };

  const isDisabled = (option) => {
    if (!max) return false;
    return value.length >= max && !value.includes(option);
  };

  return (
    <div className="space-y-4">
      {(min || max) && (
        <span className={`text-sm font-medium block ${
          value.length < (min || 0) ? 'text-amber-600' : 
          value.length > (max || Infinity) ? 'text-red-600' : 'text-slate-600'
        }`}>
          {value.length} / {max || '∞'} selections
          {min && ` (minimum ${min})`}
        </span>
      )}
      
      <div className="space-y-2.5">
        {options.map((option) => (
          <label 
            key={option}
            className={`flex items-center gap-3 p-4 border rounded-xl cursor-pointer transition-all ${
              value.includes(option)
                ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500/20'
                : isDisabled(option)
                ? 'border-slate-100 bg-slate-50 cursor-not-allowed opacity-50'
                : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
              value.includes(option) 
                ? 'border-blue-500 bg-blue-500' 
                : 'border-slate-300'
            }`}>
              {value.includes(option) && <Check className="w-3 h-3 text-white" />}
            </div>
            <span className={`select-none ${
              value.includes(option) ? 'text-blue-700 font-medium' : 'text-slate-700'
            }`}>
              {option}
            </span>
          </label>
        ))}
      </div>
      
      {showOther && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 transition-all">
          <label className="block">
            <span className="font-semibold text-slate-900 text-sm">Other (please specify):</span>
            <span className="text-xs text-slate-500 block mt-1">
              Enter a single option only (no commas or multiple items)
            </span>
            <input
              type="text"
              placeholder="Enter one option only..."
              className="w-full mt-3 p-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              value={otherValue}
              onChange={(e) => onOtherChange(e.target.value)}
            />
          </label>
        </div>
      )}
    </div>
  );
}