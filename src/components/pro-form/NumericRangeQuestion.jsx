import React, { useState, useEffect, useRef } from 'react';
import { Lock, AlertCircle } from 'lucide-react';
import useScopedUiDraftState, { buildQuestionUiDraftScope } from './useScopedUiDraftState';

export default function NumericRangeQuestion({
  minValue = 1,
  maxValue = 50,
  onChange,
  value,
  questionId,
  draftCaptureEnabled = false,
}) {
  const uiDraft = useScopedUiDraftState({
    scopeKey: buildQuestionUiDraftScope(questionId, 'numeric-range'),
    kind: 'numeric-range',
    enabled: draftCaptureEnabled,
  });
  const [smallest, setSmallest] = useState(() => uiDraft.data.smallestParsed ?? minValue);
  const [largest, setLargest] = useState(() => uiDraft.data.largestParsed ?? maxValue);
  const [smallestInput, setSmallestInput] = useState(
    () => uiDraft.data.smallestInput ?? minValue.toString(),
  );
  const [largestInput, setLargestInput] = useState(
    () => uiDraft.data.largestInput ?? maxValue.toString(),
  );
  const [isLocked, setIsLocked] = useState(() => uiDraft.data.editing === false);
  const [validationError, setValidationError] = useState(
    () => uiDraft.data.validationMessageCode === 'RANGE_ORDER_INVALID'
      ? 'The largest company size must be greater than or equal to the smallest company size.'
      : '',
  );
  const smallestTimerRef = useRef(null);
  const largestTimerRef = useRef(null);
  const persistEditing = (patch) => uiDraft.setData({
    smallestInput,
    largestInput,
    smallestParsed: smallest,
    largestParsed: largest,
    editing: true,
    validationMessageCode: validationError ? 'RANGE_ORDER_INVALID' : null,
    ...patch,
  });

  // Initialize from saved value
  useEffect(() => {
    if (value && typeof value === 'string') {
      const match = value.match(/^(\d+)-(\d+\+?)\s+employees$/);
      if (match) {
        const min = parseInt(match[1], 10);
        const maxStr = match[2];
        setSmallest(min);
        setSmallestInput(min.toString());
        
        if (maxStr.includes('+')) {
          setLargest(5001);
          setLargestInput('');
        } else {
          const max = parseInt(maxStr, 10);
          setLargest(max);
          setLargestInput(max.toString());
        }
        setIsLocked(true);
      }
    } else if (!value && !uiDraft.entry) {
      // Reset to defaults when value is cleared
      setSmallest(minValue);
      setLargest(maxValue);
      setSmallestInput(minValue.toString());
      setLargestInput(maxValue.toString());
      setIsLocked(false);
      setValidationError('');
    }
  }, [value, minValue, maxValue, uiDraft.entry]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (smallestTimerRef.current) clearTimeout(smallestTimerRef.current);
      if (largestTimerRef.current) clearTimeout(largestTimerRef.current);
    };
  }, []);

  const handleSmallestChange = (e) => {
    const value = e.target.value;
    setSmallestInput(value);
    setIsLocked(false);
    setValidationError('');
    onChange(''); // Clear the saved value when user starts editing
    persistEditing({ smallestInput: value, validationMessageCode: null });

    // Clear any existing timer
    if (smallestTimerRef.current) {
      clearTimeout(smallestTimerRef.current);
      smallestTimerRef.current = null;
    }

    // Check if empty
    if (value === '') {
      smallestTimerRef.current = setTimeout(() => {
        setSmallestInput(minValue.toString());
        setSmallest(minValue);
      }, 5000);
    } else {
      const parsed = parseInt(value, 10);
      if (!isNaN(parsed)) {
        const clamped = Math.max(1, parsed);
        setSmallest(clamped);
        persistEditing({ smallestInput: value, smallestParsed: clamped, validationMessageCode: null });
      }
    }
  };

  const handleLargestChange = (e) => {
    const value = e.target.value;
    setLargestInput(value);
    setIsLocked(false);
    setValidationError('');
    onChange(''); // Clear the saved value when user starts editing
    persistEditing({ largestInput: value, validationMessageCode: null });

    // Clear any existing timer
    if (largestTimerRef.current) {
      clearTimeout(largestTimerRef.current);
      largestTimerRef.current = null;
    }

    // Check if empty
    if (value === '') {
      largestTimerRef.current = setTimeout(() => {
        setLargestInput(maxValue.toString());
        setLargest(maxValue);
      }, 5000);
    } else {
      const parsed = parseInt(value, 10);
      if (!isNaN(parsed)) {
        const clamped = Math.max(1, parsed);
        if (clamped > 5000) {
          setLargest(5001);
          persistEditing({ largestInput: value, largestParsed: 5001, validationMessageCode: null });
        } else {
          setLargest(clamped);
          persistEditing({ largestInput: value, largestParsed: clamped, validationMessageCode: null });
        }
      }
    }
  };

  const handleLockIn = () => {
    // Validate that largest is not smaller than smallest
    if (largest <= 5000 && largest < smallest) {
      setValidationError('The largest company size must be greater than or equal to the smallest company size.');
      persistEditing({ validationMessageCode: 'RANGE_ORDER_INVALID' });
      return;
    }
    
    setValidationError('');
    const largestDisplay = largest > 5000 ? "5000+" : largest;
    const formattedValue = `${smallest}-${largestDisplay} employees`;
    onChange(formattedValue);
    setIsLocked(true);
    uiDraft.clear();
  };

  const largestDisplay = largest > 5000 ? "5000+" : largest;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label htmlFor={`numeric-smallest-${questionId}`} className="block text-sm font-medium text-slate-700 mb-2">
            Smallest company size
          </label>
          <input
            id={`numeric-smallest-${questionId}`}
            type="text"
            min="1"
            value={smallestInput}
            onChange={handleSmallestChange}
            className="w-full p-3 border border-[#C1C6C8] rounded focus:outline-none focus:ring-2 focus:ring-[#1C82DE] focus:border-transparent"
          />
        </div>
        
        <span className="text-2xl text-slate-400 mt-7">—</span>
        
        <div className="flex-1">
          <label htmlFor={`numeric-largest-${questionId}`} className="block text-sm font-medium text-slate-700 mb-2">
            Largest company size
          </label>
          <input
            id={`numeric-largest-${questionId}`}
            type="text"
            placeholder="5000+"
            value={largest > 5000 ? '' : largestInput}
            onChange={handleLargestChange}
            className="w-full p-3 border border-[#C1C6C8] rounded focus:outline-none focus:ring-2 focus:ring-[#1C82DE] focus:border-transparent"
          />
        </div>
        
        <span className="text-sm text-slate-600 mt-7">employees</span>
      </div>
      
      {validationError && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <span className="text-sm text-red-800">{validationError}</span>
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="flex-1 bg-[#E8F3FC] border border-[#1C82DE] rounded p-3">
          <span className="text-sm font-medium text-[#003865]">
            Result: {smallest}-{largestDisplay} employees
          </span>
        </div>
        <button
          type="button"
          onClick={handleLockIn}
          disabled={isLocked}
          className={`px-6 py-3 rounded font-medium transition-colors flex items-center gap-2 ${
            isLocked 
              ? 'bg-green-600 text-white cursor-default' 
              : 'bg-[#1C82DE] hover:bg-[#075DA7] text-white'
          }`}
        >
          <Lock className="w-4 h-4" />
          {isLocked ? 'Confirmed' : 'Confirm'}
        </button>
      </div>
    </div>
  );
}
