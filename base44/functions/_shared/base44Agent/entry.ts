/**
 * base44Agent.js
 *
 * Base44 Agent REST invocation helper.
 *
 * IMPORTANT: Base44 Deno functions cannot import from other local files at
 * runtime. This file is a shared SOURCE MODULE intended to be INLINED into
 * consuming functions at authoring time. Do not add `import` statements that
 * reference local paths here.
 *
 * Pattern mirrors: functions/generateAIContent.js
 * Env vars used:
 *   BASE44_APP_ID          — always pre-populated by the platform
 *   BASE44_SERVICE_ROLE_KEY — always pre-populated by the platform
 */

/**
 * extractJsonObjectFromText (inlined — no local imports allowed at runtime)
 *
 * Extracts and parses the first valid JSON object from an Agent response string.
 * Handles markdown code fences, leading/trailing prose, and already-pure JSON.
 */
function _extractJsonObjectFromText(text) {
  if (!text || typeof text !== 'string') {
    return { ok: false, value: null, error: 'Input must be a non-empty string' };
  }

  // Direct parse
  try {
    const v = JSON.parse(text.trim());
    if (v && typeof v === 'object' && !Array.isArray(v)) return { ok: true, value: v, error: null };
  } catch { /**/ }

  // Strip markdown code fences
  const fenceMatch = text.match(/```(?:json|javascript|js)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    try {
      const v = JSON.parse(fenceMatch[1].trim());
      if (v && typeof v === 'object' && !Array.isArray(v)) return { ok: true, value: v, error: null };
    } catch { /**/ }
  }

  // Strip trailing commas then try
  const cleaned = text.replace(/,\s*([}\]])/g, '$1');
  try {
    const v = JSON.parse(cleaned.trim());
    if (v && typeof v === 'object' && !Array.isArray(v)) return { ok: true, value: v, error: null };
  } catch { /**/ }

  // Scan for first { ... last }
  const firstBrace = text.indexOf('{');
  if (firstBrace !== -1) {
    let lastBrace = text.lastIndexOf('}');
    while (lastBrace > firstBrace) {
      try {
        const candidate = text.slice(firstBrace, lastBrace + 1);
        const v = JSON.parse(candidate);
        if (v && typeof v === 'object' && !Array.isArray(v)) return { ok: true, value: v, error: null };
      } catch { /**/ }
      lastBrace = text.lastIndexOf('}', lastBrace - 1);
    }
  }

  return { ok: false, value: null, error: 'No valid JSON object found in response text' };
}

// ---------------------------------------------------------------------------
// invokeBase44AgentJson
// ---------------------------------------------------------------------------

/**
 * Create a conversation with a Base44 Agent, send a user message,
 * poll until the assistant message is complete, extract JSON.
 *
 * @param {object} options
 * @param {string} options.agentName        — exact agent name (e.g. 'pro_submission_repair_agent')
 * @param {string} options.prompt           — full prompt string to send as user message
 * @param {object} [options.metadata]       — optional conversation metadata
 * @param {number} [options.timeoutMs]      — polling timeout in ms (default: 55000)
 *
 * @returns {Promise<{ ok: boolean, json: object|null, rawContent: string|null, error: string|null }>}
 */
export async function invokeBase44AgentJson({
  agentName,
  prompt,
  metadata = {},
  timeoutMs = 55000,
}) {
  const appId = Deno.env.get('BASE44_APP_ID');
  const serviceRoleKey = Deno.env.get('BASE44_SERVICE_ROLE_KEY');
  const baseUrl = 'https://base44.app/api';

  if (!appId || !serviceRoleKey) {
    return { ok: false, json: null, rawContent: null, error: 'Missing BASE44_APP_ID or BASE44_SERVICE_ROLE_KEY env vars' };
  }

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${serviceRoleKey}`,
  };

  // Step 1: Create conversation
  let conversation;
  try {
    const createRes = await fetch(`${baseUrl}/apps/${appId}/agents/conversations`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        agent_name: agentName,
        metadata: { source: 'pro_repair_backend', ...metadata },
      }),
    });

    if (!createRes.ok) {
      const body = await createRes.text();
      return { ok: false, json: null, rawContent: null, error: `Create conversation failed: ${createRes.status} — ${body}` };
    }

    conversation = await createRes.json();
  } catch (err) {
    return { ok: false, json: null, rawContent: null, error: `Create conversation error: ${err?.message}` };
  }

  if (!conversation?.id) {
    return { ok: false, json: null, rawContent: null, error: 'Create conversation returned no id' };
  }

  const conversationId = conversation.id;

  // Step 2: Send user message
  try {
    const msgRes = await fetch(`${baseUrl}/apps/${appId}/agents/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ role: 'user', content: prompt }),
    });

    if (!msgRes.ok) {
      const body = await msgRes.text();
      return { ok: false, json: null, rawContent: null, error: `Send message failed: ${msgRes.status} — ${body}` };
    }
  } catch (err) {
    return { ok: false, json: null, rawContent: null, error: `Send message error: ${err?.message}` };
  }

  // Step 3: Poll until assistant message is complete (streaming === false)
  const startTime = Date.now();
  const pollIntervalMs = 1500;
  let rawContent = null;

  while (Date.now() - startTime < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

    let updatedConversation;
    try {
      const getRes = await fetch(
        `${baseUrl}/apps/${appId}/agents/conversations/${conversationId}`,
        { headers: authHeaders },
      );

      if (!getRes.ok) {
        // Transient fetch error — keep polling
        continue;
      }

      updatedConversation = await getRes.json();
    } catch {
      // Network blip — keep polling
      continue;
    }

    const messages = updatedConversation?.messages ?? [];
    const lastMessage = messages[messages.length - 1];

    if (
      lastMessage?.role === 'assistant' &&
      lastMessage.content &&
      lastMessage.streaming === false
    ) {
      rawContent = lastMessage.content;
      break;
    }
  }

  if (!rawContent) {
    return {
      ok: false,
      json: null,
      rawContent: null,
      error: `Agent did not respond within ${timeoutMs}ms`,
    };
  }

  // Step 4: Extract JSON from the response
  const extracted = _extractJsonObjectFromText(rawContent);

  if (!extracted.ok) {
    return {
      ok: false,
      json: null,
      rawContent,
      error: `Agent responded but JSON extraction failed: ${extracted.error}`,
    };
  }

  return { ok: true, json: extracted.value, rawContent, error: null };
}

// ---------------------------------------------------------------------------
// Manual smoke test (run with: deno run --allow-env --allow-net functions/_shared/base44Agent.js)
// ---------------------------------------------------------------------------

if (import.meta.main) {
  console.log('base44Agent.js loaded — invokeBase44AgentJson is exported.');
  console.log('To smoke-test, invoke from a Deno environment with valid BASE44_APP_ID and BASE44_SERVICE_ROLE_KEY env vars.');

  // Test the inline JSON extractor
  const t1 = _extractJsonObjectFromText('```json\n{"decision":"repair"}\n```');
  console.log('Fence extract test:', t1.ok && t1.value.decision === 'repair' ? 'PASS' : 'FAIL');

  const t2 = _extractJsonObjectFromText('Some prose before { "a": 1, "b": 2, } and after');
  console.log('Trailing comma extract test:', t2.ok && t2.value.a === 1 ? 'PASS' : 'FAIL');

  const t3 = _extractJsonObjectFromText('not json at all');
  console.log('No JSON test:', !t3.ok ? 'PASS' : 'FAIL');
}