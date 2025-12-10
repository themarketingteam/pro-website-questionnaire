import { useState, useEffect, useRef } from 'react';

export function useTextValidation(value, questionId, debounceMs = 3000) {
  const [validationState, setValidationState] = useState({
    status: 'neutral', // 'green', 'yellow', 'red', 'neutral'
    message: '',
    charCount: 0
  });
  
  const timerRef = useRef(null);

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

    // Start new timer
    timerRef.current = setTimeout(() => {
      validateText(value, questionId);
    }, debounceMs);

    // Cleanup
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [value, questionId, debounceMs]);

  const validateText = (text, qId) => {
    const charCount = text.length;
    const rules = getValidationRules(qId);

    if (!rules) {
      // No specific rules for this question
      setValidationState({
        status: 'neutral',
        message: '',
        charCount
      });
      return;
    }

    // Check for spam patterns
    const spamDetected = detectSpam(text);
    if (spamDetected) {
      setValidationState({
        status: 'red',
        message: 'Spam or repetitive content detected. Please provide genuine information.',
        charCount
      });
      return;
    }

    // Check character count thresholds
    if (charCount < rules.errorThreshold) {
      setValidationState({
        status: 'red',
        message: `Too short. Minimum ${rules.errorThreshold} characters required.`,
        charCount
      });
    } else if (charCount < rules.warningThreshold) {
      setValidationState({
        status: 'yellow',
        message: `Consider expanding. Aim for at least ${rules.warningThreshold} characters for best results.`,
        charCount
      });
    } else {
      setValidationState({
        status: 'green',
        message: 'Looking good!',
        charCount
      });
    }
  };

  return validationState;
}

function getValidationRules(questionId) {
  // Define rules based on Form QA Validator agent specifications
  const rulesMap = {
    '1.1': { errorThreshold: 100, warningThreshold: 200 },
    '2.1': { errorThreshold: 80, warningThreshold: 150 },
    '6': { errorThreshold: 50, warningThreshold: 100 },
    '9': { errorThreshold: 100, warningThreshold: 200 },
    '13': { errorThreshold: 50, warningThreshold: 100 },
    '14': { errorThreshold: 30, warningThreshold: 75 },
    '19': { errorThreshold: 50, warningThreshold: 100 },
    '21': { errorThreshold: 30, warningThreshold: 75 },
    '22': { errorThreshold: 50, warningThreshold: 100 },
    '23': { errorThreshold: 30, warningThreshold: 75 },
    '25': { errorThreshold: 50, warningThreshold: 100 }
  };

  return rulesMap[questionId] || null;
}

function detectSpam(text) {
  // Check for excessive repetition of characters
  const charRepeatPattern = /(.)\1{10,}/;
  if (charRepeatPattern.test(text)) return true;

  // Check for excessive repetition of words
  const words = text.toLowerCase().split(/\s+/);
  const wordCounts = {};
  for (const word of words) {
    if (word.length > 3) {
      wordCounts[word] = (wordCounts[word] || 0) + 1;
      if (wordCounts[word] > 5) return true;
    }
  }

  // Check for keyboard mashing patterns
  const mashPatterns = [
    /asdf/gi,
    /qwer/gi,
    /zxcv/gi,
    /1234/gi,
    /test test test/gi,
    /lorem ipsum/gi
  ];
  
  for (const pattern of mashPatterns) {
    if (pattern.test(text)) return true;
  }

  return false;
}