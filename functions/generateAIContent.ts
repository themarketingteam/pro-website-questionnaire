Deno.serve(async (req) => {
  try {
    const { userInstruction, questionContext, draftContent } = await req.json();

    console.log('🚀 [Backend] Starting AI generation...');
    console.log('📝 [Backend] User instruction:', userInstruction);
    console.log('📄 [Backend] Draft content:', draftContent);
    console.log('❓ [Backend] Question context:', questionContext);

    if (!userInstruction?.trim()) {
      return Response.json({ error: 'User instruction is required' }, { status: 400 });
    }

    const appId = Deno.env.get('BASE44_APP_ID');
    const serviceRoleKey = Deno.env.get('BASE44_SERVICE_ROLE_KEY');
    const baseUrl = 'https://base44.app/api';

    // Create conversation using direct API call
    console.log('🔄 [Backend] Creating conversation via API...');
    const createConvResponse = await fetch(`${baseUrl}/apps/${appId}/agents/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`
      },
      body: JSON.stringify({
        agent_name: 'msp_content_strategist',
        metadata: { source: 'pro_questionnaire_backend' }
      })
    });
    
    const conversation = await createConvResponse.json();
    console.log('✅ [Backend] Conversation created:', conversation.id);

    const prompt = draftContent 
      ? `${questionContext}\n\n${userInstruction}\n\nCurrent text:\n${draftContent}`
      : `${questionContext}\n\n${userInstruction}`;

    // Send message via API
    console.log('📤 [Backend] Sending message to agent via API...');
    await fetch(`${baseUrl}/apps/${appId}/agents/conversations/${conversation.id}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`
      },
      body: JSON.stringify({
        role: 'user',
        content: prompt
      })
    });
    console.log('✅ [Backend] Message sent successfully');

    // Poll for response since websocket subscriptions don't work in backend
    console.log('🔄 [Backend] Polling for response...');
    let finalContent = '';
    let isQuestions = false;
    const startTime = Date.now();
    const maxWaitTime = 55000; // 55 seconds

    while (Date.now() - startTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 1500)); // Wait 1.5 seconds between polls
      
      // Get conversation via API
      const getConvResponse = await fetch(`${baseUrl}/apps/${appId}/agents/conversations/${conversation.id}`, {
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`
        }
      });
      const updatedConversation = await getConvResponse.json();
      const messages = updatedConversation.messages || [];
      const lastMessage = messages[messages.length - 1];
      
      console.log(`🔄 [Backend] Poll attempt - Messages count: ${messages.length}, Last message role: ${lastMessage?.role}`);

      if (lastMessage?.role === 'assistant' && lastMessage.content) {
        const content = lastMessage.content;
        console.log('🤖 [Backend] Got assistant response, length:', content.length, 'streaming:', lastMessage.streaming);
        
        // Check if streaming is complete
        if (lastMessage.streaming === false) {
          // Check if this is questions (multiple question marks, short response)
          const hasMultipleQuestions = (content.match(/\?/g) || []).length >= 2;
          const hasQuestionPrompts = /could you|can you|do you|what|how|tell me more|help me/i.test(content);
          const isShort = content.length < 500;
          isQuestions = hasMultipleQuestions && hasQuestionPrompts && isShort;
          
          finalContent = content;
          console.log('✅ [Backend] Response complete, isQuestions:', isQuestions);
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