Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    let zapierResponse;

    try {
      zapierResponse = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        console.error('Zapier webhook timed out');

        return Response.json(
          {
            success: false,
            error: 'Zapier webhook timed out'
          },
          {
            status: 504,
            headers: corsHeaders
          }
        );
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

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