Deno.serve(async (req) => {
  try {
    const { userInstruction, questionContext, draftContent, businessName, jsonData } = await req.json();

    console.log('🎯 Backend received request');
    console.log('📝 User instruction:', userInstruction);
    console.log('🏢 Business name:', businessName);

    if (!userInstruction?.trim()) {
      console.log('❌ No user instruction provided');
      return Response.json({ error: 'User instruction is required' }, { status: 400 });
    }

    const openaiKey = Deno.env.get('OPENAI_KEY');
    const assistantId = 'asst_1MaJDmCjejSYqEPqbBMURWKq';

    console.log('🔑 OpenAI Key exists:', !!openaiKey);
    console.log('🤖 Assistant ID:', assistantId);

    // Construct the single-request body
    const openaiRequestBody = {
      assistant_id: assistantId,
      thread: {
        messages: [
          {
            role: "user",
            content: `Please process this intake form data for business: ${businessName}\n\nData: ${JSON.stringify(jsonData)}\n\nUser Request: ${userInstruction}\nContext: ${questionContext}\nCurrent Draft: ${draftContent || "None"}`
          }
        ]
      },
      stream: true,
      instructions: "Process the provided intake form data and generate a comprehensive response based on the business requirements and metadata provided."
    };

    console.log('📨 Sending Create Thread & Run request to OpenAI...');

    // Call the single endpoint
    const runResponse = await fetch('https://api.openai.com/v1/threads/runs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`,
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify(openaiRequestBody)
    });

    if (!runResponse.ok) {
      const err = await runResponse.text();
      console.error('❌ OpenAI Error:', err);
      throw new Error(`OpenAI API Error: ${runResponse.statusText}`);
    }

    console.log('✅ OpenAI request successful, streaming response...');

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
                console.log('📦 Raw object keys:', Object.keys(parsed).join(', '));
                console.log('📦 Full parsed:', JSON.stringify(parsed).substring(0, 200));
                
                // Handle text deltas
                if (parsed.event === 'thread.message.delta') {
                  const delta = parsed.data?.delta?.content?.[0]?.text?.value;
                  if (delta) {
                    fullContent += delta;
                    console.log('✍️ Delta added, total length:', fullContent.length);
                    controller.enqueue(encoder.encode(JSON.stringify({ 
                      content: fullContent, 
                      streaming: true 
                    }) + '\n'));
                  }
                }
                
                // Handle completion
                if (parsed.event === 'thread.run.completed' || parsed.event === 'done') {
                  console.log('✅ Run completed, full content length:', fullContent.length);
                  
                  if (fullContent) {
                    controller.enqueue(encoder.encode(JSON.stringify({ 
                      content: fullContent,
                      streaming: false,
                      done: true
                    }) + '\n'));
                  }
                }
              } catch (e) {
                console.error('❌ Parse error:', e, 'Data:', data.substring(0, 100));
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