/**
 * repairProQuestionnaireIntakeSubmission
 *
 * Diagnoses, deterministically repairs, and optionally retries failed Pro Questionnaire
 * submission payloads using the pro_submission_repair_agent when deterministic repair is
 * insufficient.
 *
 * Body:
 *   intakeId?                  — ProFormSubmissionIntake id
 *   questionnaireSessionId?    — intake.questionnaire_session_id
 *   draftId?                   — ProFormDraft id
 *   mode                       — "diagnose_only" | "repair_only" | "repair_and_retry"
 *   forceRetry?                — boolean, override alreadySubmitted guard
 *   autoRetry?                 — boolean (alias for mode=repair_and_retry)
 *
 * Admin-only.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─── Shared helpers (inlined — Base44 functions cannot import local files) ──────

const STRING_ARRAY_FIELDS = [
  'service_offerings', 'target_industries', 'pricing_packaging',
  'company_goals', 'website_objectives', 'client_challenges', 'client_outcomes'
];

const OBJECT_ARRAY_FIELDS = [
  'certifications_partnerships', 'service_guarantee_items', 'geographic_areas'
];

const SCALAR_STRING_FIELDS = [
  'service_offerings_other', 'target_industries_other', 'delivery_model',
  'delivery_model_other', 'pricing_packaging_other', 'differentiation',
  'company_goals_other', 'brand_tone', 'brand_tone_other', 'sales_process',
  'client_acquisition', 'client_acquisition_other', 'website_objectives_other',
  'client_size', 'client_challenges_other', 'client_frustrations',
  'client_outcomes_other', 'value_description', 'ideal_client', 'avoided_clients',
  'primary_cta', 'primary_cta_other', 'additional_notes', 'company_description'
];

function safeJsonParse(value) {
  if (value === null || value === undefined) return { ok: false, value: null, error: 'null_or_undefined' };
  if (typeof value === 'object') return { ok: true, value, error: null };
  if (typeof value !== 'string') return { ok: false, value: null, error: 'not_string_or_object' };

  // Direct parse first
  try {
    return { ok: true, value: JSON.parse(value), error: null };
  } catch (_) {}

  // Safe structural fixes
  let fixed = value.trim();

  // Strip markdown code fences
  fixed = fixed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  // Normalize smart quotes
  fixed = fixed.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");

  // Remove JS-style single-line comments
  fixed = fixed.replace(/\/\/[^\n]*/g, '');

  // Remove JS-style block comments
  fixed = fixed.replace(/\/\*[\s\S]*?\*\//g, '');

  // Remove trailing commas before } or ]
  fixed = fixed.replace(/,\s*([\]}])/g, '$1');

  try {
    return { ok: true, value: JSON.parse(fixed), error: null };
  } catch (err) {
    return { ok: false, value: null, error: err.message };
  }
}

function safeJsonStringify(value, fallback = '{}') {
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isFileLike(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const tag = v?.constructor?.name || '';
  if (['File', 'Blob', 'ArrayBuffer'].includes(tag)) return true;
  return (typeof v.arrayBuffer === 'function' || typeof v.stream === 'function') &&
    (typeof v.size === 'number' || typeof v.type === 'string');
}

function removeFileLike(v) {
  if (isFileLike(v)) return undefined;
  if (Array.isArray(v)) return v.map(removeFileLike).filter(x => x !== undefined);
  if (isPlainObject(v)) {
    const out = {};
    for (const [k, item] of Object.entries(v)) {
      if (typeof item === 'function') continue;
      const cleaned = removeFileLike(item);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  return v;
}

function stripUndefined(v) {
  if (Array.isArray(v)) return v.map(stripUndefined).filter(x => x !== undefined);
  if (isPlainObject(v)) {
    const out = {};
    for (const [k, item] of Object.entries(v)) {
      const cleaned = stripUndefined(item);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  return v;
}

function truncateStrings(v, max = 5000) {
  if (typeof v === 'string') return v.length > max ? v.slice(0, max) : v;
  if (Array.isArray(v)) return v.map(x => truncateStrings(x, max));
  if (isPlainObject(v)) {
    const out = {};
    for (const [k, item] of Object.entries(v)) out[k] = truncateStrings(item, max);
    return out;
  }
  return v;
}

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v === null || v === undefined || v === '') return [];
  return [v];
}

function asTrimmedString(v) {
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return v.map(x => (typeof x === 'string' ? x.trim() : '')).filter(Boolean).join(', ');
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function normalizeGeoArea(item) {
  if (!isPlainObject(item)) return null;

  // Already has geographic_area_meta
  if (isPlainObject(item.geographic_area_meta)) {
    const m = item.geographic_area_meta;
    return {
      geographic_area_meta: {
        name: asTrimmedString(m.name || m.label || ''),
        label: asTrimmedString(m.label || m.name || ''),
        lat: asTrimmedString(m.lat ?? m.latitude ?? ''),
        lon: asTrimmedString(m.lon ?? m.lng ?? m.longitude ?? ''),
        place_id: asTrimmedString(m.place_id || m.placeId || ''),
        source: asTrimmedString(m.source) || 'manual',
        primary: Boolean(m.primary)
      }
    };
  }

  // Flat location object — wrap it
  const name = asTrimmedString(item.name || item.label || item.city || '');
  const label = asTrimmedString(item.label || item.name || item.city || '');
  if (!name && !label) return null;

  return {
    geographic_area_meta: {
      name,
      label,
      lat: asTrimmedString(item.lat ?? item.latitude ?? ''),
      lon: asTrimmedString(item.lon ?? item.lng ?? item.longitude ?? ''),
      place_id: asTrimmedString(item.place_id || item.placeId || ''),
      source: asTrimmedString(item.source) || 'manual',
      primary: Boolean(item.primary)
    }
  };
}

function repairSubmissionPayloadServer(payload, context = {}) {
  const warnings = [];
  const changedPaths = [];
  const errors = [];

  const track = (path, beforeType, afterType, reason) => {
    changedPaths.push({ path, before_type: beforeType, after_type: afterType, reason });
  };

  // Deep clone via JSON (strips File/Blob/undefined/functions that survive stringify)
  let p;
  try {
    p = JSON.parse(JSON.stringify(payload ?? {}));
  } catch {
    p = {};
    warnings.push('payload_clone_failed_reset_to_empty');
  }

  // Ensure top-level object
  if (!isPlainObject(p)) {
    track('', typeof p, 'object', 'top_level_not_object');
    p = {};
  }

  // Ensure metadata
  if (!isPlainObject(p.metadata)) {
    track('metadata', typeof p.metadata, 'object', 'metadata_not_object');
    p.metadata = isPlainObject(p.metadata) ? p.metadata : {};
  }

  // Ensure userdata
  if (!isPlainObject(p.userdata)) {
    track('userdata', typeof p.userdata, 'object', 'userdata_not_object');
    p.userdata = isPlainObject(p.userdata) ? p.userdata : {};
  }

  // Metadata: business_name — only from trusted sources, never invented
  if (!p.metadata.business_name) {
    if (context.businessName && typeof context.businessName === 'string' && context.businessName.trim()) {
      track('metadata.business_name', 'missing', 'string', 'backfilled_from_context');
      p.metadata.business_name = context.businessName.trim();
    } else {
      errors.push('metadata.business_name_missing');
    }
  }

  // Metadata: businessDomain — only from trusted sources, never invented
  if (!p.metadata.businessDomain) {
    // Also try legacy key
    if (p.metadata.business_domain) {
      track('metadata.businessDomain', 'missing', 'string', 'renamed_from_business_domain');
      p.metadata.businessDomain = p.metadata.business_domain;
    } else if (context.businessDomain && typeof context.businessDomain === 'string' && context.businessDomain.trim()) {
      track('metadata.businessDomain', 'missing', 'string', 'backfilled_from_context');
      p.metadata.businessDomain = context.businessDomain.trim();
    } else {
      errors.push('metadata.businessDomain_missing');
    }
  }

  // Metadata defaults
  if (!p.metadata.service_type) {
    p.metadata.service_type = 'pro';
    track('metadata.service_type', 'missing', 'string', 'defaulted_to_pro');
  }
  if (!p.metadata.submission_datetime) {
    p.metadata.submission_datetime = new Date().toISOString();
    track('metadata.submission_datetime', 'missing', 'string', 'set_to_now');
  }

  // additional_pages_list
  if (!isPlainObject(p.userdata.additional_pages_list)) {
    track('userdata.additional_pages_list', typeof p.userdata.additional_pages_list, 'object', 'not_object');
    p.userdata.additional_pages_list = {};
  }

  // meet_the_team_page
  if (!isPlainObject(p.userdata.additional_pages_list.meet_the_team_page)) {
    track('userdata.additional_pages_list.meet_the_team_page',
      typeof p.userdata.additional_pages_list.meet_the_team_page, 'object', 'not_object');
    p.userdata.additional_pages_list.meet_the_team_page = {};
  }

  // team_photo_with_tags
  const mtp = p.userdata.additional_pages_list.meet_the_team_page;
  if (!isPlainObject(mtp.team_photo_with_tags)) {
    track('userdata.additional_pages_list.meet_the_team_page.team_photo_with_tags',
      typeof mtp.team_photo_with_tags, 'object', 'not_object');
    mtp.team_photo_with_tags = {};
  }

  // taggedPeople
  const tpt = mtp.team_photo_with_tags;
  if (tpt.taggedPeople !== undefined && !Array.isArray(tpt.taggedPeople)) {
    track('...team_photo_with_tags.taggedPeople', typeof tpt.taggedPeople, 'array', 'not_array');
    tpt.taggedPeople = asArray(tpt.taggedPeople).filter(isPlainObject);
  }

  // why_choose_us_page
  if (!isPlainObject(p.userdata.additional_pages_list.why_choose_us_page)) {
    p.userdata.additional_pages_list.why_choose_us_page =
      p.userdata.additional_pages_list.why_choose_us_page ?? {};
  }

  // String array fields
  for (const field of STRING_ARRAY_FIELDS) {
    const orig = p.userdata[field];
    if (!Array.isArray(orig)) {
      track(`userdata.${field}`, typeof orig, 'array', 'coerced_to_array');
      p.userdata[field] = orig === null || orig === undefined || orig === ''
        ? []
        : typeof orig === 'string'
          ? orig.split(',').map(s => s.trim()).filter(Boolean)
          : [String(orig)];
    } else {
      // Clean empty/null items
      p.userdata[field] = orig.filter(x => x !== null && x !== undefined && x !== '');
    }
  }

  // Object array fields
  for (const field of OBJECT_ARRAY_FIELDS) {
    const orig = p.userdata[field];
    if (field === 'geographic_areas') {
      if (!Array.isArray(orig)) {
        track(`userdata.${field}`, typeof orig, 'array', 'coerced_to_array');
        const raw = isPlainObject(orig) ? [orig] : [];
        p.userdata[field] = raw.map(normalizeGeoArea).filter(Boolean);
      } else {
        p.userdata[field] = orig.map(normalizeGeoArea).filter(Boolean);
      }
    } else {
      if (!Array.isArray(orig)) {
        track(`userdata.${field}`, typeof orig, 'array', 'coerced_to_array');
        p.userdata[field] = isPlainObject(orig) ? [orig] : [];
      } else {
        p.userdata[field] = orig.filter(isPlainObject);
      }
    }
  }

  // Scalar string fields
  for (const field of SCALAR_STRING_FIELDS) {
    const orig = p.userdata[field];
    if (orig !== undefined && typeof orig !== 'string') {
      track(`userdata.${field}`, typeof orig, 'string', 'coerced_to_string');
      p.userdata[field] = asTrimmedString(orig);
    }
  }

  // Remove file-like objects
  p = removeFileLike(p);
  p = stripUndefined(p);
  p = truncateStrings(p, 5000);

  return {
    payload: p,
    ok: errors.length === 0,
    errors,
    warnings,
    changedPaths
  };
}

function validateSubmissionPayloadServer(payload) {
  const errors = [];

  if (!isPlainObject(payload)) { return { ok: false, errors: ['payload_not_object'] }; }
  if (!isPlainObject(payload.metadata)) errors.push('metadata_not_object');
  if (!isPlainObject(payload.userdata)) errors.push('userdata_not_object');

  const meta = isPlainObject(payload.metadata) ? payload.metadata : {};
  const ud = isPlainObject(payload.userdata) ? payload.userdata : {};

  if (!String(meta.business_name || '').trim()) errors.push('metadata.business_name_missing');
  if (!String(meta.businessDomain || '').trim()) errors.push('metadata.businessDomain_missing');

  if (!isPlainObject(ud.additional_pages_list)) errors.push('userdata.additional_pages_list_not_object');

  const requiredArrays = [
    'service_offerings', 'target_industries', 'geographic_areas',
    'pricing_packaging', 'company_goals', 'certifications_partnerships',
    'service_guarantee_items', 'website_objectives', 'client_challenges', 'client_outcomes'
  ];
  for (const f of requiredArrays) {
    if (!Array.isArray(ud[f])) errors.push(`userdata.${f}_not_array`);
  }

  if (Array.isArray(ud.geographic_areas)) {
    ud.geographic_areas.forEach((item, i) => {
      if (!isPlainObject(item)) { errors.push(`geographic_areas[${i}]_not_object`); return; }
      if (!isPlainObject(item.geographic_area_meta)) errors.push(`geographic_areas[${i}].geographic_area_meta_not_object`);
    });
  }

  const mtp = isPlainObject(ud.additional_pages_list)
    ? ud.additional_pages_list.meet_the_team_page
    : undefined;

  if (!isPlainObject(mtp)) {
    errors.push('meet_the_team_page_not_object');
  } else {
    if (!isPlainObject(mtp.team_photo_with_tags)) errors.push('team_photo_with_tags_not_object');
    if (mtp.team_photo_with_tags?.taggedPeople !== undefined &&
        !Array.isArray(mtp.team_photo_with_tags?.taggedPeople)) {
      errors.push('taggedPeople_not_array');
    }
  }

  return { ok: errors.length === 0, errors };
}

function extractJsonObjectFromText(text) {
  if (typeof text !== 'string') return { ok: false, value: null, error: 'not_string' };

  // Strip markdown fences
  let clean = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  // Find first { ... } block
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return { ok: false, value: null, error: 'no_json_object_found' };
  }

  const candidate = clean.slice(start, end + 1);
  return safeJsonParse(candidate);
}

function sanitizeRepairReport(report) {
  if (!isPlainObject(report)) return {};
  return {
    decision: report.decision ?? null,
    confidence: typeof report.confidence === 'number' ? report.confidence : null,
    should_retry_submission: Boolean(report.should_retry_submission),
    diagnosis: typeof report.diagnosis === 'string' ? report.diagnosis.slice(0, 2000) : '',
    repair_summary: Array.isArray(report.repair_summary) ? report.repair_summary.slice(0, 50) : [],
    changed_paths: Array.isArray(report.changed_paths) ? report.changed_paths.slice(0, 100) : [],
    warnings: Array.isArray(report.warnings) ? report.warnings.slice(0, 100) : []
  };
}

// ─── Base44 Agent invoker (inlined) ─────────────────────────────────────────

async function invokeBase44AgentJson({ agentName, prompt, metadata = {}, timeoutMs = 50000 }) {
  const appId = Deno.env.get('BASE44_APP_ID');
  const serviceRoleKey = Deno.env.get('BASE44_SERVICE_ROLE_KEY');
  const baseUrl = 'https://base44.app/api';

  if (!appId || !serviceRoleKey) {
    return { ok: false, json: null, rawContent: null, error: 'missing_env_BASE44_APP_ID_or_SERVICE_ROLE_KEY' };
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${serviceRoleKey}`
  };

  // Create conversation
  const convRes = await fetch(`${baseUrl}/apps/${appId}/agents/conversations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ agent_name: agentName, metadata })
  });

  if (!convRes.ok) {
    return { ok: false, json: null, rawContent: null, error: `create_conversation_failed_${convRes.status}` };
  }

  const conversation = await convRes.json();
  const convId = conversation.id;

  if (!convId) {
    return { ok: false, json: null, rawContent: null, error: 'no_conversation_id' };
  }

  // Send user message
  await fetch(`${baseUrl}/apps/${appId}/agents/conversations/${convId}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ role: 'user', content: prompt })
  });

  // Poll for assistant response
  const startTime = Date.now();
  let rawContent = null;

  while (Date.now() - startTime < timeoutMs) {
    await new Promise(r => setTimeout(r, 1500));

    const pollRes = await fetch(`${baseUrl}/apps/${appId}/agents/conversations/${convId}`, {
      headers: { 'Authorization': `Bearer ${serviceRoleKey}` }
    });

    if (!pollRes.ok) continue;

    const updated = await pollRes.json();
    const messages = updated.messages || [];
    const last = messages[messages.length - 1];

    if (last?.role === 'assistant' && last.content && last.streaming === false) {
      rawContent = last.content;
      break;
    }
  }

  if (!rawContent) {
    return { ok: false, json: null, rawContent: null, error: 'agent_timeout_or_no_response' };
  }

  const extracted = extractJsonObjectFromText(rawContent);
  if (!extracted.ok) {
    return { ok: false, json: null, rawContent, error: `json_extraction_failed: ${extracted.error}` };
  }

  return { ok: true, json: extracted.value, rawContent, error: null };
}

// ─── Audit event helper ──────────────────────────────────────────────────────

async function emitDraftEvent(base44, { sessionId, eventType, businessName = '', domain = '' }) {
  try {
    await base44.asServiceRole.entities.ProFormDraftEvent.create({
      session_id: sessionId || '',
      event_type: eventType,
      business_name: businessName,
      domain,
      created_at_iso: new Date().toISOString()
    });
  } catch {
    // Non-fatal
  }
}

// ─── Agent prompt builder ────────────────────────────────────────────────────

function buildAgentPrompt({ payloadStr, rawResponsesStr, errorStr, businessName, businessDomain, sessionId }) {
  const MAX_PAYLOAD = 12000;
  const safe = (s, max) => (typeof s === 'string' && s.length > max ? s.slice(0, max) + '...[truncated]' : (s || 'null'));

  return `You are repairing a failed Pro Questionnaire submission payload. Your ONLY job is to repair JSON structure — do NOT invent or rewrite any business content.

TASK: Return a single JSON object matching the repair response contract.

BUSINESS CONTEXT (trusted):
- business_name: ${businessName || '(not available — do not invent)'}
- businessDomain: ${businessDomain || '(not available — do not invent)'}
- session_id: ${sessionId || ''}

FAILED PAYLOAD:
${safe(payloadStr, MAX_PAYLOAD)}

RAW RESPONSES (if available):
${safe(rawResponsesStr, 4000)}

PRIOR ERROR:
${safe(errorStr, 1000)}

REQUIRED PAYLOAD SHAPE:
{
  "metadata": { "business_name": string, "businessDomain": string, "submission_datetime": ISO, "service_type": "pro" },
  "userdata": {
    "additional_pages_list": object,
    "service_offerings": array,
    "target_industries": array,
    "geographic_areas": array of { geographic_area_meta: { name, label, lat, lon, place_id, source, primary } },
    "pricing_packaging": array,
    "company_goals": array,
    "certifications_partnerships": array,
    "service_guarantee_items": array,
    "website_objectives": array,
    "client_challenges": array,
    "client_outcomes": array,
    "additional_pages_list.meet_the_team_page.team_photo_with_tags": object,
    "additional_pages_list.meet_the_team_page.team_photo_with_tags.taggedPeople": array when present,
    ... all other string scalar fields remain strings
  }
}

RESPONSE CONTRACT — return ONLY this JSON, no markdown, no prose:
{
  "decision": "repair" | "no_repair_needed" | "needs_human_review" | "not_safe_to_repair",
  "confidence": 0.0,
  "should_retry_submission": false,
  "diagnosis": "...",
  "repair_summary": [],
  "changed_paths": [{ "path": "", "before_type": "", "after_type": "", "reason": "" }],
  "warnings": [],
  "repaired_payload": { ...full repaired payload... } | null
}`;
}

// ─── Increment helper ────────────────────────────────────────────────────────

function inc(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n + 1 : 1;
}

function safeErr(e) {
  return {
    message: typeof e?.message === 'string' ? e.message : 'Unknown error',
    status: e?.status ?? e?.response?.status ?? null
  };
}

// ─── Main handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ success: false, error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const intakeId = typeof body?.intakeId === 'string' ? body.intakeId.trim() : '';
    const questionnaireSessionId = typeof body?.questionnaireSessionId === 'string' ? body.questionnaireSessionId.trim() : '';
    const draftId = typeof body?.draftId === 'string' ? body.draftId.trim() : '';
    const forceRetry = Boolean(body?.forceRetry);
    const autoRetry = Boolean(body?.autoRetry);
    let mode = typeof body?.mode === 'string' ? body.mode : 'diagnose_only';
    if (autoRetry && mode === 'diagnose_only') mode = 'repair_and_retry';

    const validModes = ['diagnose_only', 'repair_only', 'repair_and_retry'];
    if (!validModes.includes(mode)) mode = 'diagnose_only';

    if (!intakeId && !questionnaireSessionId && !draftId) {
      return Response.json({ success: false, error: 'intakeId, questionnaireSessionId, or draftId is required' }, { status: 400 });
    }

    const now = () => new Date().toISOString();

    // ── DRAFT MODE ────────────────────────────────────────────────────────────
    if (draftId && !intakeId && !questionnaireSessionId) {
      const draftList = await base44.asServiceRole.entities.ProFormDraft.filter({ id: draftId });
      const draft = Array.isArray(draftList) && draftList.length > 0 ? draftList[0] : null;

      if (!draft) {
        return Response.json({ success: false, error: 'Draft not found' }, { status: 404 });
      }

      const sessionId = draft.session_id || '';
      const businessName = draft.business_name || '';
      const domain = draft.domain || '';

      // Build candidate payload
      let candidatePayload = null;
      const mappedResult = safeJsonParse(draft.mapped_payload_json);
      if (mappedResult.ok && isPlainObject(mappedResult.value)) {
        candidatePayload = mappedResult.value;
      } else {
        const metaResult = safeJsonParse(draft.metadata_json);
        const udResult = safeJsonParse(draft.userdata_json);
        candidatePayload = {
          metadata: (metaResult.ok && isPlainObject(metaResult.value)) ? metaResult.value : {},
          userdata: (udResult.ok && isPlainObject(udResult.value)) ? udResult.value : {}
        };
      }

      // Mark repair started
      await base44.asServiceRole.entities.ProFormDraft.update(draft.id, {
        ai_repair_status: 'running',
        last_ai_repair_at: now()
      });
      await emitDraftEvent(base44, { sessionId, eventType: 'ai_repair_started', businessName, domain });

      // Deterministic repair
      const detResult = repairSubmissionPayloadServer(candidatePayload, { businessName, businessDomain: domain });
      const detValidation = validateSubmissionPayloadServer(detResult.payload);

      if (detValidation.ok) {
        // Deterministic repair was sufficient
        const report = {
          decision: detResult.changedPaths.length === 0 ? 'no_repair_needed' : 'repair',
          confidence: 1.0,
          should_retry_submission: false, // drafts never create submissions
          diagnosis: 'Deterministic repair succeeded.',
          repair_summary: detResult.changedPaths.map(c => `${c.path}: ${c.reason}`),
          changed_paths: detResult.changedPaths,
          warnings: detResult.warnings
        };

        await base44.asServiceRole.entities.ProFormDraft.update(draft.id, {
          ai_repair_status: 'repair_ready',
          ai_repair_report_json: safeJsonStringify(report),
          ai_repaired_payload_json: safeJsonStringify(detResult.payload),
          last_ai_repair_at: now(),
          ai_repair_error_json: '',
          ai_repair_applied: false
        });
        await emitDraftEvent(base44, { sessionId, eventType: 'ai_repair_succeeded', businessName, domain });

        return Response.json({
          success: true,
          source: 'deterministic',
          mode,
          draftId: draft.id,
          repairedPayloadAvailable: true,
          report
        });
      }

      // Deterministic not enough — call agent
      const agentPrompt = buildAgentPrompt({
        payloadStr: safeJsonStringify(candidatePayload),
        rawResponsesStr: draft.responses_json || null,
        errorStr: draft.submit_error || null,
        businessName,
        businessDomain: domain,
        sessionId
      });

      const agentResult = await invokeBase44AgentJson({
        agentName: 'pro_submission_repair_agent',
        prompt: agentPrompt,
        metadata: { source: 'repair_function', draftId: draft.id },
        timeoutMs: 50000
      });

      if (!agentResult.ok || !isPlainObject(agentResult.json)) {
        const errorDetail = agentResult.error || 'agent_failed';
        await base44.asServiceRole.entities.ProFormDraft.update(draft.id, {
          ai_repair_status: 'failed',
          ai_repair_error_json: safeJsonStringify({ error: errorDetail }),
          last_ai_repair_at: now()
        });
        await emitDraftEvent(base44, { sessionId, eventType: 'ai_repair_failed', businessName, domain });

        return Response.json({ success: false, source: 'agent', error: errorDetail, draftId: draft.id }, { status: 422 });
      }

      const safeReport = sanitizeRepairReport(agentResult.json);
      const agentPayload = agentResult.json.repaired_payload;

      if (!isPlainObject(agentPayload) || safeReport.decision === 'not_safe_to_repair' || safeReport.decision === 'needs_human_review') {
        await base44.asServiceRole.entities.ProFormDraft.update(draft.id, {
          ai_repair_status: 'needs_human_review',
          ai_repair_report_json: safeJsonStringify(safeReport),
          ai_repair_error_json: safeJsonStringify({ decision: safeReport.decision }),
          last_ai_repair_at: now()
        });
        await emitDraftEvent(base44, { sessionId, eventType: 'ai_repair_needs_human_review', businessName, domain });

        return Response.json({
          success: false,
          source: 'agent',
          decision: safeReport.decision,
          report: safeReport,
          draftId: draft.id
        }, { status: 422 });
      }

      // Validate agent payload
      const agentRepaired = repairSubmissionPayloadServer(agentPayload, { businessName, businessDomain: domain });
      const agentValidation = validateSubmissionPayloadServer(agentRepaired.payload);

      if (!agentValidation.ok) {
        await base44.asServiceRole.entities.ProFormDraft.update(draft.id, {
          ai_repair_status: 'needs_human_review',
          ai_repair_report_json: safeJsonStringify(safeReport),
          ai_repair_error_json: safeJsonStringify({ validation_errors: agentValidation.errors }),
          last_ai_repair_at: now()
        });
        await emitDraftEvent(base44, { sessionId, eventType: 'ai_repair_needs_human_review', businessName, domain });

        return Response.json({
          success: false,
          source: 'agent',
          decision: 'needs_human_review',
          validationErrors: agentValidation.errors,
          report: safeReport,
          draftId: draft.id
        }, { status: 422 });
      }

      await base44.asServiceRole.entities.ProFormDraft.update(draft.id, {
        ai_repair_status: 'repair_ready',
        ai_repair_report_json: safeJsonStringify(safeReport),
        ai_repaired_payload_json: safeJsonStringify(agentRepaired.payload),
        last_ai_repair_at: now(),
        ai_repair_error_json: '',
        ai_repair_applied: false
      });
      await emitDraftEvent(base44, { sessionId, eventType: 'ai_repair_succeeded', businessName, domain });

      return Response.json({
        success: true,
        source: 'agent',
        mode,
        draftId: draft.id,
        repairedPayloadAvailable: true,
        report: safeReport
      });
    }

    // ── INTAKE MODE ───────────────────────────────────────────────────────────
    const intakeList = intakeId
      ? await base44.asServiceRole.entities.ProFormSubmissionIntake.filter({ id: intakeId })
      : await base44.asServiceRole.entities.ProFormSubmissionIntake.filter({ questionnaire_session_id: questionnaireSessionId });

    const intake = Array.isArray(intakeList) && intakeList.length > 0
      ? [...intakeList].sort((a, b) =>
          new Date(String(b.created_at_server || b.created_date || 0)).getTime() -
          new Date(String(a.created_at_server || a.created_date || 0)).getTime()
        )[0]
      : null;

    if (!intake) {
      return Response.json({ success: false, error: 'Intake record not found' }, { status: 404 });
    }

    const sessionId = intake.questionnaire_session_id || '';
    const businessName = intake.business_name || '';
    const businessDomain = intake.business_domain || '';

    // Guard: already submitted
    if (intake.linked_submission_id && !forceRetry) {
      return Response.json({
        success: true,
        alreadySubmitted: true,
        linkedSubmissionId: intake.linked_submission_id,
        intakeId: intake.id
      });
    }

    // Guard: submission already exists in ProFormSubmission
    if (sessionId && !forceRetry) {
      const existingList = await base44.asServiceRole.entities.ProFormSubmission.filter({
        'metadata.questionnaire_session_id': sessionId
      });
      if (Array.isArray(existingList) && existingList.length > 0) {
        const existing = existingList[0];
        await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
          status: 'retry_success',
          linked_submission_id: existing.id,
          last_retry_at: now()
        });
        return Response.json({
          success: true,
          alreadySubmitted: true,
          linkedSubmissionId: existing.id,
          intakeId: intake.id
        });
      }
    }

    // Parse stored payloads and error context
    const payloadResult = safeJsonParse(intake.transformed_payload_json);
    const rawResponsesStr = intake.raw_responses_json || null;
    const primaryErrorStr = intake.primary_error_json || null;
    const fallbackErrorStr = intake.fallback_error_json || null;
    const retryErrorStr = intake.retry_error_json || null;
    const combinedErrorStr = [primaryErrorStr, fallbackErrorStr, retryErrorStr].filter(Boolean).join(' | ').slice(0, 1000);

    const candidatePayload = payloadResult.ok && isPlainObject(payloadResult.value)
      ? payloadResult.value
      : { metadata: { business_name: businessName, businessDomain }, userdata: {} };

    // Mark repair started
    await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
      ai_repair_status: 'running',
      last_ai_repair_at: now(),
      ai_repair_attempt_count: inc(intake.ai_repair_attempt_count)
    });
    await emitDraftEvent(base44, { sessionId, eventType: 'ai_repair_started', businessName, domain: businessDomain });

    // Deterministic repair
    const detResult = repairSubmissionPayloadServer(candidatePayload, { businessName, businessDomain });
    const detValidation = validateSubmissionPayloadServer(detResult.payload);

    const detReport = {
      decision: detValidation.ok
        ? (detResult.changedPaths.length === 0 ? 'no_repair_needed' : 'repair')
        : 'needs_agent_repair',
      confidence: detValidation.ok ? 1.0 : 0.5,
      should_retry_submission: detValidation.ok && mode === 'repair_and_retry',
      diagnosis: detValidation.ok ? 'Deterministic repair succeeded.' : `Validation failed: ${detValidation.errors.join(', ')}`,
      repair_summary: detResult.changedPaths.map(c => `${c.path}: ${c.reason}`),
      changed_paths: detResult.changedPaths,
      warnings: detResult.warnings
    };

    if (detValidation.ok) {
      if (mode === 'diagnose_only') {
        await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
          ai_repair_status: 'diagnose_complete',
          ai_repair_report_json: safeJsonStringify(detReport),
          ai_repaired_payload_json: safeJsonStringify(detResult.payload),
          last_ai_repair_at: now()
        });
        return Response.json({
          success: true,
          source: 'deterministic',
          mode,
          intakeId: intake.id,
          validationOk: true,
          report: detReport
        });
      }

      if (mode === 'repair_only') {
        await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
          ai_repair_status: 'repair_ready',
          ai_repair_report_json: safeJsonStringify(detReport),
          ai_repaired_payload_json: safeJsonStringify(detResult.payload),
          last_ai_repair_at: now(),
          ai_repair_error_json: ''
        });
        await emitDraftEvent(base44, { sessionId, eventType: 'ai_repair_succeeded', businessName, domain: businessDomain });
        return Response.json({
          success: true,
          source: 'deterministic',
          mode,
          intakeId: intake.id,
          repairedPayloadAvailable: true,
          report: detReport
        });
      }

      // repair_and_retry — create submission
      try {
        const submission = await base44.asServiceRole.entities.ProFormSubmission.create(detResult.payload);
        await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
          status: 'retry_success',
          linked_submission_id: submission.id,
          last_retry_at: now(),
          ai_repair_status: 'applied',
          ai_repair_report_json: safeJsonStringify(detReport),
          ai_repaired_payload_json: safeJsonStringify(detResult.payload),
          ai_repair_applied: true,
          ai_repair_retry_attempted: true,
          ai_repair_retry_result_json: safeJsonStringify({ success: true, submissionId: submission.id }),
          ai_repair_source: 'repair_and_retry'
        });
        await emitDraftEvent(base44, { sessionId, eventType: 'ai_repair_retry_succeeded', businessName, domain: businessDomain });

        return Response.json({
          success: true,
          source: 'deterministic',
          mode,
          intakeId: intake.id,
          linkedSubmissionId: submission.id
        });
      } catch (createErr) {
        const errDetail = safeErr(createErr);
        await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
          status: 'retry_failed',
          last_retry_at: now(),
          ai_repair_status: 'retry_failed',
          ai_repair_report_json: safeJsonStringify(detReport),
          ai_repaired_payload_json: safeJsonStringify(detResult.payload),
          ai_repair_retry_attempted: true,
          ai_repair_retry_result_json: safeJsonStringify({ success: false, error: errDetail }),
          retry_error_json: safeJsonStringify(errDetail)
        });
        await emitDraftEvent(base44, { sessionId, eventType: 'ai_repair_retry_failed', businessName, domain: businessDomain });

        return Response.json({ success: false, source: 'deterministic', error: errDetail, intakeId: intake.id }, { status: 500 });
      }
    }

    // Deterministic not sufficient — call agent
    const agentPrompt = buildAgentPrompt({
      payloadStr: safeJsonStringify(candidatePayload),
      rawResponsesStr,
      errorStr: combinedErrorStr,
      businessName,
      businessDomain,
      sessionId
    });

    const agentResult = await invokeBase44AgentJson({
      agentName: 'pro_submission_repair_agent',
      prompt: agentPrompt,
      metadata: { source: 'repair_function', intakeId: intake.id },
      timeoutMs: 50000
    });

    if (!agentResult.ok || !isPlainObject(agentResult.json)) {
      const errorDetail = agentResult.error || 'agent_failed';
      await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
        ai_repair_status: 'failed',
        ai_repair_error_json: safeJsonStringify({ error: errorDetail }),
        last_ai_repair_at: now()
      });
      await emitDraftEvent(base44, { sessionId, eventType: 'ai_repair_failed', businessName, domain: businessDomain });

      return Response.json({ success: false, source: 'agent', error: errorDetail, intakeId: intake.id }, { status: 422 });
    }

    const safeReport = sanitizeRepairReport(agentResult.json);
    const agentPayload = agentResult.json.repaired_payload;

    if (!isPlainObject(agentPayload) || safeReport.decision === 'not_safe_to_repair' || safeReport.decision === 'needs_human_review') {
      await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
        ai_repair_status: 'needs_human_review',
        ai_repair_report_json: safeJsonStringify(safeReport),
        ai_repair_error_json: safeJsonStringify({ decision: safeReport.decision, validationErrors: detValidation.errors }),
        last_ai_repair_at: now()
      });
      await emitDraftEvent(base44, { sessionId, eventType: 'ai_repair_needs_human_review', businessName, domain: businessDomain });

      return Response.json({
        success: false,
        source: 'agent',
        decision: safeReport.decision,
        report: safeReport,
        intakeId: intake.id
      }, { status: 422 });
    }

    // Validate agent output
    const agentRepaired = repairSubmissionPayloadServer(agentPayload, { businessName, businessDomain });
    const agentValidation = validateSubmissionPayloadServer(agentRepaired.payload);

    if (!agentValidation.ok) {
      await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
        ai_repair_status: 'needs_human_review',
        ai_repair_report_json: safeJsonStringify(safeReport),
        ai_repair_error_json: safeJsonStringify({ validation_errors: agentValidation.errors }),
        last_ai_repair_at: now()
      });
      await emitDraftEvent(base44, { sessionId, eventType: 'ai_repair_needs_human_review', businessName, domain: businessDomain });

      return Response.json({
        success: false,
        source: 'agent',
        decision: 'needs_human_review',
        validationErrors: agentValidation.errors,
        report: safeReport,
        intakeId: intake.id
      }, { status: 422 });
    }

    // Agent repair is valid
    if (mode === 'diagnose_only') {
      await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
        ai_repair_status: 'diagnose_complete',
        ai_repair_report_json: safeJsonStringify(safeReport),
        ai_repaired_payload_json: safeJsonStringify(agentRepaired.payload),
        last_ai_repair_at: now()
      });
      await emitDraftEvent(base44, { sessionId, eventType: 'ai_repair_succeeded', businessName, domain: businessDomain });

      return Response.json({
        success: true,
        source: 'agent',
        mode,
        intakeId: intake.id,
        validationOk: true,
        report: safeReport
      });
    }

    if (mode === 'repair_only') {
      await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
        ai_repair_status: 'repair_ready',
        ai_repair_report_json: safeJsonStringify(safeReport),
        ai_repaired_payload_json: safeJsonStringify(agentRepaired.payload),
        last_ai_repair_at: now(),
        ai_repair_error_json: '',
        ai_repair_source: 'agent'
      });
      await emitDraftEvent(base44, { sessionId, eventType: 'ai_repair_succeeded', businessName, domain: businessDomain });

      return Response.json({
        success: true,
        source: 'agent',
        mode,
        intakeId: intake.id,
        repairedPayloadAvailable: true,
        report: safeReport
      });
    }

    // repair_and_retry with agent payload
    try {
      const submission = await base44.asServiceRole.entities.ProFormSubmission.create(agentRepaired.payload);
      await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
        status: 'retry_success',
        linked_submission_id: submission.id,
        last_retry_at: now(),
        ai_repair_status: 'applied',
        ai_repair_report_json: safeJsonStringify(safeReport),
        ai_repaired_payload_json: safeJsonStringify(agentRepaired.payload),
        ai_repair_applied: true,
        ai_repair_retry_attempted: true,
        ai_repair_retry_result_json: safeJsonStringify({ success: true, submissionId: submission.id }),
        ai_repair_source: 'agent'
      });
      await emitDraftEvent(base44, { sessionId, eventType: 'ai_repair_retry_succeeded', businessName, domain: businessDomain });

      return Response.json({
        success: true,
        source: 'agent',
        mode,
        intakeId: intake.id,
        linkedSubmissionId: submission.id
      });
    } catch (createErr) {
      const errDetail = safeErr(createErr);
      await base44.asServiceRole.entities.ProFormSubmissionIntake.update(intake.id, {
        status: 'retry_failed',
        last_retry_at: now(),
        ai_repair_status: 'retry_failed',
        ai_repair_report_json: safeJsonStringify(safeReport),
        ai_repaired_payload_json: safeJsonStringify(agentRepaired.payload),
        ai_repair_retry_attempted: true,
        ai_repair_retry_result_json: safeJsonStringify({ success: false, error: errDetail }),
        retry_error_json: safeJsonStringify(errDetail),
        ai_repair_source: 'agent'
      });
      await emitDraftEvent(base44, { sessionId, eventType: 'ai_repair_retry_failed', businessName, domain: businessDomain });

      return Response.json({ success: false, source: 'agent', error: errDetail, intakeId: intake.id }, { status: 500 });
    }

  } catch (err) {
    return Response.json({ success: false, error: { message: err?.message || 'Unknown error' } }, { status: 500 });
  }
});