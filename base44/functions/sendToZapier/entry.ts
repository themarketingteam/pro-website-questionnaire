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

    // Forward the request to Zapier
    const zapierResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const responseText = await zapierResponse.text();

    if (!zapierResponse.ok) {
      console.error('Zapier webhook failed');
      
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

    return Response.json({
      success: true,
      message: 'Data sent to Zapier successfully',
      zapierResponse: responseText,
    }, { headers: corsHeaders });

  } catch (error) {
    console.error('Error in sendToZapier function:', error.message);
    
    return Response.json({
      success: false,
      error: error.message,
    }, { 
      status: 500,
      headers: corsHeaders 
    });
  }
});