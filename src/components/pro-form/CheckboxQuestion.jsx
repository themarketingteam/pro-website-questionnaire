import React from 'react';
import { Check } from 'lucide-react';

export default function CheckboxQuestion({ 
  options, 
  groupedOptions,
  value = [], 
  onChange, 
  min, 
  max,
  showOther = false,
  otherValue = '',
  onOtherChange
}) {
  // Use multi-other when there's a max limit
  const multiOther = showOther && max;
  const multiOtherMax = max || 10;
  const handleToggle = (option) => {
    const newValue = value.includes(option)
      ? value.filter(v => v !== option)
      : [...value, option];
    
    // Enforce max limit
    if (max && newValue.length > max) return;
    
    onChange(newValue);
  };

  // Count other entries for max calculation
  const otherEntriesCount = multiOther 
    ? (Array.isArray(otherValue) ? otherValue.filter(v => v.trim()).length : 0)
    : (otherValue?.trim() ? 1 : 0);

  const totalSelections = value.length + otherEntriesCount;

  const isDisabled = (option) => {
    if (!max) return false;
    return totalSelections >= max && !value.includes(option);
  };

  const canAddMoreOther = !max || totalSelections < max;

  return (
    <div className="space-y-4">
      {(min || max) && (
        <span className={`text-sm font-medium block ${
          totalSelections < (min || 0) ? 'text-amber-600' : 
          totalSelections > (max || Infinity) ? 'text-red-600' : 'text-slate-600'
        }`}>
          {totalSelections} / {max || '∞'} selections
          {min && ` (minimum ${min})`}
        </span>
      )}
      
      {groupedOptions ? (
        <div className="space-y-4">
          {Object.entries(groupedOptions).map(([groupName, groupOptions]) => (
            <div key={groupName}>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{groupName}</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {groupOptions.map((option) => (
                  <div 
                    key={option}
                    onClick={() => !isDisabled(option) && handleToggle(option)}
                    className={`flex items-center gap-3 p-3 border rounded-xl cursor-pointer transition-all ${
                      value.includes(option)
                        ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500/20'
                        : isDisabled(option)
                        ? 'border-slate-100 bg-slate-50 cursor-not-allowed opacity-50'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className={`w-5 h-5 flex-shrink-0 rounded border-2 flex items-center justify-center transition-all ${
                      value.includes(option) 
                        ? 'border-blue-500 bg-blue-500' 
                        : 'border-slate-300'
                    }`}>
                      {value.includes(option) && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <span className={`select-none text-sm ${
                      value.includes(option) ? 'text-blue-700 font-medium' : 'text-slate-700'
                    }`}>
                      {option}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {options.map((option) => (
            <div 
              key={option}
              onClick={() => !isDisabled(option) && handleToggle(option)}
              className={`flex items-center gap-3 p-4 border rounded-xl cursor-pointer transition-all ${
                value.includes(option)
                  ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500/20'
                  : isDisabled(option)
                  ? 'border-slate-100 bg-slate-50 cursor-not-allowed opacity-50'
                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <div className={`w-5 h-5 flex-shrink-0 rounded border-2 flex items-center justify-center transition-all ${
                value.includes(option) 
                  ? 'border-blue-500 bg-blue-500' 
                  : 'border-slate-300'
              }`}>
                {value.includes(option) && <Check className="w-3 h-3 text-white" />}
              </div>
              <span className={`select-none text-sm ${
                value.includes(option) ? 'text-blue-700 font-medium' : 'text-slate-700'
              }`}>
                {option}
              </span>
            </div>
          ))}
        </div>
      )}
      
      {showOther && !multiOther && (
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

      {showOther && multiOther && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 transition-all">
          <div className="mb-3">
            <span className="font-semibold text-slate-900 text-sm">Other (please specify):</span>
            <span className="text-xs text-slate-500 block mt-1">
              Add custom services not listed above (up to {multiOtherMax} entries). Each counts toward your selection limit.
            </span>
          </div>
          <div className="space-y-2">
            {(Array.isArray(otherValue) ? otherValue : ['']).map((entry, idx) => (
              <div key={idx} className="flex gap-2">
                <input
                  type="text"
                  placeholder={`e.g., "Mac Certified Technician"`}
                  className="flex-1 p-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  value={entry}
                  onChange={(e) => {
                    const newOther = [...(Array.isArray(otherValue) ? otherValue : [''])];
                    newOther[idx] = e.target.value;
                    onOtherChange(newOther);
                  }}
                />
                {(Array.isArray(otherValue) ? otherValue : ['']).length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      const newOther = (Array.isArray(otherValue) ? otherValue : ['']).filter((_, i) => i !== idx);
                      onOtherChange(newOther.length ? newOther : ['']);
                    }}
                    className="px-3 py-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {(Array.isArray(otherValue) ? otherValue : ['']).length < multiOtherMax && canAddMoreOther && (
              <button
                type="button"
                onClick={() => {
                  const newOther = [...(Array.isArray(otherValue) ? otherValue : ['']), ''];
                  onOtherChange(newOther);
                }}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium mt-2"
              >
                + Add another
              </button>
            )}
          </div>
        </div>
      )}
      </div>
      );
      }