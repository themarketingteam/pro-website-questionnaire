import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get the payload from the request body
    const payload = await req.json();

    // Get webhook credentials from environment or use defaults
    const hookID = Deno.env.get("ZAPIER_HOOK_ID") || "23529934";
    const hookKey = Deno.env.get("ZAPIER_HOOK_KEY") || "uas7p60";
    const webhookUrl = `https://hooks.zapier.com/hooks/catch/${hookID}/${hookKey}/`;

    console.log('📡 Sending to Zapier webhook:', webhookUrl);
    console.log('📦 Payload size:', JSON.stringify(payload).length, 'bytes');

    // Send to Zapier
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    console.log('📡 Zapier response status:', response.status);
    console.log('📡 Zapier response:', responseText);

    if (!response.ok) {
      console.error('❌ Zapier webhook failed:', response.status, responseText);
      return Response.json({
        success: false,
        error: `Webhook returned ${response.status}`,
        details: responseText
      }, { status: response.status });
    }

    console.log('✅ Successfully sent to Zapier');
    return Response.json({
      success: true,
      message: 'Submitted to Zapier successfully',
      zapierResponse: responseText
    });

  } catch (error) {
    console.error('❌ Error in submitToZapier:', error);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});