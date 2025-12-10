Deno.serve(async (req) => {
  try {
    const { userInstruction, questionContext, draftContent } = await req.json();

    if (!userInstruction?.trim()) {
      return Response.json({ error: 'User instruction is required' }, { status: 400 });
    }

    const appId = Deno.env.get('BASE44_APP_ID');
    const serviceRoleKey = Deno.env.get('BASE44_SERVICE_ROLE_KEY');
    const baseUrl = 'https://base44.app/api';

    // Create conversation
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

    const prompt = draftContent 
      ? `${questionContext}\n\n${userInstruction}\n\nCurrent text:\n${draftContent}`
      : `${questionContext}\n\n${userInstruction}`;

    // Send message
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

    // Poll for complete response
    let finalContent = '';
    let isQuestions = false;
    const startTime = Date.now();
    const maxWaitTime = 55000;

    while (Date.now() - startTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const getConvResponse = await fetch(`${baseUrl}/apps/${appId}/agents/conversations/${conversation.id}`, {
        headers: { 'Authorization': `Bearer ${serviceRoleKey}` }
      });
      const updatedConversation = await getConvResponse.json();
      const messages = updatedConversation.messages || [];
      const lastMessage = messages[messages.length - 1];

      if (lastMessage?.role === 'assistant' && lastMessage.content && lastMessage.streaming === false) {
        const content = lastMessage.content;
        const hasMultipleQuestions = (content.match(/\?/g) || []).length >= 2;
        const hasQuestionPrompts = /could you|can you|do you|what|how|tell me more|help me/i.test(content);
        const isShort = content.length < 500;
        isQuestions = hasMultipleQuestions && hasQuestionPrompts && isShort;
        finalContent = content;
        break;
      }
    }

    if (!finalContent) {
      throw new Error('No response received from agent');
    }

    return Response.json({ content: finalContent, isQuestions });

  } catch (error) {
    console.error('❌ Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});