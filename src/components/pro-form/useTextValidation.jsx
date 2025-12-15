import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';

export function useTextValidation(value, questionId, debounceMs = 3000) {
  const [validationState, setValidationState] = useState({
    status: 'neutral', // 'green', 'yellow', 'red', 'neutral'
    message: '',
    charCount: 0
  });
  
  const timerRef = useRef(null);
  const conversationRef = useRef(null);

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

  const validateText = async (text, qId) => {
    try {
      // Create or reuse conversation with AI validator
      if (!conversationRef.current) {
        conversationRef.current = await base44.agents.createConversation({
          agent_name: 'form_qa_validator',
          metadata: { name: `Validation for Q${qId}` }
        });
      }

      const conversation = conversationRef.current;

      // Send validation request to AI agent
      await base44.agents.addMessage(conversation, {
        role: 'user',
        content: `Validate this answer for question_${qId.replace('.', '_')}:\n\n${text}`
      });

      // Subscribe to get the AI response
      const unsubscribe = base44.agents.subscribeToConversation(conversation.id, (data) => {
        const lastMessage = data.messages[data.messages.length - 1];
        
        if (lastMessage?.role === 'assistant' && lastMessage?.content) {
          try {
            // Parse JSON response from AI
            const jsonMatch = lastMessage.content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const result = JSON.parse(jsonMatch[0]);
              
              // Map validation_status to UI status
              const statusMap = {
                'complete': 'green',
                'needs_work': 'yellow',
                'incomplete': 'red'
              };

              setValidationState({
                status: statusMap[result.validation_status] || 'neutral',
                message: result.user_message || '',
                charCount: result.char_count || text.length
              });
              
              unsubscribe();
            }
          } catch (err) {
            console.error('Failed to parse AI validation response:', err);
            // Fallback to neutral
            setValidationState({
              status: 'neutral',
              message: '',
              charCount: text.length
            });
            unsubscribe();
          }
        }
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        unsubscribe();
      }, 10000);

    } catch (error) {
      console.error('Validation error:', error);
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