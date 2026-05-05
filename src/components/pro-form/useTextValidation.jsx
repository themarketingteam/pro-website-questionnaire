import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';

export function useTextValidation(value, questionId, debounceMs = 3000, isManualValidating = false, setIsManualValidating = null, initialStatus = 'neutral', externalStatus = null) {
  const [validationState, setValidationState] = useState({
    status: initialStatus, // 'green', 'yellow', 'red', 'neutral'
    message: '',
    charCount: 0,
    expectedRange: null
  });
  
  // Sync from Redux status changes (e.g., submit-time results, resets)
  useEffect(() => {
    if (!externalStatus) return;
    const mapIn = { complete: 'green', needs_work: 'yellow', incomplete: 'red', neutral: 'neutral', '': 'neutral' };
    setValidationState(prev => ({
      ...prev,
      status: mapIn[externalStatus] || 'neutral'
    }));
  }, [externalStatus]);

  // Manual validation trigger - ONLY validation method now
  useEffect(() => {
    if (isManualValidating && value && value.trim().length > 0) {
      if (import.meta.env.DEV) {
        console.log(`🔘 [Q${questionId}] Manual validation effect triggered`);
      }
      validateText(value, questionId).finally(() => {
        if (setIsManualValidating) {
          setIsManualValidating(false);
        }
      });
    }
  }, [isManualValidating]);

  // Track the last validated value
  const lastValidatedValueRef = useRef(value);

  // Update char count on value change, reset validation if content changes
  useEffect(() => {
    if (!value || value.trim().length === 0) {
      setValidationState({
        status: 'neutral',
        message: '',
        charCount: 0,
        expectedRange: null
      });
      lastValidatedValueRef.current = '';
    } else {
      // If value changed from last validated value, reset to neutral
      if (lastValidatedValueRef.current && value !== lastValidatedValueRef.current) {
        setValidationState({
          status: 'neutral',
          message: '',
          charCount: value.length,
          expectedRange: null
        });
      } else {
        // Just update char count without changing status
        setValidationState(prev => ({
          ...prev,
          charCount: value.length
        }));
      }
    }
  }, [value]);

  const validateText = async (text, qId) => {
    try {
      if (import.meta.env.DEV) {
        console.log(`🔍 [Q${qId}] Starting validation via backend function`);
        console.log(`📝 [Q${qId}] Text length: ${text.length} characters`);
      }
      
      // Call backend function instead of direct agent access
      const questionKey = `question_${qId.replace('.', '_')}`;
      const response = await base44.functions.invoke('validateQuestionText', {
        text: text,
        questionContext: questionKey
      });

      if (import.meta.env.DEV) {
        console.log(`📨 [Q${qId}] Backend response status:`, response.status);
      }

      if (response.status !== 200) {
        throw new Error(response.data?.error || 'Validation failed');
      }

      const result = response.data;
      if (import.meta.env.DEV) {
        console.log(`✅ [Q${qId}] Validation status:`, result?.status);
      }

      // Map validation status to UI status
      const statusMap = {
        'complete': 'green',
        'needs_work': 'yellow',
        'incomplete': 'red'
      };

      setValidationState({
        status: statusMap[result.status] || 'neutral',
        message: result.message || '',
        charCount: result.characterCount || text.length,
        expectedRange: result.expectedRange || null
      });

      // Update last validated value
      lastValidatedValueRef.current = text;

    } catch (error) {
      console.error(`❌ [Q${qId}] Validation error:`, error);
      if (import.meta.env.DEV) {
        console.error(`❌ [Q${qId}] Error details:`, {
          message: error.message,
          stack: error.stack,
          error: error
        });
      }
      // Fallback to neutral on error
      setValidationState({
        status: 'neutral',
        message: '',
        charCount: text.length,
        expectedRange: null
      });
    }
  };

  return validationState;
}