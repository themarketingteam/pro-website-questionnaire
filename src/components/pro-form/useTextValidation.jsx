import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';

export function useTextValidation(value, questionId, debounceMs = 3000, isManualValidating = false, setIsManualValidating = null) {
  const [validationState, setValidationState] = useState({
    status: 'neutral', // 'green', 'yellow', 'red', 'neutral'
    message: '',
    charCount: 0
  });
  
  const timerRef = useRef(null);
  const conversationRef = useRef(null);

  // Manual validation trigger
  useEffect(() => {
    if (isManualValidating && value && value.trim().length > 0) {
      console.log(`🔘 [Q${questionId}] Manual validation effect triggered`);
      validateText(value, questionId).finally(() => {
        if (setIsManualValidating) {
          setIsManualValidating(false);
        }
      });
    }
  }, [isManualValidating]);

  useEffect(() => {
    // Clear any existing timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // Don't validate empty inputs
    if (!value || value.trim().length === 0) {
      setValidationState({
        status: 'neutral',
        message: '',
        charCount: 0
      });
      return;
    }

    // Start new timer - call async function
    timerRef.current = setTimeout(async () => {
      await validateText(value, questionId);
    }, debounceMs);

    // Cleanup
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [value, questionId, debounceMs]);

  const validateText = async (text, qId) => {
    try {
      console.log(`🔍 [Q${qId}] Starting validation via backend function`);
      console.log(`📝 [Q${qId}] Text length: ${text.length} characters`);
      
      // Call backend function instead of direct agent access
      const questionKey = `question_${qId.replace('.', '_')}`;
      const response = await base44.functions.invoke('validateQuestionText', {
        text: text,
        questionContext: questionKey
      });

      console.log(`📨 [Q${qId}] Backend response:`, response);

      if (response.status !== 200) {
        throw new Error(response.data?.error || 'Validation failed');
      }

      const result = response.data;
      console.log(`✅ [Q${qId}] Validation result:`, result);

      // Map validation status to UI status
      const statusMap = {
        'complete': 'green',
        'needs_work': 'yellow',
        'incomplete': 'red'
      };

      setValidationState({
        status: statusMap[result.status] || 'neutral',
        message: result.message || '',
        charCount: result.characterCount || text.length
      });

    } catch (error) {
      console.error(`❌ [Q${qId}] Validation error:`, error);
      console.error(`❌ [Q${qId}] Error details:`, {
        message: error.message,
        stack: error.stack,
        error: error
      });
      // Fallback to neutral on error
      setValidationState({
        status: 'neutral',
        message: '',
        charCount: text.length
      });
    }
  };

  return validationState;
}