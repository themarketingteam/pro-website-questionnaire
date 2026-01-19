import React from 'react';

export default function RadioQuestion({ options, value, onChange, showOther = false, otherValue = '', onOtherChange, otherPlaceholder = 'Please specify...' }) {
  return (
    <div className="space-y-2.5">
      {options.map((option) => (
        <label 
          key={option}
          className={`flex items-center gap-3 p-4 border rounded cursor-pointer transition-all ${
            value === option
              ? 'border-[#1C82DE] bg-[#E8F3FC] ring-2 ring-[#1C82DE]/20'
              : 'border-[#C1C6C8] hover:border-[#A9AAAC] hover:bg-gray-50'
          }`}
        >
          <input
            type="radio"
            name={`radio-${Math.random()}`}
            checked={value === option}
            onChange={() => onChange(option)}
            className="sr-only"
          />
          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
            value === option ? 'border-[#1C82DE] bg-[#1C82DE]' : 'border-[#A9AAAC]'
          }`}>
            {value === option && <div className="w-2 h-2 rounded-full bg-white" />}
          </div>
          <span className={`select-none ${
            value === option ? 'text-[#1C82DE] font-medium' : 'text-[#1E3950]'
          }`}>
            {option}
          </span>
        </label>
      ))}
      
      {showOther && (
        <div className="bg-gray-50 border border-[#C1C6C8] rounded p-4 transition-all">
          <label className="block">
            <span className="font-semibold text-[#122947] text-sm">Other (please specify):</span>
            <p className="text-xs text-[#566C75] mt-1">Add custom services not listed above (up to 3 entries). Each counts toward your selection limit.</p>
            <input
              type="text"
              placeholder={otherPlaceholder}
              className="w-full mt-3 p-3 border border-[#C1C6C8] rounded focus:outline-none focus:ring-2 focus:ring-[#1C82DE] focus:border-transparent"
              value={otherValue}
              onChange={(e) => {
                onOtherChange(e.target.value);
                onChange(e.target.value || 'Other');
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}