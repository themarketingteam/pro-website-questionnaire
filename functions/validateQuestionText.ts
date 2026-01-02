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
    let conversation = await base44.asServiceRole.agents.createConversation({
      agent_name: 'form_qa_validator',
      metadata: {
        question: questionContext,
        timestamp: new Date().toISOString()
      }
    });

    // Add message and get validation result
    let validationResult = null;
    let responseComplete = false;

    // Subscribe first
    const unsubscribe = base44.asServiceRole.agents.subscribeToConversation(
      conversation.id,
      (data) => {
        if (!data || !data.messages || data.messages.length === 0) return;
        
        const lastMessage = data.messages[data.messages.length - 1];
        if (lastMessage?.role === 'assistant' && lastMessage.content) {
          try {
            // Try to extract JSON from the response
            const jsonMatch = lastMessage.content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              if (parsed.validation_status && parsed.user_message) {
                validationResult = {
                  status: parsed.validation_status,
                  message: parsed.user_message
                };
                responseComplete = true;
              }
            }
          } catch (e) {
            // Not JSON yet, keep waiting
          }
        }
      }
    );

    // Send message after subscribing
    conversation = await base44.asServiceRole.agents.addMessage(conversation, {
      role: 'user',
      content: `Validate this answer for ${questionContext}:\n\n${text}`
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