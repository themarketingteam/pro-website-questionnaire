import React, { useState, useEffect, useRef } from 'react';

export default function NumericRangeQuestion({
  minValue = 1,
  maxValue = 50,
  onChange
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
            className="w-full p-3 border border-[#C1C6C8] rounded focus:outline-none focus:ring-2 focus:ring-[#1C82DE] focus:border-transparent"
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
            className="w-full p-3 border border-[#C1C6C8] rounded focus:outline-none focus:ring-2 focus:ring-[#1C82DE] focus:border-transparent"
          />
        </div>
        
        <span className="text-sm text-slate-600 mt-7">employees</span>
      </div>
      
      <div className="bg-[#E8F3FC] border border-[#1C82DE] rounded p-3">
        <span className="text-sm font-medium text-[#003865]">
          Result: {smallest}-{largestDisplay} employees
        </span>
      </div>
    </div>
  );
}