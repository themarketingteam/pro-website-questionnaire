import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { text, questionContext } = await req.json();

    if (!text || !questionContext) {
      return Response.json({ 
        error: 'Missing required parameters' 
      }, { status: 400 });
    }

    // Use service role to create conversation (no user auth required)
    const conversation = await base44.asServiceRole.agents.createConversation({
      agent_name: 'form_qa_validator',
      metadata: {
        question: questionContext,
        timestamp: new Date().toISOString()
      }
    });

    // Add message and get validation result
    let validationResult = null;
    let responseComplete = false;

    const unsubscribe = base44.asServiceRole.agents.subscribeToConversation(
      conversation.id,
      (data) => {
        const lastMessage = data.messages[data.messages.length - 1];
        if (lastMessage?.role === 'assistant' && lastMessage.content) {
          try {
            const parsed = JSON.parse(lastMessage.content);
            if (parsed.status && parsed.message) {
              validationResult = parsed;
              responseComplete = true;
            }
          } catch (e) {
            // Not JSON yet, keep waiting
          }
        }
      }
    );

    await base44.asServiceRole.agents.addMessage(conversation, {
      role: 'user',
      content: text
    });

    // Wait for response (max 30 seconds)
    const maxWait = 30000;
    const startTime = Date.now();
    while (!responseComplete && (Date.now() - startTime) < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    unsubscribe();

    if (!validationResult) {
      return Response.json({ 
        error: 'Validation timeout or incomplete response' 
      }, { status: 500 });
    }

    return Response.json({
      status: validationResult.status,
      message: validationResult.message,
      characterCount: text.length
    });

  } catch (error) {
    console.error('Validation error:', error);
    return Response.json({ 
      error: error.message || 'Validation failed' 
    }, { status: 500 });
  }
});