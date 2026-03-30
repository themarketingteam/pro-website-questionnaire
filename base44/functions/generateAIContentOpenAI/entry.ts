// @ts-ignore
import OpenAI from 'https://deno.land/x/openai@v4.24.1/mod.ts';

Deno.serve(async (req) => {
  try {
    const { userInstruction, questionContext, draftContent, businessName, jsonData } = await req.json();
    console.log('🎯 Backend received request for:', businessName);

    if (!userInstruction?.trim()) {
      return Response.json({ error: 'User instruction is required' }, { status: 400 });
    }

    const openaiKey = Deno.env.get('OPENAI_KEY');
    if (!openaiKey) {
      throw new Error('Missing OPENAI_KEY');
    }

    const openai = new OpenAI({ apiKey: openaiKey });
    const assistantId = 'asst_1MaJDmCjejSYqEPqbBMURWKq';

    // Construct the prompt
    const promptContent = `Please process this intake form data for business: ${businessName || 'Unknown Business'}

Data Context:
${JSON.stringify(jsonData, null, 2)}

Current User Request: ${userInstruction}
Question Context: ${questionContext}
Current Draft Text: ${draftContent || "None"}`;

    console.log('⏳ Starting Run (Polling mode)...');

    // Create Thread & Run, and POLL until complete
    const run = await openai.beta.threads.createAndRunPoll({
      assistant_id: assistantId,
      thread: {
        messages: [{ role: "user", content: promptContent }]
      },
      pollIntervalMs: 3000
    });

    // Handle Result
    if (run.status === 'completed') {
      const messages = await openai.beta.threads.messages.list(run.thread_id);
      
      // Get the last message (the assistant's response)
      const lastMessage = messages.data[0];
      let responseText = '';

      if (lastMessage.content[0].type === 'text') {
        responseText = lastMessage.content[0].text.value;
      }

      console.log('✅ Run Completed. Response length:', responseText.length);
      
      return Response.json({ 
        content: responseText,
        done: true 
      });
    } else {
      console.error('❌ Run failed with status:', run.status);
      return Response.json({ error: `Run failed: ${run.status}` }, { status: 500 });
    }

  } catch (error) {
    console.error('❌ Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});