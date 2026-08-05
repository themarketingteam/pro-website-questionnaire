const ZAPIER_WEBHOOK_FALLBACK_URL = 'https://hooks.zapier.com/hooks/catch/23529934/uas7p60/';

const isValidZapierWebhookUrl = (value) => {
  if (typeof value !== 'string' || !value.trim()) return false;

  try {
    const url = new URL(value.trim());
    const normalizedUrl = `${url.origin}${url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`}`;
    return normalizedUrl === ZAPIER_WEBHOOK_FALLBACK_URL &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash;
  } catch {
    return false;
  }
};

const resolveZapierWebhookUrl = () => {
  let configuredUrl = '';
  try {
    configuredUrl = Deno.env.get('ZAPIER_WEBHOOK_URL')?.trim() || '';
  } catch {
    configuredUrl = '';
  }

  if (!isValidZapierWebhookUrl(configuredUrl)) return ZAPIER_WEBHOOK_FALLBACK_URL;
  return configuredUrl.endsWith('/') ? configuredUrl : `${configuredUrl}/`;
};

const ZAPIER_WEBHOOK_URL = resolveZapierWebhookUrl();

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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    let zapierResponse;
    try {
      zapierResponse = await fetch(ZAPIER_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        console.error('Zapier delivery timed out', { zapierEndpoint: ZAPIER_WEBHOOK_URL });
        return Response.json({
          success: false,
          error: 'Zapier webhook timed out',
          zapierEndpoint: ZAPIER_WEBHOOK_URL,
        }, { status: 504, headers: corsHeaders });
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    const responseText = await zapierResponse.text();
    if (!zapierResponse.ok) {
      console.error('Zapier delivery rejected', {
        zapierEndpoint: ZAPIER_WEBHOOK_URL,
        zapierStatus: zapierResponse.status,
      });
      return Response.json({
        success: false,
        error: 'Zapier webhook failed',
        zapierStatus: zapierResponse.status,
        zapierBody: responseText,
        zapierEndpoint: ZAPIER_WEBHOOK_URL,
      }, { status: 502, headers: corsHeaders });
    }

    console.info('Zapier delivery accepted', {
      zapierEndpoint: ZAPIER_WEBHOOK_URL,
      zapierStatus: zapierResponse.status,
    });
    return Response.json({
      success: true,
      message: 'Data sent to Zapier successfully',
      zapierResponse: responseText,
      zapierEndpoint: ZAPIER_WEBHOOK_URL,
    }, { headers: corsHeaders });
  } catch (error) {
    console.error('Zapier delivery failed', {
      zapierEndpoint: ZAPIER_WEBHOOK_URL,
      error: error?.message || 'Zapier webhook request failed',
    });
    return Response.json({
      success: false,
      error: error?.message || 'Zapier webhook request failed',
      zapierEndpoint: ZAPIER_WEBHOOK_URL,
    }, { status: 500, headers: corsHeaders });
  }
});
