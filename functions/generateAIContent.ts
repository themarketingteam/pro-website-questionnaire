import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { userInstruction, questionContext, draftContent } = await req.json();

    console.log('🚀 [Backend] Starting AI generation...');
    console.log('📝 [Backend] User instruction:', userInstruction);
    console.log('📄 [Backend] Draft content:', draftContent);
    console.log('❓ [Backend] Question context:', questionContext);

    if (!userInstruction?.trim()) {
      return Response.json({ error: 'User instruction is required' }, { status: 400 });
    }

    // Create conversation using service role
    console.log('🔄 [Backend] Creating conversation with service role...');
    const conversation = await base44.asServiceRole.agents.createConversation({
      agent_name: 'msp_content_strategist',
      metadata: { source: 'pro_questionnaire_backend' }
    });
    console.log('✅ [Backend] Conversation created:', conversation.id);

    const prompt = draftContent 
      ? `${questionContext}\n\n${userInstruction}\n\nCurrent text:\n${draftContent}`
      : `${questionContext}\n\n${userInstruction}`;

    console.log('📤 [Backend] Sending prompt to agent...');

    // Subscribe and wait for response
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.error('⏱️ [Backend] Response timeout after 60s');
        reject(new Error('Response timeout'));
      }, 60000);

      let finalContent = '';
      let isQuestions = false;

      const unsubscribe = base44.asServiceRole.agents.subscribeToConversation(
        conversation.id, 
        (data) => {
          console.log('📨 [Backend] Received update');
          const messages = data.messages || [];
          const lastMessage = messages[messages.length - 1];

          if (lastMessage?.role === 'assistant') {
            const content = lastMessage.content || '';
            console.log('🤖 [Backend] Assistant content length:', content.length);
            
            // Check if this is questions (multiple question marks, short response)
            const hasMultipleQuestions = (content.match(/\?/g) || []).length >= 2;
            const hasQuestionPrompts = /could you|can you|do you|what|how|tell me more|help me/i.test(content);
            const isShort = content.length < 500;
            isQuestions = hasMultipleQuestions && hasQuestionPrompts && isShort;
            
            finalContent = content;

            if (lastMessage.streaming === false) {
              console.log('✅ [Backend] Streaming complete');
              clearTimeout(timeout);
              unsubscribe();
              resolve({ content: finalContent, isQuestions });
            }
          }
        }
      );

      // Send message
      base44.asServiceRole.agents.addMessage(conversation, {
        role: 'user',
        content: prompt
      }).catch((err) => {
        console.error('❌ [Backend] Failed to send message:', err);
        clearTimeout(timeout);
        reject(err);
      });
    });

    console.log('🎉 [Backend] Generation complete!');
    return Response.json(result);

  } catch (error) {
    console.error('❌ [Backend] Error:', error);
    return Response.json({ 
      error: error.message || 'Failed to generate content'
    }, { status: 500 });
  }
});