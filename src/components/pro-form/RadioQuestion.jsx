import React from 'react';

export default function RadioQuestion({ options, value, onChange, showOther = false, otherValue = '', onOtherChange }) {
  return (
    <div className="space-y-2.5">
      {options.map((option) => (
        <label 
          key={option}
          className={`flex items-center gap-3 p-4 border rounded-xl cursor-pointer transition-all ${
            value === option
              ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500/20'
              : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
          }`}
        >
          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
            value === option ? 'border-blue-500 bg-blue-500' : 'border-slate-300'
          }`}>
            {value === option && <div className="w-2 h-2 rounded-full bg-white" />}
          </div>
          <span className={`select-none ${
            value === option ? 'text-blue-700 font-medium' : 'text-slate-700'
          }`}>
            {option}
          </span>
        </label>
      ))}
      
      {showOther && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 transition-all">
          <label className="block">
            <span className="font-semibold text-slate-900 text-sm">Other (please specify):</span>
            <input
              type="text"
              placeholder="Enter your option..."
              className="w-full mt-3 p-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              value={otherValue}
              onChange={(e) => onOtherChange(e.target.value)}
              onFocus={() => onChange('Other')}
            />
          </label>
        </div>
      )}
    </div>
  );
}