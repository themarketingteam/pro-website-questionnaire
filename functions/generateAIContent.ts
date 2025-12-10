Deno.serve(async (req) => {
  try {
    const { userInstruction, questionContext, draftContent } = await req.json();

    console.log('🚀 [Backend] Starting AI generation...');

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
    console.log('✅ Conversation created:', conversation.id);

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

    // Stream the response
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let lastContent = '';
        const startTime = Date.now();
        const maxWaitTime = 60000;

        while (Date.now() - startTime < maxWaitTime) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          const getConvResponse = await fetch(`${baseUrl}/apps/${appId}/agents/conversations/${conversation.id}`, {
            headers: { 'Authorization': `Bearer ${serviceRoleKey}` }
          });
          const updatedConversation = await getConvResponse.json();
          const messages = updatedConversation.messages || [];
          const lastMessage = messages[messages.length - 1];

          if (lastMessage?.role === 'assistant' && lastMessage.content) {
            const content = lastMessage.content;
            
            // Send incremental update if content changed
            if (content !== lastContent) {
              lastContent = content;
              const chunk = JSON.stringify({ content, streaming: lastMessage.streaming }) + '\n';
              controller.enqueue(encoder.encode(chunk));
            }
            
            // Check if complete
            if (lastMessage.streaming === false) {
              const hasMultipleQuestions = (content.match(/\?/g) || []).length >= 2;
              const hasQuestionPrompts = /could you|can you|do you|what|how|tell me more|help me/i.test(content);
              const isShort = content.length < 500;
              const isQuestions = hasMultipleQuestions && hasQuestionPrompts && isShort;
              
              controller.enqueue(encoder.encode(JSON.stringify({ done: true, isQuestions }) + '\n'));
              controller.close();
              return;
            }
          }
        }

        controller.enqueue(encoder.encode(JSON.stringify({ error: 'Timeout' }) + '\n'));
        controller.close();
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    });

  } catch (error) {
    console.error('❌ Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});