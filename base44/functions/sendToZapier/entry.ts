Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  // Handle OPTIONS preflight request
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Get the payload from the request
    const payload = await req.json();
    
    console.log('📡 Received payload to forward to Zapier');
    console.log('📦 Payload size:', JSON.stringify(payload).length, 'bytes');

    const webhookUrl = Deno.env.get('ZAPIER_WEBHOOK_URL');

    if (!webhookUrl) {
      console.error('Zapier webhook is not configured');

      return Response.json(
        {
          success: false,
          error: 'Zapier webhook is not configured'
        },
        {
          status: 500,
          headers: corsHeaders
        }
      );
    }

    console.log('Forwarding payload to configured Zapier webhook');

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
      console.error('❌ Status:', zapierResponse.status);
      console.error('❌ Response:', responseText);
      
      return Response.json({
        success: false,
        error: 'Zapier webhook failed',
        zapierStatus: zapierResponse.status,
        zapierBody: responseText,
      }, { 
        status: 502,
        headers: corsHeaders 
      });
    }

    console.log('✅ Successfully forwarded to Zapier');
    return Response.json({
      success: true,
      message: 'Data sent to Zapier successfully',
      zapierResponse: responseText,
    }, { headers: corsHeaders });

  } catch (error) {
    console.error('❌ Error in sendToZapier function:', error.message);
    
    return Response.json({
      success: false,
      error: error.message,
    }, { 
      status: 500,
      headers: corsHeaders 
    });
  }
});