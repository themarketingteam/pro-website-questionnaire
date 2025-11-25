import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';

export default function NumericRangeQuestion({
  questionNumber,
  title,
  hint,
  minValue = 1,
  maxValue = 50,
  onChange,
  onInfoClick,
  isOpen = true,
  onClick
}) {
  const [smallest, setSmallest] = useState(minValue);
  const [largest, setLargest] = useState(maxValue);
  const [largestInput, setLargestInput] = useState(maxValue.toString());
  const emptyTimerRef = useRef(null);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (emptyTimerRef.current) {
        clearTimeout(emptyTimerRef.current);
      }
    };
  }, []);

  // Output format
  useEffect(() => {
    const largestDisplay = largest > 1000 ? "1000+" : largest;
    const formattedValue = `${smallest}-${largestDisplay} employees`;
    onChange(formattedValue);
  }, [smallest, largest, onChange]);

  const handleSmallestChange = (e) => {
    const value = e.target.value;
    const parsed = parseInt(value, 10);
    const clamped = Math.max(1, isNaN(parsed) ? 1 : parsed);
    setSmallest(clamped);
  };

  const handleLargestChange = (e) => {
    const value = e.target.value;
    setLargestInput(value);

    // Clear any existing timer
    if (emptyTimerRef.current) {
      clearTimeout(emptyTimerRef.current);
      emptyTimerRef.current = null;
    }

    // Check if empty or null
    if (value === '' || value === null) {
      // Start NEW 5-second timer
      emptyTimerRef.current = setTimeout(() => {
        setLargestInput(maxValue.toString());
        setLargest(maxValue);
      }, 5000);
    } else {
      // Parse as integer
      const parsed = parseInt(value, 10);
      if (!isNaN(parsed)) {
        const clamped = Math.max(1, parsed);
        if (clamped > 1000) {
          setLargest(1001); // special flag
        } else {
          setLargest(clamped);
        }
      }
    }
  };

  const largestDisplay = largest > 1000 ? "1000+" : largest;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div 
          className={`block flex-1 ${onClick ? 'cursor-pointer' : ''}`}
          onClick={onClick}
        >
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-slate-900">
              {questionNumber}. {title}
            </span>
            
            {onInfoClick && (
              <button
                type="button"
                className="w-6 h-6 rounded-full border border-slate-300 hover:border-blue-400 hover:bg-blue-50 flex items-center justify-center text-slate-600 hover:text-blue-600 transition-all"
                aria-label="More information"
                onClick={(e) => {
                  e.stopPropagation();
                  onInfoClick();
                }}
              >
                <Info className="w-3.5 h-3.5" />
              </button>
            )}
            
            {onClick && (
              isOpen ? (
                <ChevronUp className="w-5 h-5 text-slate-400 ml-auto" />
              ) : (
                <ChevronDown className="w-5 h-5 text-slate-400 ml-auto" />
              )
            )}
          </div>
          {hint && <p className="text-sm text-slate-500 mt-1">{hint}</p>}
        </div>
      </div>
      
      {isOpen && (
        <div className="animate-in fade-in slide-in-from-top-2 duration-200 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Smallest company size
              </label>
              <input
                type="number"
                min="1"
                value={smallest}
                onChange={handleSmallestChange}
                className="w-full p-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            
            <span className="text-2xl text-slate-400 mt-7">—</span>
            
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Largest company size
              </label>
              <input
                type="text"
                placeholder="1000+"
                value={largest > 1000 ? '' : largestInput}
                onChange={handleLargestChange}
                className="w-full p-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            
            <span className="text-sm text-slate-600 mt-7">employees</span>
          </div>
          
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <span className="text-sm font-medium text-blue-900">
              Result: {smallest}-{largestDisplay} employees
            </span>
          </div>
        </div>
      )}
    </div>
  );
}