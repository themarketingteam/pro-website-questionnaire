import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ─── Inline helpers (no cross-file imports in Base44 Deno) ───────────────────

const isPlainObject = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
};

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

const DRAFT_RECOVERY_SECRET_NAME = 'DRAFT_RECOVERY_PASSWORD';
const DRAFT_RECOVERY_GRANT_SCOPE = 'draft-recovery';
const DRAFT_RECOVERY_GRANT_VERSION = 1;
const DRAFT_RECOVERY_GRANT_TTL_SECONDS = 7 * 24 * 60 * 60;
const draftRecoveryEncoder = new TextEncoder();

const draftRecoveryFromBase64Url = (value) => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const importDraftRecoverySigningKey = (secret) => crypto.subtle.importKey(
  'raw',
  draftRecoveryEncoder.encode(secret),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['verify']
);

const verifyDraftRecoveryGrant = async (token) => {
  if (typeof token !== 'string' || !token) return false;

  let configuredPassword = '';
  try {
    configuredPassword = Deno.env.get(DRAFT_RECOVERY_SECRET_NAME) || '';
  } catch {
    configuredPassword = '';
  }
  if (!configuredPassword) return false;

  const [encodedPayload, encodedSignature, ...extraParts] = token.split('.');
  if (!encodedPayload || !encodedSignature || extraParts.length > 0) return false;

  try {
    const signingKey = await importDraftRecoverySigningKey(configuredPassword);
    const signatureIsValid = await crypto.subtle.verify(
      'HMAC',
      signingKey,
      draftRecoveryFromBase64Url(encodedSignature),
      draftRecoveryEncoder.encode(encodedPayload)
    );
    if (!signatureIsValid) return false;

    const payload = JSON.parse(new TextDecoder().decode(draftRecoveryFromBase64Url(encodedPayload)));
    const now = Math.floor(Date.now() / 1000);
    return payload?.version === DRAFT_RECOVERY_GRANT_VERSION &&
      payload?.scope === DRAFT_RECOVERY_GRANT_SCOPE &&
      Number.isFinite(payload?.issuedAt) &&
      Number.isFinite(payload?.expiresAt) &&
      payload.issuedAt <= now + 60 &&
      payload.expiresAt > now &&
      payload.expiresAt <= payload.issuedAt + DRAFT_RECOVERY_GRANT_TTL_SECONDS;
  } catch {
    return false;
  }
};

const authorizeDraftRecoveryRequest = async (base44, body) => {
  try {
    const user = await base44.auth.me();
    if (user?.role === 'admin') return 'admin';
  } catch {
    // Public callers do not have a Base44 user session.
  }

  return await verifyDraftRecoveryGrant(body?.recoveryGrant) ? 'recovery_grant' : '';
};

// Deliver repair-and-retry payloads to the required Zapier workflow. Delivery
// failures are returned to the admin UI instead of being reported as success.
const sendToZapierSafe = async (payload) => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(ZAPIER_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      return { ok: res.ok, status: res.status };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    return { ok: false, error: error?.message || 'zapier_send_failed' };
  }
};

const isFileLike = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const tag = v?.constructor?.name || '';
  if (['File', 'Blob', 'ArrayBuffer'].includes(tag)) return true;
  const hasBinary = typeof v.arrayBuffer === 'function' || typeof v.stream === 'function';
  const hasMeta = typeof v.size === 'number' || typeof v.type === 'string';
  return hasBinary && hasMeta;
};

// Extract a human-readable string from a value, checking label/name/value/text/title for objects
const coerceToString = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map((i) => (typeof i === 'string' ? i : coerceToString(i))).filter(Boolean).join(', ');
  if (isPlainObject(v)) {
    for (const key of ['label', 'name', 'value', 'text', 'title']) {
      if (typeof v[key] === 'string' && v[key].trim()) return v[key].trim();
    }
    return '';
  }
  return '';
};

const stripFileLike = (v) => {
  if (isFileLike(v)) return undefined;
  if (Array.isArray(v)) return v.map(stripFileLike).filter((i) => i !== undefined).slice(0, 100);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, item] of Object.entries(v)) {
      if (typeof item === 'function') continue;
      const c = stripFileLike(item);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  return v;
};

const truncateStrings = (v, max = 5000) => {
  if (typeof v === 'string') return v.length > max ? v.slice(0, max) : v;
  if (Array.isArray(v)) return v.map((i) => truncateStrings(i, max));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, item] of Object.entries(v)) out[k] = truncateStrings(item, max);
    return out;
  }
  return v;
};

const stripUndefined = (v) => {
  if (Array.isArray(v)) return v.map(stripUndefined).filter((i) => i !== undefined);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const out = {};
    for (const [k, item] of Object.entries(v)) {
      const c = stripUndefined(item);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  return v === undefined ? undefined : v;
};

function safeJsonParse(value) {
  if (value === null || value === undefined) return { ok: false, value: null, error: 'null_input' };
  if (typeof value === 'object') return { ok: true, value, error: null };
  if (typeof value !== 'string') return { ok: false, value: null, error: 'non_string_input' };
  try {
    return { ok: true, value: JSON.parse(value), error: null };
  } catch {
    let fixed = value.trim()
      .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
      .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
      .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/,\s*([}\]])/g, '$1');
    try {
      return { ok: true, value: JSON.parse(fixed), error: null };
    } catch (e2) {
      return { ok: false, value: null, error: e2.message };
    }
  }
}

function extractJsonObjectFromText(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, value: null, error: 'empty_input' };
  let stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = stripped.indexOf('{');
  if (start === -1) return { ok: false, value: null, error: 'no_json_object_found' };
  let depth = 0, end = -1;
  for (let i = start; i < stripped.length; i++) {
    if (stripped[i] === '{') depth++;
    else if (stripped[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return { ok: false, value: null, error: 'unbalanced_braces' };
  return safeJsonParse(stripped.slice(start, end + 1));
}

function sanitizeRepairReport(report) {
  if (!isPlainObject(report)) return {};
  return {
    decision: typeof report.decision === 'string' ? report.decision : 'unknown',
    confidence: typeof report.confidence === 'number' ? report.confidence : 0,
    should_retry_submission: Boolean(report.should_retry_submission),
    diagnosis: typeof report.diagnosis === 'string' ? report.diagnosis.slice(0, 2000) : '',
    repair_summary: Array.isArray(report.repair_summary) ? report.repair_summary.slice(0, 50) : [],
    changed_paths: Array.isArray(report.changed_paths) ? report.changed_paths.slice(0, 100) : [],
    warnings: Array.isArray(report.warnings) ? report.warnings.slice(0, 100) : []
  };
}

const STRING_ARRAY_FIELDS = ['service_offerings','target_industries','pricing_packaging','company_goals','website_objectives','client_challenges','client_outcomes'];
const OBJECT_ARRAY_FIELDS = ['geographic_areas','certifications_partnerships','service_guarantee_items'];
const SCALAR_STRING_FIELDS = ['service_offerings_other','target_industries_other','delivery_model','delivery_model_other','pricing_packaging_other','differentiation','company_goals_other','brand_tone','brand_tone_other','sales_process','client_acquisition','client_acquisition_other','website_objectives_other','client_size','client_challenges_other','client_frustrations','client_outcomes_other','value_description','ideal_client','avoided_clients','primary_cta','primary_cta_other','additional_notes','company_description'];

// ─── FIX 1: Data-preserving deterministic repair ─────────────────────────────
// taggedPeople keyed object → Object.values (preserves people)
// geographic_areas keyed object → Object.values then normalizeGeographicArea each item
// certifications_partnerships / service_guarantee_items keyed object → Object.values (preserves items)
// scalar string fields that are objects → use label/name/value/text/title, not ""

function repairSubmissionPayloadServer(payload, context = {}) {
  const warnings = [], changedPaths = [], errors = [];
  const track = (path, bt, at, reason) => { changedPaths.push({ path, before_type: bt, after_type: at, reason }); warnings.push(`${path}: ${reason}`); };

  let p;
  try { p = JSON.parse(JSON.stringify(payload ?? {})); } catch { p = {}; warnings.push('payload_clone_failed'); }
  if (!isPlainObject(p)) { p = {}; track('root', typeof payload, 'object', 'root not plain object'); }

  if (!isPlainObject(p.metadata)) { track('metadata', typeof p.metadata, 'object', 'not plain object'); p.metadata = {}; }

  const trustedName = typeof context.businessName === 'string' ? context.businessName.trim() : '';
  const trustedDomain = typeof context.businessDomain === 'string' ? context.businessDomain.trim() : '';
  if (!p.metadata.business_name && trustedName) { track('metadata.business_name', 'missing', 'string', 'filled from trusted context'); p.metadata.business_name = trustedName; }
  if (!p.metadata.businessDomain && !p.metadata.business_domain && trustedDomain) { track('metadata.businessDomain', 'missing', 'string', 'filled from trusted context'); p.metadata.businessDomain = trustedDomain; }
  // Map business_domain → businessDomain
  if (!p.metadata.businessDomain && p.metadata.business_domain) { p.metadata.businessDomain = p.metadata.business_domain; }
  if (!p.metadata.service_type) { p.metadata.service_type = 'pro'; warnings.push('service_type defaulted to pro'); }
  if (!p.metadata.submission_datetime) { p.metadata.submission_datetime = new Date().toISOString(); warnings.push('submission_datetime set to now'); }

  if (!isPlainObject(p.userdata)) { track('userdata', typeof p.userdata, 'object', 'not plain object'); p.userdata = {}; }

  if (!isPlainObject(p.userdata.additional_pages_list)) { track('userdata.additional_pages_list', typeof p.userdata.additional_pages_list, 'object', 'not plain object'); p.userdata.additional_pages_list = {}; }
  const apl = p.userdata.additional_pages_list;
  if (!isPlainObject(apl.why_choose_us_page)) apl.why_choose_us_page = { generate_page: false, why_choose_us_description: '' };
  if (!isPlainObject(apl.meet_the_team_page)) apl.meet_the_team_page = { generate_page: false, team_introduction: '', team_photo_with_tags: {} };
  const mttp = apl.meet_the_team_page;
  if (!isPlainObject(mttp.team_photo_with_tags)) { track('...team_photo_with_tags', typeof mttp.team_photo_with_tags, 'object', 'not plain object'); mttp.team_photo_with_tags = {}; }
  const tpwt = mttp.team_photo_with_tags;

  // FIX: taggedPeople keyed object → Object.values (preserves people data)
  if (tpwt.taggedPeople !== undefined && !Array.isArray(tpwt.taggedPeople)) {
    track('...taggedPeople', typeof tpwt.taggedPeople, 'array', 'coerced to array');
    tpwt.taggedPeople = (tpwt.taggedPeople === null)
      ? []
      : (isPlainObject(tpwt.taggedPeople) ? Object.values(tpwt.taggedPeople) : []);
  }

  for (const field of STRING_ARRAY_FIELDS) {
    const orig = p.userdata[field];
    if (orig === undefined) continue;
    if (!Array.isArray(orig)) {
      track(`userdata.${field}`, typeof orig, 'array', 'coerced to array');
      if (typeof orig === 'string' && orig.trim()) {
        p.userdata[field] = [orig.trim()];
      } else if (isPlainObject(orig)) {
        // keyed object of strings → Object.values
        p.userdata[field] = Object.values(orig).filter(v => typeof v === 'string' && v.trim());
      } else {
        p.userdata[field] = [];
      }
    } else {
      p.userdata[field] = orig.filter((i) => i !== null && i !== undefined && i !== '');
    }
  }

  // FIX: object array fields — keyed objects become Object.values (preserves items)
  for (const field of OBJECT_ARRAY_FIELDS) {
    const orig = p.userdata[field];
    if (orig === undefined) continue;
    if (!Array.isArray(orig)) {
      track(`userdata.${field}`, typeof orig, 'array', 'coerced to array');
      // Keyed object (e.g. {"0": {...}, "1": {...}}) → Object.values preserving each item
      p.userdata[field] = isPlainObject(orig) ? Object.values(orig).filter(isPlainObject) : [];
    }
  }

  // Normalize geographic_areas items: may be flat objects OR already-wrapped, OR keyed object handled above
  p.userdata.geographic_areas = (p.userdata.geographic_areas || []).map((item, idx) => {
    if (!isPlainObject(item)) return null;
    if (isPlainObject(item.geographic_area_meta)) {
      const meta = item.geographic_area_meta;
      // Normalize lat/lon aliases
      if (!meta.lat && meta.latitude != null) { meta.lat = String(meta.latitude); delete meta.latitude; }
      if (!meta.lon && (meta.lng != null || meta.longitude != null)) { meta.lon = String(meta.lng ?? meta.longitude); delete meta.lng; delete meta.longitude; }
      if (!meta.place_id && meta.placeId) { meta.place_id = meta.placeId; delete meta.placeId; }
      if (!meta.source) meta.source = 'manual';
      return item;
    }
    // Flat item — wrap it
    const name = String(item.name || item.label || item.city || item.location || '').trim();
    if (!name) return null;
    track(`userdata.geographic_areas[${idx}]`, 'flat', 'wrapped', 'wrapped in geographic_area_meta');
    return {
      geographic_area_meta: {
        name,
        label: String(item.label || item.name || '').trim(),
        lat: item.latitude != null ? String(item.latitude) : (item.lat || ''),
        lon: item.longitude != null ? String(item.longitude) : (item.lon || item.lng || ''),
        place_id: String(item.place_id || item.placeId || '').trim(),
        source: String(item.source || 'manual'),
        primary: Boolean(item.primary) || idx === 0
      }
    };
  }).filter(Boolean);

  // FIX: scalar string fields — use label/name/value/text/title from objects instead of ""
  for (const field of SCALAR_STRING_FIELDS) {
    const orig = p.userdata[field];
    if (orig !== undefined && typeof orig !== 'string') {
      track(`userdata.${field}`, Array.isArray(orig) ? 'array' : typeof orig, 'string', 'coerced to string');
      p.userdata[field] = coerceToString(orig);
    }
  }

  let cleaned = stripFileLike(p);
  cleaned = truncateStrings(cleaned, 5000);
  cleaned = stripUndefined(cleaned);

  if (!String(cleaned?.metadata?.business_name || '').trim()) errors.push('metadata.business_name is required');
  if (!String(cleaned?.metadata?.businessDomain || '').trim()) errors.push('metadata.businessDomain is required');

  return { payload: cleaned, ok: errors.length === 0, errors, warnings, changedPaths };
}

function validateSubmissionPayloadServer(payload) {
  const errors = [];
  if (!isPlainObject(payload)) { errors.push('payload must be an object'); return { ok: false, errors }; }
  if (!isPlainObject(payload.metadata)) errors.push('metadata must be an object');
  if (!isPlainObject(payload.userdata)) errors.push('userdata must be an object');
  if (!String(payload?.metadata?.business_name || '').trim()) errors.push('metadata.business_name is required');
  if (!String(payload?.metadata?.businessDomain || '').trim()) errors.push('metadata.businessDomain is required');
  if (!isPlainObject(payload?.userdata?.additional_pages_list)) errors.push('userdata.additional_pages_list must be an object');
  const required = ['service_offerings','target_industries','geographic_areas','pricing_packaging','company_goals','certifications_partnerships','service_guarantee_items','website_objectives','client_challenges','client_outcomes'];
  for (const f of required) { if (!Array.isArray(payload?.userdata?.[f])) errors.push(`userdata.${f} must be an array`); }
  const geo = payload?.userdata?.geographic_areas;
  if (Array.isArray(geo)) geo.forEach((item, i) => { if (!isPlainObject(item)) { errors.push(`geographic_areas[${i}] must be an object`); return; } if (!isPlainObject(item.geographic_area_meta)) errors.push(`geographic_areas[${i}].geographic_area_meta must be an object`); });
  const tpwt = payload?.userdata?.additional_pages_list?.meet_the_team_page?.team_photo_with_tags;
  if (tpwt !== undefined && !isPlainObject(tpwt)) errors.push('team_photo_with_tags must be an object');
  if (tpwt?.taggedPeople !== undefined && !Array.isArray(tpwt.taggedPeople)) errors.push('taggedPeople must be an array when present');
  return { ok: errors.length === 0, errors };
}

// ─── Base44 Agent invocation ─────────────────────────────────────────────────

async function invokeRepairAgent(base44, prompt, timeoutMs = 50000) {
  let conversation;
  try {
    conversation = await base44.asServiceRole.agents.createConversation({
      agent_name: 'pro_submission_repair_agent',
      metadata: { source: 'repair_function' }
    });
    if (!conversation?.id) return { ok: false, json: null, rawContent: '', error: 'no_conversation_id' };
  } catch (e) { return { ok: false, json: null, rawContent: '', error: `create_conv_exception: ${e?.message}` }; }

  try {
    await base44.asServiceRole.agents.addMessage(conversation, { role: 'user', content: prompt });
  } catch (e) { return { ok: false, json: null, rawContent: '', error: `send_msg_exception: ${e?.message}` }; }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const conv = await base44.asServiceRole.agents.getConversation(conversation.id);
      const msgs = Array.isArray(conv?.messages) ? conv.messages : [];
      const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant' && last.content && last.streaming === false) {
        const extracted = extractJsonObjectFromText(last.content);
        return extracted.ok
          ? { ok: true, json: extracted.value, rawContent: last.content, error: null }
          : { ok: false, json: null, rawContent: last.content, error: `json_extraction: ${extracted.error}` };
      }
    } catch { /* continue polling */ }
  }
  return { ok: false, json: null, rawContent: '', error: 'agent_timeout' };
}

// ─── Audit event helper ───────────────────────────────────────────────────────

async function emitEvent(base44, sessionId, eventType, context = {}) {
  try {
    await base44.asServiceRole.entities.ProFormDraftEvent.create({
      session_id: sessionId || '',
      event_type: eventType,
      business_name: context.businessName || '',
      domain: context.domain || '',
      created_at_iso: new Date().toISOString()
    });
  } catch { /* audit failure must not block main flow */ }
}

// ─── FIX 2 & 3: Improved prompt builder and pipeline ─────────────────────────
// The prompt now receives the raw failed payload string (even if unparseable),
// plus all error fields so the AI can diagnose the actual failure.

function buildRepairPrompt({
  rawPayload,
  rawPayloadRawString,
  rawResponsesRawString,
  primaryErrorRawString,
  fallbackErrorRawString,
  retryErrorRawString,
  diagnosticsRawString,
  context,
  sessionId
}) {
  const schema = `Required shape: { metadata: { business_name: string, businessDomain: string, submission_datetime: string, service_type: "pro" }, userdata: { additional_pages_list: object, service_offerings: string[], target_industries: string[], geographic_areas: [{geographic_area_meta:{name,label,lat,lon,place_id,source,primary}}], pricing_packaging: string[], company_goals: string[], certifications_partnerships: object[], service_guarantee_items: object[], website_objectives: string[], client_challenges: string[], client_outcomes: string[], delivery_model: string, brand_tone: string, company_description: string, differentiation: string, sales_process: string, client_acquisition: string, client_size: string, client_frustrations: string, value_description: string, ideal_client: string, avoided_clients: string, primary_cta: string, additional_notes: string } }`;

  const lines = [
    'TASK: Repair structural and type errors in this Pro Questionnaire submission payload.',
    '',
    'STRICT CONSTRAINTS:',
    '  1. Do NOT invent business_name or businessDomain — use only the trusted values provided below.',
    '  2. Do NOT add, fabricate, or hallucinate any answer content.',
    '  3. Do NOT rewrite any text field. Preserve all client-submitted values exactly.',
    '  4. Only fix JSON structure and types (arrays vs objects, missing wrappers, wrong field names).',
    '  5. Use raw_responses only to recover submitted structure, never to invent new answers.',
    '  6. Return ONLY the strict JSON contract below — no markdown, no prose outside JSON.',
    '',
    `TRUSTED CONTEXT (do not override these):`,
    `  Business Name: ${context.businessName || '(unknown)'}`,
    `  Business Domain: ${context.businessDomain || '(unknown)'}`,
    `  Session ID: ${sessionId || '(unknown)'}`,
    '',
    `SCHEMA REFERENCE:`,
    schema,
    '',
    'FAILED PAYLOAD (this is the raw stored string — may be malformed or unparseable):',
    // FIX 2: Always include the raw string even if unparseable
    (rawPayloadRawString || '(not available)').slice(0, 8000),
  ];

  // Also include the parsed version if available
  if (rawPayload && isPlainObject(rawPayload)) {
    lines.push('', 'PARSED PAYLOAD (same data, successfully parsed):');
    lines.push(JSON.stringify(rawPayload, null, 2).slice(0, 4000));
  }

  if (rawResponsesRawString) { lines.push('', 'RAW QUESTIONNAIRE RESPONSES (use only to recover structure, not to invent answers):', rawResponsesRawString.slice(0, 2000)); }
  if (primaryErrorRawString) { lines.push('', 'PRIMARY SUBMISSION ERROR:', primaryErrorRawString.slice(0, 500)); }
  if (fallbackErrorRawString) { lines.push('', 'FALLBACK SUBMISSION ERROR:', fallbackErrorRawString.slice(0, 500)); }
  if (retryErrorRawString) { lines.push('', 'RETRY ERROR:', retryErrorRawString.slice(0, 500)); }
  if (diagnosticsRawString) { lines.push('', 'DIAGNOSTICS:', diagnosticsRawString.slice(0, 500)); }

  lines.push(
    '',
    'RESPONSE CONTRACT (return this exact JSON shape):',
    '{ "decision": "repair" | "not_safe_to_repair" | "needs_human_review", "confidence": 0.0-1.0, "should_retry_submission": bool, "diagnosis": "string", "repair_summary": ["..."], "changed_paths": [{"path":"...","before_type":"...","after_type":"...","reason":"..."}], "warnings": ["..."], "repaired_payload": { ...full repaired payload... } }',
    '',
    'Respond with ONLY the JSON object above. No markdown. No prose outside JSON.'
  );

  return lines.join('\n');
}

// ─── Core repair logic (shared between intake and draft) ─────────────────────

async function runRepairPipeline({
  base44,
  rawPayload,          // parsed payload (may be {} if parsing failed)
  rawPayloadRawString, // original stored string — always pass even if unparseable
  rawResponsesRawString,
  primaryErrorRawString,
  fallbackErrorRawString,
  retryErrorRawString,
  diagnosticsRawString,
  context,
  mode,
  sessionId,
  allowRetry
}) {
  // Step 1: Deterministic repair (uses parsed rawPayload, ok if {})
  const detResult = repairSubmissionPayloadServer(rawPayload, context);
  const detValidation = validateSubmissionPayloadServer(detResult.payload);
  const deterministicOk = detResult.ok && detValidation.ok;

  if (deterministicOk) {
    return {
      source: 'deterministic',
      ok: true,
      payload: detResult.payload,
      report: sanitizeRepairReport({
        decision: 'repair',
        confidence: 0.95,
        should_retry_submission: allowRetry && mode === 'repair_and_retry',
        diagnosis: 'Deterministic repair succeeded.',
        repair_summary: detResult.warnings,
        changed_paths: detResult.changedPaths,
        warnings: detResult.warnings
      }),
      errors: []
    };
  }

  // Step 2: Call AI agent — pass ALL context including original raw string
  const prompt = buildRepairPrompt({
    rawPayload,
    rawPayloadRawString,
    rawResponsesRawString,
    primaryErrorRawString,
    fallbackErrorRawString,
    retryErrorRawString,
    diagnosticsRawString,
    context,
    sessionId
  });

  await emitEvent(base44, sessionId, 'ai_repair_started', context);
  const agentResult = await invokeRepairAgent(base44, prompt, 50000);

  if (!agentResult.ok || !isPlainObject(agentResult.json)) {
    await emitEvent(base44, sessionId, 'ai_repair_failed', context);
    return {
      source: 'agent_failed',
      ok: false,
      payload: null,
      report: sanitizeRepairReport({ decision: 'needs_human_review', confidence: 0, should_retry_submission: false, diagnosis: `Agent failed: ${agentResult.error}`, repair_summary: [], changed_paths: [], warnings: [] }),
      errors: [agentResult.error || 'agent_failed']
    };
  }

  const agentReport = sanitizeRepairReport(agentResult.json);
  const agentRepairedPayload = isPlainObject(agentResult.json.repaired_payload) ? agentResult.json.repaired_payload : null;

  if (!agentRepairedPayload || agentReport.decision === 'not_safe_to_repair' || agentReport.decision === 'needs_human_review') {
    await emitEvent(base44, sessionId, 'ai_repair_needs_human_review', context);
    return { source: 'agent_review', ok: false, payload: null, report: agentReport, errors: ['agent_returned_needs_human_review'] };
  }

  // Validate agent output deterministically
  const agentDetResult = repairSubmissionPayloadServer(agentRepairedPayload, context);
  const agentValidation = validateSubmissionPayloadServer(agentDetResult.payload);

  if (!agentDetResult.ok || !agentValidation.ok) {
    await emitEvent(base44, sessionId, 'ai_repair_needs_human_review', context);
    return {
      source: 'agent_invalid',
      ok: false,
      payload: null,
      report: { ...agentReport, warnings: [...agentReport.warnings, ...agentDetResult.errors, ...agentValidation.errors] },
      errors: [...agentDetResult.errors, ...agentValidation.errors]
    };
  }

  await emitEvent(base44, sessionId, 'ai_repair_succeeded', context);
  return {
    source: 'agent',
    ok: true,
    payload: agentDetResult.payload,
    report: { ...agentReport, decision: 'repair', should_retry_submission: allowRetry && mode === 'repair_and_retry' },
    errors: []
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

// eslint-disable-next-line no-undef
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const authorizationMode = await authorizeDraftRecoveryRequest(base44, body);

    if (!authorizationMode) {
      console.warn('AI repair rejected: missing admin session or valid recovery grant');
      return Response.json({
        success: false,
        error: { message: 'Forbidden: Admin session or valid draft recovery access is required' }
      }, { status: 403 });
    }
    console.info('AI repair authorized', { authorizationMode });
    const intakeId = typeof body?.intakeId === 'string' ? body.intakeId : '';
    const questionnaireSessionId = typeof body?.questionnaireSessionId === 'string' ? body.questionnaireSessionId : '';
    const draftId = typeof body?.draftId === 'string' ? body.draftId : '';
    const mode = ['diagnose_only', 'repair_only', 'repair_and_retry'].includes(body?.mode) ? body.mode : 'diagnose_only';
    const forceRetry = Boolean(body?.forceRetry);

    if (!intakeId && !questionnaireSessionId && !draftId) {
      return Response.json({ success: false, error: { message: 'intakeId, questionnaireSessionId, or draftId is required' } }, { status: 400 });
    }

    const now = new Date().toISOString();

    // ── DRAFT MODE (never creates ProFormSubmission) ───────────────────────────
    if (draftId && !intakeId && !questionnaireSessionId) {
      const draftList = await base44.asServiceRole.entities.ProFormDraft.filter({ id: draftId });
      const draft = Array.isArray(draftList) && draftList.length > 0 ? draftList[0] : null;
      if (!draft) return Response.json({ success: false, error: { message: 'Draft not found' } }, { status: 404 });

      if (mode === 'repair_and_retry' && draft.final_submission_id && !forceRetry) {
        return Response.json({
          success: false,
          alreadySubmitted: true,
          draftMode: true,
          submissionCreated: false,
          linkedSubmissionId: draft.final_submission_id,
          error: {
            message: 'This draft already has a final submission. AI Repair + Retry was not run. Use Retry Submission only when the existing payload must be delivered again.'
          }
        }, { status: 409 });
      }

      // Build candidate payload
      let rawPayload = null;
      let rawPayloadRawString = draft.mapped_payload_json || '';
      const mappedParsed = safeJsonParse(draft.mapped_payload_json);
      if (mappedParsed.ok && isPlainObject(mappedParsed.value)) {
        rawPayload = mappedParsed.value;
      } else {
        const metaParsed = safeJsonParse(draft.metadata_json);
        const udParsed = safeJsonParse(draft.userdata_json);
        rawPayload = {
          metadata: isPlainObject(metaParsed.value) ? metaParsed.value : {},
          userdata: isPlainObject(udParsed.value) ? udParsed.value : {}
        };
        rawPayloadRawString = rawPayloadRawString || (draft.metadata_json || '') + '\n' + (draft.userdata_json || '');
      }

      const context = { businessName: draft.business_name, businessDomain: draft.domain };
      const repairResult = await runRepairPipeline({
        base44,
        rawPayload,
        rawPayloadRawString,
        rawResponsesRawString: draft.responses_json || '',
        context,
        mode,
        sessionId: draft.session_id,
        allowRetry: false
      });

      const updateData = {
        ai_repair_status: repairResult.ok ? 'completed' : 'needs_human_review',
        last_ai_repair_at: now,
        ai_repair_report_json: JSON.stringify(repairResult.report),
        ai_repaired_payload_json: repairResult.payload ? JSON.stringify(repairResult.payload) : '',
        ai_repair_error_json: repairResult.ok ? '' : JSON.stringify(repairResult.errors)
      };
      await base44.asServiceRole.entities.ProFormDraft.update(draft.id, updateData);

      // Never retry with the original payload when repair fails or times out. A
      // retry is safe only when the repair pipeline produced a validated payload.
      let zapierSent = false;
      let zapierResult = null;
      if (mode === 'repair_and_retry') {
        if (!repairResult.ok || !repairResult.payload) {
          return Response.json({
            success: false,
            draftMode: true,
            submissionCreated: false,
            repairSource: repairResult.source,
            repairOk: false,
            zapierSent: false,
            report: repairResult.report,
            hasRepairedPayload: false,
            errors: repairResult.errors,
            error: {
              message: 'AI repair did not produce a validated payload. Nothing was retried and the draft remains available for review.'
            }
          }, { status: 422 });
        }

        zapierResult = await sendToZapierSafe(repairResult.payload);
        zapierSent = zapierResult.ok;
      }

      if (mode === 'repair_and_retry' && !zapierSent) {
        const detail = zapierResult?.error || (zapierResult?.status ? `HTTP ${zapierResult.status}` : 'no submission payload was available');
        return Response.json({
          success: false,
          draftMode: true,
          submissionCreated: false,
          repairSource: repairResult.source,
          repairOk: repairResult.ok,
          zapierSent: false,
          zapierStatus: zapierResult?.status ?? null,
          zapierEndpoint: ZAPIER_WEBHOOK_URL,
          error: { message: `Zapier delivery failed: ${detail}` },
          report: repairResult.report,
          hasRepairedPayload: Boolean(repairResult.payload),
          errors: repairResult.errors
        });
      }

      return Response.json({
        success: true,
        draftMode: true,
        submissionCreated: false,
        repairSource: repairResult.source,
        repairOk: repairResult.ok,
        zapierSent,
        zapierEndpoint: mode === 'repair_and_retry' ? ZAPIER_WEBHOOK_URL : undefined,
        report: repairResult.report,
        hasRepairedPayload: Boolean(repairResult.payload),
        errors: repairResult.errors
      });
    }

    // ── INTAKE MODE ───────────────────────────────────────────────────────────
    const intakeList = intakeId
      ? await base44.asServiceRole.entities.ProFormSubmissionIntake.filter({ id: intakeId })
      : await base44.asServiceRole.entities.ProFormSubmissionIntake.filter({ questionnaire_session_id: questionnaireSessionId });

    const intake = Array.isArray(intakeList) && intakeList.length > 0
      ? [...intakeList].sort((a, b) => new Date(b.created_at_server || b.created_date || 0).getTime() - new Date(a.created_at_server || a.created_date || 0).getTime())[0]
      : null;

    if (!intake) return Response.json({ success: false, error: { message: 'Intake record not found' } }, { status: 404 });

    // Guard: already submitted (linked_submission_id set)
    if (intake.linked_submission_id && !forceRetry) {
      const earlyParsed = safeJsonParse(intake.transformed_payload_json);
      const earlyPayload = earlyParsed.ok && isPlainObject(earlyParsed.value) ? earlyParsed.value : null;
      const zapierResult = earlyPayload ? await sendToZapierSafe(earlyPayload) : { ok: false, error: 'no submission payload was available' };
      if (!zapierResult.ok) {
        const detail = zapierResult.error || (zapierResult.status ? `HTTP ${zapierResult.status}` : 'unknown error');
        return Response.json({
          success: false,
          alreadySubmitted: true,
          linkedSubmissionId: intake.linked_submission_id,
          intakeId: intake.id,
          zapierSent: false,
          zapierStatus: zapierResult.status ?? null,
          zapierEndpoint: ZAPIER_WEBHOOK_URL,
          error: { message: `Zapier delivery failed: ${detail}` }
        });
      }
      return Response.json({
        success: true,
        alreadySubmitted: true,
        linkedSubmissionId: intake.linked_submission_id,
        intakeId: intake.id,
        zapierSent: true,
        zapierStatus: zapierResult.status,
        zapierEndpoint: ZAPIER_WEBHOOK_URL
      });
    }

    // FIX 2: Keep raw string for AI prompt even if parsing fails
    const rawPayloadRawString = typeof intake.transformed_payload_json === 'string' ? intake.transformed_payload_json : '';
    const payloadParsed = safeJsonParse(intake.transformed_payload_json);
    // For deterministic repair use {} if parse fails; AI always gets the raw string
    const rawPayload = (payloadParsed.ok && isPlainObject(payloadParsed.value)) ? payloadParsed.value : {};

    const context = {
      businessName: intake.business_name || (isPlainObject(rawPayload?.metadata) ? rawPayload.metadata.business_name : ''),
      businessDomain: intake.business_domain || (isPlainObject(rawPayload?.metadata) ? rawPayload.metadata.businessDomain : '')
    };

    const repairAttemptCount = (Number(intake.ai_repair_attempt_count) || 0) + 1;
    const baseUpdate = {
      ai_repair_attempt_count: repairAttemptCount,
      last_ai_repair_at: now,
      ai_repair_source: 'admin_manual'
    };

    // diagnose_only: deterministic structure check only, no AI agent, no submission
    if (mode === 'diagnose_only') {
      const detResult = repairSubmissionPayloadServer(rawPayload, context);
      const detValidation = validateSubmissionPayloadServer(detResult.payload);
      const report = sanitizeRepairReport({
        decision: (detResult.ok && detValidation.ok) ? 'no_repair_needed' : 'needs_human_review',
        confidence: (detResult.ok && detValidation.ok) ? 0.95 : 0.5,
        should_retry_submission: false,
        diagnosis: detValidation.ok ? 'Payload is structurally valid after deterministic repair.' : `Validation errors: ${detValidation.errors.join('; ')}`,
        repair_summary: detResult.warnings,
        changed_paths: detResult.changedPaths,
        warnings: [...detResult.warnings, ...detValidation.errors]
      });
      await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
        ...baseUpdate,
        ai_repair_status: 'diagnosed',
        ai_repair_report_json: JSON.stringify(report)
      });
      return Response.json({ success: true, mode: 'diagnose_only', report, intakeId: intake.id });
    }

    // repair_only or repair_and_retry
    const repairResult = await runRepairPipeline({
      base44,
      rawPayload,
      rawPayloadRawString,
      rawResponsesRawString: intake.raw_responses_json || '',
      primaryErrorRawString: intake.primary_error_json || '',
      fallbackErrorRawString: intake.fallback_error_json || '',
      retryErrorRawString: intake.retry_error_json || '',
      diagnosticsRawString: intake.diagnostics_json || '',
      context,
      mode,
      sessionId: intake.questionnaire_session_id,
      allowRetry: mode === 'repair_and_retry'
    });

    if (!repairResult.ok) {
      await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
        ...baseUpdate,
        ai_repair_status: 'needs_human_review',
        ai_repair_report_json: JSON.stringify(repairResult.report),
        ai_repair_error_json: JSON.stringify(repairResult.errors)
      });
      await emitEvent(base44, intake.questionnaire_session_id, 'ai_repair_needs_human_review', context);
      return Response.json({ success: false, repairOk: false, report: repairResult.report, errors: repairResult.errors, intakeId: intake.id }, { status: 422 });
    }

    if (mode === 'repair_only') {
      await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
        ...baseUpdate,
        ai_repair_status: 'repair_ready',
        ai_repair_report_json: JSON.stringify(repairResult.report),
        ai_repaired_payload_json: JSON.stringify(repairResult.payload),
        ai_repair_error_json: ''
      });
      return Response.json({ success: true, mode: 'repair_only', repairSource: repairResult.source, report: repairResult.report, intakeId: intake.id });
    }

    // ── FIX 4: repair_and_retry — stronger duplicate guard ────────────────────
    // Ensure questionnaire_session_id is set on payload before create
    if (intake.questionnaire_session_id && repairResult.payload?.metadata) {
      repairResult.payload.metadata.questionnaire_session_id = intake.questionnaire_session_id;
    }

    // Check for existing submission by session ID (even if linked_submission_id not set)
    if (intake.questionnaire_session_id && !forceRetry) {
      const existingBySession = await base44.asServiceRole.entities.ProFormSubmission.filter({
        'metadata.questionnaire_session_id': intake.questionnaire_session_id
      });
      if (Array.isArray(existingBySession) && existingBySession.length > 0) {
        const existing = existingBySession[0];
        await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
          ...baseUpdate,
          status: 'retry_success',
          linked_submission_id: existing.id,
          ai_repair_status: 'retry_success',
          ai_repair_report_json: JSON.stringify(repairResult.report),
          ai_repaired_payload_json: JSON.stringify(repairResult.payload),
          ai_repair_retry_attempted: true,
          ai_repair_retry_result_json: JSON.stringify({ linkedSubmissionId: existing.id, source: 'existing_found_by_session_id' })
        });
        const zapierResult = await sendToZapierSafe(repairResult.payload);
        if (!zapierResult.ok) {
          const detail = zapierResult.error || (zapierResult.status ? `HTTP ${zapierResult.status}` : 'unknown error');
          return Response.json({
            success: false,
            alreadySubmitted: true,
            linkedSubmissionId: existing.id,
            intakeId: intake.id,
            mode: 'repair_and_retry',
            zapierSent: false,
            zapierStatus: zapierResult.status ?? null,
            zapierEndpoint: ZAPIER_WEBHOOK_URL,
            error: { message: `Zapier delivery failed: ${detail}` }
          });
        }
        return Response.json({
          success: true,
          alreadySubmitted: true,
          linkedSubmissionId: existing.id,
          intakeId: intake.id,
          mode: 'repair_and_retry',
          zapierSent: true,
          zapierStatus: zapierResult.status,
          zapierEndpoint: ZAPIER_WEBHOOK_URL
        });
      }
    }

    // Create submission exactly once
    try {
      const submission = await base44.asServiceRole.entities.ProFormSubmission.create(repairResult.payload);
      const retryResult = { linkedSubmissionId: submission.id };
      await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
        ...baseUpdate,
        ai_repair_status: 'retry_success',
        status: 'retry_success',
        linked_submission_id: submission.id,
        ai_repair_report_json: JSON.stringify(repairResult.report),
        ai_repaired_payload_json: JSON.stringify(repairResult.payload),
        ai_repair_applied: true,
        ai_repair_retry_attempted: true,
        ai_repair_retry_result_json: JSON.stringify(retryResult),
        ai_repair_error_json: '',
        last_retry_at: now,
        retry_count: (Number(intake.retry_count) || 0) + 1
      });
      const zapierResult = await sendToZapierSafe(repairResult.payload);
      if (!zapierResult.ok) {
        const detail = zapierResult.error || (zapierResult.status ? `HTTP ${zapierResult.status}` : 'unknown error');
        return Response.json({
          success: false,
          mode: 'repair_and_retry',
          linkedSubmissionId: submission.id,
          submissionCreated: true,
          repairSource: repairResult.source,
          report: repairResult.report,
          intakeId: intake.id,
          zapierSent: false,
          zapierStatus: zapierResult.status ?? null,
          zapierEndpoint: ZAPIER_WEBHOOK_URL,
          error: { message: `Submission was created, but Zapier delivery failed: ${detail}` }
        });
      }
      await emitEvent(base44, intake.questionnaire_session_id, 'ai_repair_retry_succeeded', context);
      return Response.json({
        success: true,
        mode: 'repair_and_retry',
        linkedSubmissionId: submission.id,
        repairSource: repairResult.source,
        report: repairResult.report,
        intakeId: intake.id,
        zapierSent: true,
        zapierStatus: zapierResult.status,
        zapierEndpoint: ZAPIER_WEBHOOK_URL
      });
    } catch (createErr) {
      const errObj = { message: createErr?.message || 'create_failed', status: createErr?.status || null };
      await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
        ...baseUpdate,
        ai_repair_status: 'retry_failed',
        status: 'retry_failed',
        ai_repair_report_json: JSON.stringify(repairResult.report),
        ai_repaired_payload_json: JSON.stringify(repairResult.payload),
        ai_repair_applied: false,
        ai_repair_retry_attempted: true,
        ai_repair_retry_result_json: JSON.stringify(errObj),
        ai_repair_error_json: JSON.stringify(errObj),
        retry_error_json: JSON.stringify(errObj),
        last_retry_at: now,
        retry_count: (Number(intake.retry_count) || 0) + 1
      });
      await emitEvent(base44, intake.questionnaire_session_id, 'ai_repair_retry_failed', context);
      return Response.json({ success: false, mode: 'repair_and_retry', error: errObj, report: repairResult.report, intakeId: intake.id }, { status: 500 });
    }

  } catch (err) {
    return Response.json({ success: false, error: { message: err?.message || 'internal_error' } }, { status: 500 });
  }
});
