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

    // Question 6 specific validations
    if (qId === '6') {
      // Check for bullet points
      const bulletPattern = /^[\s]*[•\-\*][\s]+/m;
      if (bulletPattern.test(text)) {
        setValidationState({
          status: 'red',
          message: 'Please use sentences or numbered points. Bullet points are not allowed here.',
          charCount
        });
        return;
      }

      // Check for gibberish or irrelevant content
      const relevanceCheck = detectIrrelevantContent(text);
      if (relevanceCheck.isIrrelevant) {
        setValidationState({
          status: 'red',
          message: 'This doesn\'t look like a valid company description. Please try again.',
          charCount
        });
        return;
      }

      // Check max threshold
      if (charCount > rules.maxThreshold) {
        setValidationState({
          status: 'red',
          message: 'Too long. Please condense this to 1-2 sentences.',
          charCount
        });
        return;
      }

      // Check grammar issues
      if (relevanceCheck.hasGrammarIssues) {
        setValidationState({
          status: 'yellow',
          message: 'It looks like there may be some grammar issues. Please review your answer.',
          charCount
        });
        return;
      }

      // Length validations for Q6
      if (charCount < rules.errorThreshold) {
        setValidationState({
          status: 'red',
          message: 'Too short. Please write at least one full sentence.',
          charCount
        });
        return;
      }

      if (charCount >= rules.warningThreshold) {
        setValidationState({
          status: 'yellow',
          message: 'This is a bit long for a 2-sentence summary. Verify it isn\'t a paragraph.',
          charCount
        });
        return;
      }

      // Success case for Q6
      setValidationState({
        status: 'green',
        message: 'Looking good!',
        charCount
      });
      return;
    }

    // Check for spam patterns (for other questions)
    const spamDetected = detectSpam(text);
    if (spamDetected) {
      const spamMessage = qId === '2.1' 
        ? 'Please enter a valid team description.'
        : qId === '1.1'
        ? 'Please provide a detailed description without repetition.'
        : 'Spam or repetitive content detected. Please provide genuine information.';
      
      setValidationState({
        status: 'red',
        message: spamMessage,
        charCount
      });
      return;
    }

    // Check character count thresholds
    if (charCount < rules.errorThreshold) {
      const errorMessage = qId === '2.1'
        ? 'This introduction is too short. Please add at least one full sentence about your team\'s experience or focus.'
        : qId === '1.1'
        ? 'Please provide a detailed description (minimum 100 characters) without repetition.'
        : `Too short. Minimum ${rules.errorThreshold} characters required.`;
      
      setValidationState({
        status: 'red',
        message: errorMessage,
        charCount
      });
    } else if (charCount < rules.warningThreshold) {
      const warningMessage = qId === '2.1'
        ? 'This answer will work, but it\'s a bit brief. A great team intro usually highlights experience levels or certifications. Aim for 150+ characters.'
        : qId === '1.1'
        ? 'This answer is valid but short. For the best website copy, we recommend adding 2-3 specific examples of why clients choose you.'
        : `Consider expanding. Aim for at least ${rules.warningThreshold} characters for best results.`;
      
      setValidationState({
        status: 'yellow',
        message: warningMessage,
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
    '2.1': { errorThreshold: 50, warningThreshold: 150 },
    '6': { errorThreshold: 30, warningThreshold: 151, maxThreshold: 350 },
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
  // Check for excessive repetition of characters (5+ times)
  const charRepeatPattern = /(.)\1{4,}/;
  if (charRepeatPattern.test(text)) return true;

  // Check for excessive repetition of words (4+ times)
  const words = text.toLowerCase().split(/\s+/);
  const wordCounts = {};
  for (const word of words) {
    if (word.length > 2) {
      wordCounts[word] = (wordCounts[word] || 0) + 1;
      if (wordCounts[word] >= 4) return true;
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

function detectIrrelevantContent(text) {
  const trimmed = text.trim().toLowerCase();
  
  // Check for gibberish patterns
  const hasVowels = /[aeiou]/i.test(trimmed);
  const hasMultipleConsonants = (trimmed.match(/[bcdfghjklmnpqrstvwxyz]{4,}/gi) || []).length > 0;
  const isGibberish = !hasVowels || hasMultipleConsonants;
  
  // Check for completely irrelevant content
  const irrelevantPhrases = [
    'pizza', 'food', 'restaurant', 'movie', 'game', 'sport',
    'asdfjkl', 'qwerty', 'asdfgh', 'testing', 'test test'
  ];
  const containsIrrelevant = irrelevantPhrases.some(phrase => trimmed.includes(phrase));
  
  // Basic grammar check - look for severe issues
  const words = trimmed.split(/\s+/);
  const hasMultipleWords = words.length >= 3;
  const hasSentenceStructure = /[.!?]/.test(text);
  const hasGrammarIssues = hasMultipleWords && !hasSentenceStructure && text.length > 50;
  
  return {
    isIrrelevant: isGibberish || containsIrrelevant,
    hasGrammarIssues
  };
}