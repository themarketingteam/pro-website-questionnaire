import React from 'react';

export default function TextareaQuestion({ 
  value, 
  onChange, 
  placeholder = "Enter your response...",
  rows = 4
}) {
  return (
    <textarea
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full p-4 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none transition-all text-slate-700 placeholder:text-slate-400"
    />
  );
}