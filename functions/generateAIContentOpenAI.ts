Deno.serve(async (req) => {
  try {
    const { userInstruction, questionContext, draftContent, formContext } = await req.json();

    console.log('🎯 Backend received request');
    console.log('📝 User instruction:', userInstruction);
    console.log('📋 Question context:', questionContext);

    if (!userInstruction?.trim()) {
      console.log('❌ No user instruction provided');
      return Response.json({ error: 'User instruction is required' }, { status: 400 });
    }

    const openaiKey = Deno.env.get('OPENAI_KEY');
    const assistantId = 'asst_1MaJDmCjejSYqEPqbBMURWKq';

    console.log('🔑 OpenAI Key exists:', !!openaiKey);
    console.log('🤖 Assistant ID:', assistantId);

    // Build the prompt with context
    let prompt = `${questionContext}\n\n${userInstruction}`;
    if (draftContent) {
      prompt += `\n\nCurrent text:\n${draftContent}`;
    }
    if (formContext) {
      prompt += `\n\nForm Context:\n${JSON.stringify(formContext, null, 2)}`;
    }
    
    console.log('📨 Full prompt:', prompt);

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
    console.log('🧵 Thread ID:', thread.id);
    console.log('📝 Full Thread Response:', JSON.stringify(thread, null, 2));

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
    console.log('🏃 Run created for thread:', thread.id);
    console.log('🤖 Assistant ID:', assistantId);

    // Stream the response
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const reader = runResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullContent = '';

        console.log('🌊 Starting stream processing');

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              console.log('✅ Stream read complete');
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.trim() || !line.startsWith('data: ')) continue;
              
              const data = line.slice(6);
              if (data === '[DONE]') {
                console.log('✅ Received [DONE] marker');
                continue;
              }

              try {
                const parsed = JSON.parse(data);
                console.log('📦 Parsed event:', parsed.event);
                
                // Handle text deltas
                if (parsed.event === 'thread.message.delta') {
                  const delta = parsed.data.delta.content?.[0]?.text?.value;
                  if (delta) {
                    fullContent += delta;
                    console.log('📝 Content delta received, total length:', fullContent.length);
                    controller.enqueue(encoder.encode(JSON.stringify({ 
                      content: fullContent, 
                      streaming: true 
                    }) + '\n'));
                  }
                }
                
                // Handle completion
                if (parsed.event === 'thread.run.completed') {
                  console.log('✅ Run completed, full content length:', fullContent.length);
                  console.log('📄 Full content:', fullContent);
                  
                  const hasMultipleQuestions = (fullContent.match(/\?/g) || []).length >= 2;
                  const hasQuestionPrompts = /could you|can you|do you|what|how|tell me more|help me/i.test(fullContent);
                  const isShort = fullContent.length < 500;
                  const isQuestions = hasMultipleQuestions && hasQuestionPrompts && isShort;
                  
                  console.log('❓ Is questions:', isQuestions);
                  
                  controller.enqueue(encoder.encode(JSON.stringify({ 
                    content: fullContent,
                    streaming: false,
                    done: true,
                    isQuestions 
                  }) + '\n'));
                }
              } catch (e) {
                console.error('❌ Parse error:', e);
              }
            }
          }
          
          // Ensure we send a final message if nothing was sent
          if (!fullContent) {
            console.log('⚠️ No content received, sending error');
            controller.enqueue(encoder.encode(JSON.stringify({ 
              error: 'No response received from AI',
              done: true 
            }) + '\n'));
          }
          
        } catch (error) {
          console.error('❌ Stream error:', error);
          controller.enqueue(encoder.encode(JSON.stringify({ error: error.message }) + '\n'));
        } finally {
          console.log('🏁 Closing stream');
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