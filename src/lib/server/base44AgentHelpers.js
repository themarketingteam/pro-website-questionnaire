/**
 * base44AgentHelpers.js
 *
 * Canonical source for the Base44 Agent REST invocation helper.
 *
 * ─── IMPORTANT ───────────────────────────────────────────────────────────────
 * Base44 Deno functions are deployed independently and cannot import from other
 * local files at runtime. This file is the CANONICAL REFERENCE SOURCE. When
 * writing a new Deno function that needs this helper, INLINE invokeBase44AgentJson
 * directly into that function file.
 *
 * Do NOT import this file from functions/ — it will cause a deployment failure.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Pattern mirrors: functions/generateAIContent.js
 * Env vars: BASE44_APP_ID, BASE44_SERVICE_ROLE_KEY (both pre-populated by platform)
 */

import { extractJsonObjectFromText } from './proSubmissionRepairHelpers.js';

/**
 * Create a conversation with a Base44 Agent, send a user message,
 * poll until the assistant message is complete, extract JSON from the response.
 *
 * @param {object} options
 * @param {string} options.agentName   — exact agent name (e.g. 'pro_submission_repair_agent')
 * @param {string} options.prompt      — full prompt string sent as user message
 * @param {object} [options.metadata]  — optional conversation metadata
 * @param {number} [options.timeoutMs] — polling timeout ms (default 55000)
 *
 * @returns {Promise<{ ok: boolean, json: object|null, rawContent: string|null, error: string|null }>}
 */
export async function invokeBase44AgentJson({
  agentName,
  prompt,
  metadata = {},
  timeoutMs = 55000,
}) {
  // eslint-disable-next-line no-undef
  const appId = Deno.env.get('BASE44_APP_ID');
  // eslint-disable-next-line no-undef
  const serviceRoleKey = Deno.env.get('BASE44_SERVICE_ROLE_KEY');
  const baseUrl = 'https://base44.app/api';

  if (!appId || !serviceRoleKey) {
    return { ok: false, json: null, rawContent: null, error: 'Missing BASE44_APP_ID or BASE44_SERVICE_ROLE_KEY' };
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${serviceRoleKey}`,
  };

  // Step 1: Create conversation
  let conversation;
  try {
    const res = await fetch(`${baseUrl}/apps/${appId}/agents/conversations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ agent_name: agentName, metadata: { source: 'pro_repair_backend', ...metadata } }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, json: null, rawContent: null, error: `Create conversation failed ${res.status}: ${body}` };
    }
    conversation = await res.json();
  } catch (err) {
    return { ok: false, json: null, rawContent: null, error: `Create conversation error: ${err?.message}` };
  }

  if (!conversation?.id) {
    return { ok: false, json: null, rawContent: null, error: 'Create conversation returned no id' };
  }

  const conversationId = conversation.id;

  // Step 2: Send user message
  try {
    const res = await fetch(`${baseUrl}/apps/${appId}/agents/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ role: 'user', content: prompt }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, json: null, rawContent: null, error: `Send message failed ${res.status}: ${body}` };
    }
  } catch (err) {
    return { ok: false, json: null, rawContent: null, error: `Send message error: ${err?.message}` };
  }

  // Step 3: Poll until streaming === false
  const startTime = Date.now();
  let rawContent = null;

  while (Date.now() - startTime < timeoutMs) {
    await new Promise(r => setTimeout(r, 1500));
    try {
      const res = await fetch(`${baseUrl}/apps/${appId}/agents/conversations/${conversationId}`, { headers });
      if (!res.ok) continue;
      const conv = await res.json();
      const messages = conv?.messages ?? [];
      const last = messages[messages.length - 1];
      if (last?.role === 'assistant' && last.content && last.streaming === false) {
        rawContent = last.content;
        break;
      }
    } catch { continue; }
  }

  if (!rawContent) {
    return { ok: false, json: null, rawContent: null, error: `Agent did not respond within ${timeoutMs}ms` };
  }

  // Step 4: Extract JSON
  const extracted = extractJsonObjectFromText(rawContent);
  if (!extracted.ok) {
    return { ok: false, json: null, rawContent, error: `JSON extraction failed: ${extracted.error}` };
  }

  return { ok: true, json: extracted.value, rawContent, error: null };
}