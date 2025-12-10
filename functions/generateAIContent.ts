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

    // Send message and poll for response
    console.log('📤 [Backend] Sending message to agent...');
    
    // First fetch the full conversation object before adding message
    const fullConversation = await base44.asServiceRole.agents.getConversation(conversation.id);
    
    await base44.asServiceRole.agents.addMessage(fullConversation, {
      role: 'user',
      content: prompt
    });

    // Poll for response since websocket subscriptions don't work in backend
    console.log('🔄 [Backend] Polling for response...');
    let finalContent = '';
    let isQuestions = false;
    const startTime = Date.now();
    const maxWaitTime = 55000; // 55 seconds

    while (Date.now() - startTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second between polls
      
      const updatedConversation = await base44.asServiceRole.agents.getConversation(conversation.id);
      const messages = updatedConversation.messages || [];
      const lastMessage = messages[messages.length - 1];

      if (lastMessage?.role === 'assistant' && lastMessage.content) {
        const content = lastMessage.content;
        console.log('🤖 [Backend] Got assistant response, length:', content.length);
        
        // Check if streaming is complete
        if (lastMessage.streaming === false) {
          // Check if this is questions (multiple question marks, short response)
          const hasMultipleQuestions = (content.match(/\?/g) || []).length >= 2;
          const hasQuestionPrompts = /could you|can you|do you|what|how|tell me more|help me/i.test(content);
          const isShort = content.length < 500;
          isQuestions = hasMultipleQuestions && hasQuestionPrompts && isShort;
          
          finalContent = content;
          console.log('✅ [Backend] Response complete');
          break;
        }
      }
    }

    if (!finalContent) {
      throw new Error('No response received from agent');
    }

    const result = { content: finalContent, isQuestions };

    console.log('🎉 [Backend] Generation complete!');
    return Response.json(result);

  } catch (error) {
    console.error('❌ [Backend] Error:', error);
    return Response.json({ 
      error: error.message || 'Failed to generate content'
    }, { status: 500 });
  }
});