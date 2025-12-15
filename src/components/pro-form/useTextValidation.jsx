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
      console.log(`🔍 [Q${qId}] Starting validation`);
      console.log(`📝 [Q${qId}] Text length: ${text.length} characters`);
      console.log(`📝 [Q${qId}] Text preview: "${text.substring(0, 100)}..."`);
      
      // Create or reuse conversation with AI validator
      if (!conversationRef.current) {
        console.log(`🆕 [Q${qId}] Creating new conversation with form_qa_validator agent`);
        try {
          conversationRef.current = await base44.agents.createConversation({
            agent_name: 'form_qa_validator',
            metadata: { name: `Validation for Q${qId}` }
          });
          console.log(`✅ [Q${qId}] Conversation created:`, conversationRef.current.id);
        } catch (convError) {
          console.error(`❌ [Q${qId}] Failed to create conversation:`, convError);
          throw convError;
        }
      } else {
        console.log(`♻️ [Q${qId}] Reusing existing conversation:`, conversationRef.current.id);
      }

      const conversation = conversationRef.current;
      console.log(`💬 [Q${qId}] Using conversation ID:`, conversation.id);

      // Subscribe BEFORE sending message
      let responseReceived = false;
      console.log(`📡 [Q${qId}] Subscribing to conversation updates`);
      const unsubscribe = base44.agents.subscribeToConversation(conversation.id, (data) => {
        console.log(`📨 [Q${qId}] Received conversation update, messages count:`, data.messages?.length);
        const lastMessage = data.messages[data.messages.length - 1];
        console.log(`📬 [Q${qId}] Last message role:`, lastMessage?.role);
        console.log(`📬 [Q${qId}] Last message preview:`, lastMessage?.content?.substring(0, 150));
        
        if (lastMessage?.role === 'assistant' && lastMessage?.content && !responseReceived) {
          console.log(`🤖 [Q${qId}] Assistant response received, processing...`);
          responseReceived = true;
          try {
            // Parse JSON response from AI
            const jsonMatch = lastMessage.content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              console.log(`📦 [Q${qId}] JSON found in response:`, jsonMatch[0]);
              const result = JSON.parse(jsonMatch[0]);
              console.log(`✅ [Q${qId}] Parsed validation result:`, result);
              
              // Map validation_status to UI status
              const statusMap = {
                'complete': 'green',
                'needs_work': 'yellow',
                'incomplete': 'red'
              };

              console.log(`🎨 [Q${qId}] Setting validation state:`, {
                status: statusMap[result.validation_status] || 'neutral',
                message: result.user_message,
                charCount: result.char_count
              });

              setValidationState({
                status: statusMap[result.validation_status] || 'neutral',
                message: result.user_message || '',
                charCount: result.char_count || text.length
              });
              
              console.log(`🔌 [Q${qId}] Unsubscribing from conversation`);
              unsubscribe();
            } else {
              console.warn(`⚠️ [Q${qId}] No JSON found in assistant response`);
            }
          } catch (err) {
            console.error(`❌ [Q${qId}] Failed to parse AI validation response:`, err);
            console.error(`❌ [Q${qId}] Raw content:`, lastMessage.content);
            setValidationState({
              status: 'neutral',
              message: '',
              charCount: text.length
            });
            unsubscribe();
          }
        }
      });

      console.log(`📤 [Q${qId}] Subscription established, preparing to send message`);

      // Send validation request to AI agent
      const questionKey = `question_${qId.replace('.', '_')}`;
      console.log(`📤 [Q${qId}] Sending validation request for: ${questionKey}`);
      console.log(`📤 [Q${qId}] Message content length: ${text.length} chars`);
      
      try {
        await base44.agents.addMessage(conversation, {
          role: 'user',
          content: `Validate this answer for ${questionKey}:\n\n${text}`
        });
        console.log(`✅ [Q${qId}] Message sent successfully, waiting for AI response...`);
      } catch (msgError) {
        console.error(`❌ [Q${qId}] Failed to send message:`, msgError);
        throw msgError;
      }

      // Timeout after 15 seconds
      setTimeout(() => {
        if (!responseReceived) {
          console.warn(`⏰ [Q${qId}] Validation timeout - no response received after 15 seconds`);
          unsubscribe();
        }
      }, 15000);

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