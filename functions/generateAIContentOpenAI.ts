Deno.serve(async (req) => {
  try {
    const { userInstruction, questionContext, draftContent, formContext } = await req.json();

    if (!userInstruction?.trim()) {
      return Response.json({ error: 'User instruction is required' }, { status: 400 });
    }

    const openaiKey = Deno.env.get('OPENAI_KEY');
    const assistantId = 'asst_1MaJDmCjejSYqEPqbBMURWKq';

    // Build the prompt with context
    let prompt = `${questionContext}\n\n${userInstruction}`;
    if (draftContent) {
      prompt += `\n\nCurrent text:\n${draftContent}`;
    }
    if (formContext) {
      prompt += `\n\nForm Context:\n${JSON.stringify(formContext, null, 2)}`;
    }

    // Create a thread
    const threadResponse = await fetch('https://api.openai.com/v1/threads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`,
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const thread = await threadResponse.json();

    // Create a run with streaming
    const runResponse = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`,
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({
        assistant_id: assistantId,
        stream: true
      })
    });

    // Stream the response
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const reader = runResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullContent = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.trim() || !line.startsWith('data: ')) continue;
              
              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                
                // Handle text deltas
                if (parsed.event === 'thread.message.delta') {
                  const delta = parsed.data.delta.content?.[0]?.text?.value;
                  if (delta) {
                    fullContent += delta;
                    controller.enqueue(encoder.encode(JSON.stringify({ 
                      content: fullContent, 
                      streaming: true 
                    }) + '\n'));
                  }
                }
                
                // Handle completion
                if (parsed.event === 'thread.run.completed') {
                  const hasMultipleQuestions = (fullContent.match(/\?/g) || []).length >= 2;
                  const hasQuestionPrompts = /could you|can you|do you|what|how|tell me more|help me/i.test(fullContent);
                  const isShort = fullContent.length < 500;
                  const isQuestions = hasMultipleQuestions && hasQuestionPrompts && isShort;
                  
                  controller.enqueue(encoder.encode(JSON.stringify({ 
                    content: fullContent,
                    streaming: false,
                    done: true,
                    isQuestions 
                  }) + '\n'));
                }
              } catch (e) {
                console.error('Parse error:', e);
              }
            }
          }
        } catch (error) {
          controller.enqueue(encoder.encode(JSON.stringify({ error: error.message }) + '\n'));
        } finally {
          controller.close();
        }
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
    console.error('Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});