import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';

export function useTextValidation(value, questionId, debounceMs = 3000) {
  const [validationState, setValidationState] = useState({
    status: 'neutral', // 'green', 'yellow', 'red', 'neutral'
    message: '',
    charCount: 0,
    isValidating: false
  });
  
  const timerRef = useRef(null);
  const conversationRef = useRef(null);
  const [manualTrigger, setManualTrigger] = useState(0);

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
        charCount: 0,
        isValidating: false
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
  }, [value, questionId, debounceMs, manualTrigger]);

  const validateText = async (text, qId) => {
    setValidationState(prev => ({ ...prev, isValidating: true }));
    try {
      console.log(`🔍 Starting validation for Q${qId}`);
      
      // Create or reuse conversation with AI validator
      if (!conversationRef.current) {
        console.log('Creating new conversation with form_qa_validator agent');
        conversationRef.current = await base44.agents.createConversation({
          agent_name: 'form_qa_validator',
          metadata: { name: `Validation for Q${qId}` }
        });
        console.log('Conversation created:', conversationRef.current.id);
      }

      const conversation = conversationRef.current;

      // Subscribe BEFORE sending message
      let responseReceived = false;
      const unsubscribe = base44.agents.subscribeToConversation(conversation.id, (data) => {
        const lastMessage = data.messages[data.messages.length - 1];
        console.log('Received message update:', lastMessage?.role, lastMessage?.content?.substring(0, 100));
        
        if (lastMessage?.role === 'assistant' && lastMessage?.content && !responseReceived) {
          responseReceived = true;
          try {
            // Parse JSON response from AI
            const jsonMatch = lastMessage.content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const result = JSON.parse(jsonMatch[0]);
              console.log('Parsed validation result:', result);
              
              // Map validation_status to UI status
              const statusMap = {
                'complete': 'green',
                'needs_work': 'yellow',
                'incomplete': 'red'
              };

              setValidationState({
                status: statusMap[result.validation_status] || 'neutral',
                message: result.user_message || '',
                charCount: result.char_count || text.length,
                isValidating: false
              });
              
              unsubscribe();
            }
          } catch (err) {
            console.error('Failed to parse AI validation response:', err);
            setValidationState({
              status: 'neutral',
              message: '',
              charCount: text.length,
              isValidating: false
            });
            unsubscribe();
          }
        }
      });

      // Send validation request to AI agent
      console.log('Sending validation request for Q' + qId);
      await base44.agents.addMessage(conversation, {
        role: 'user',
        content: `Validate this answer for question_${qId.replace('.', '_')}:\n\n${text}`
      });

      // Timeout after 15 seconds
      setTimeout(() => {
        if (!responseReceived) {
          console.warn('Validation timeout - no response received');
          unsubscribe();
        }
      }, 15000);

    } catch (error) {
      console.error('Validation error:', error);
      // Fallback to neutral on error
      setValidationState({
        status: 'neutral',
        message: '',
        charCount: text.length,
        isValidating: false
      });
    }
  };

  const triggerValidation = () => {
    if (value && value.trim().length > 0) {
      setManualTrigger(prev => prev + 1);
      validateText(value, questionId);
    }
  };

  return { ...validationState, triggerValidation };
}