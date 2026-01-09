import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Verify user is authenticated
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get the payload from the request
    const payload = await req.json();
    
    console.log('📡 Received payload to forward to Zapier');
    console.log('📦 Payload size:', JSON.stringify(payload).length, 'bytes');

    // Get Zapier webhook URL from environment
    const hookID = Deno.env.get('VITE_API_HOOK_ID') || '23529934';
    const hookKey = Deno.env.get('VITE_API_HOOK_KEY') || 'uas7p60';
    const webhookUrl = `https://hooks.zapier.com/hooks/catch/${hookID}/${hookKey}/`;
    
    console.log('📡 Forwarding to Zapier webhook:', webhookUrl);

    // Forward the request to Zapier
    const zapierResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const responseText = await zapierResponse.text();
    console.log('📡 Zapier response status:', zapierResponse.status);
    console.log('📡 Zapier response body:', responseText);

    if (!zapierResponse.ok) {
      console.error('❌ Zapier webhook failed');
      return Response.json({
        success: false,
        error: 'Zapier webhook failed',
        status: zapierResponse.status,
        response: responseText,
      }, { status: zapierResponse.status });
    }

    console.log('✅ Successfully forwarded to Zapier');
    return Response.json({
      success: true,
      message: 'Data sent to Zapier successfully',
      zapierResponse: responseText,
    });

  } catch (error) {
    console.error('❌ Error in sendToZapier function:', error);
    return Response.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
});