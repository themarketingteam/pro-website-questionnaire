import { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

const VALIDATION_UNAVAILABLE_MESSAGE =
  "We couldn't validate this answer right now. Please try again. Your response has been preserved.";
const TRANSIENT_RETRY_DELAY_MS = 300;

export function useTextValidation(value, questionId, initialStatus = 'neutral', externalStatus = null) {
  const [validationState, setValidationState] = useState({
    status: initialStatus, // 'green', 'yellow', 'red', 'neutral', 'error'
    message: '',
    charCount: 0,
    expectedRange: null
  });
  const [isValidating, setIsValidating] = useState(false);
  const validationInFlightRef = useRef(false);
  const lastValidatedValueRef = useRef(value);
  
  // Sync from Redux status changes (e.g., submit-time results, resets)
  useEffect(() => {
    if (!externalStatus) return;
    const mapIn = { complete: 'green', needs_work: 'yellow', incomplete: 'red', neutral: 'neutral', '': 'neutral' };
    setValidationState(prev => ({
      ...prev,
      status: mapIn[externalStatus] || 'neutral'
    }));
  }, [externalStatus]);

  // Update char count on value change, reset validation if content changes
  useEffect(() => {
    const textValue = typeof value === 'string' ? value : String(value ?? '');

    if (textValue.trim().length === 0) {
      setValidationState({
        status: 'neutral',
        message: '',
        charCount: 0,
        expectedRange: null
      });
      lastValidatedValueRef.current = '';
    } else {
      // If value changed from last validated value, reset to neutral
      if (lastValidatedValueRef.current && textValue !== lastValidatedValueRef.current) {
        setValidationState({
          status: 'neutral',
          message: '',
          charCount: textValue.length,
          expectedRange: null
        });
      } else {
        // Just update char count without changing status
        setValidationState(prev => ({
          ...prev,
          charCount: textValue.length
        }));
      }
    }
  }, [value]);

  const validateNow = useCallback(async () => {
    const text = typeof value === 'string' ? value : String(value ?? '');
    const qId = String(questionId ?? '');

    if (!text.trim() || !qId || validationInFlightRef.current) {
      return null;
    }

    validationInFlightRef.current = true;
    setIsValidating(true);

    try {
      if (import.meta.env.DEV) {
        console.log(`🔍 [Q${qId}] Starting validation via backend function`);
        console.log(`📝 [Q${qId}] Text length: ${text.length} characters`);
      }
      
      // Call backend function instead of direct agent access
      const questionKey = `question_${qId.replace('.', '_')}`;
      let response;
      let lastInvokeError;

      // Validation is read-only, so one short automatic retry is safe and removes
      // the most common live failure mode: a transient function/network hiccup.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          response = await base44.functions.invoke('validateQuestionText', {
            text,
            questionContext: questionKey
          });

          if (response?.status && response.status >= 500) {
            throw new Error(response?.data?.error || 'Validation service unavailable');
          }

          lastInvokeError = null;
          break;
        } catch (error) {
          lastInvokeError = error;
          if (attempt === 0) {
            await new Promise(resolve => setTimeout(resolve, TRANSIENT_RETRY_DELAY_MS));
          }
        }
      }

      if (lastInvokeError) {
        throw lastInvokeError;
      }

      if (import.meta.env.DEV) {
        console.log(`📨 [Q${qId}] Backend response status:`, response.status);
      }

      if (response?.status && response.status !== 200) {
        throw new Error(response?.data?.error || 'Validation failed');
      }

      const result = response?.data;
      const statusMap = {
        complete: 'green',
        needs_work: 'yellow',
        incomplete: 'red'
      };

      if (!result || !statusMap[result.status]) {
        throw new Error('Validation returned an invalid response');
      }

      if (import.meta.env.DEV) {
        console.log(`✅ [Q${qId}] Validation status:`, result?.status);
      }

      setValidationState({
        status: statusMap[result.status],
        message: result.message || '',
        charCount: result.characterCount ?? text.length,
        expectedRange: result.expectedRange || null
      });

      lastValidatedValueRef.current = text;
      return result;

    } catch (error) {
      console.error(`❌ [Q${qId}] Validation error:`, error);
      if (import.meta.env.DEV) {
        console.error(`❌ [Q${qId}] Error details:`, {
          message: error.message,
          stack: error.stack,
          error: error
        });
      }

      // A transport/function failure must be visible. A separate error state keeps
      // the outage from being persisted as a judgment about the client's answer.
      setValidationState({
        status: 'error',
        message: VALIDATION_UNAVAILABLE_MESSAGE,
        charCount: text.length,
        expectedRange: null
      });
      return null;
    } finally {
      validationInFlightRef.current = false;
      setIsValidating(false);
    }
  }, [questionId, value]);

  return {
    ...validationState,
    isValidating,
    validateNow
  };
}
