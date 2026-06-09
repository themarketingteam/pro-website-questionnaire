import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ─── Inline helpers (no cross-file imports in Base44 Deno) ───────────────────

const isPlainObject = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
};

const isFileLike = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const tag = v?.constructor?.name || '';
  if (['File', 'Blob', 'ArrayBuffer'].includes(tag)) return true;
  const hasBinary = typeof v.arrayBuffer === 'function' || typeof v.stream === 'function';
  const hasMeta = typeof v.size === 'number' || typeof v.type === 'string';
  return hasBinary && hasMeta;
};

const coerceToString = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((i) => (typeof i === 'string' ? i : '')).filter(Boolean).join(', ');
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
  if (!p.metadata.businessDomain && trustedDomain) { track('metadata.businessDomain', 'missing', 'string', 'filled from trusted context'); p.metadata.businessDomain = trustedDomain; }
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
  if (tpwt.taggedPeople !== undefined && !Array.isArray(tpwt.taggedPeople)) { track('...taggedPeople', typeof tpwt.taggedPeople, 'array', 'coerced to array'); tpwt.taggedPeople = []; }

  for (const field of STRING_ARRAY_FIELDS) {
    const orig = p.userdata[field];
    if (!Array.isArray(orig)) {
      track(`userdata.${field}`, typeof orig, 'array', 'coerced to array');
      p.userdata[field] = (typeof orig === 'string' && orig.trim()) ? [orig.trim()] : [];
    } else {
      p.userdata[field] = orig.filter((i) => i !== null && i !== undefined && i !== '');
    }
  }

  for (const field of OBJECT_ARRAY_FIELDS) {
    const orig = p.userdata[field];
    if (!Array.isArray(orig)) {
      track(`userdata.${field}`, typeof orig, 'array', 'coerced to array');
      p.userdata[field] = isPlainObject(orig) ? [orig] : [];
    }
  }

  p.userdata.geographic_areas = (p.userdata.geographic_areas || []).map((item, idx) => {
    if (!isPlainObject(item)) return null;
    if (isPlainObject(item.geographic_area_meta)) {
      const meta = item.geographic_area_meta;
      if (!meta.lat && meta.latitude != null) { meta.lat = String(meta.latitude); delete meta.latitude; }
      if (!meta.lon && (meta.lng != null || meta.longitude != null)) { meta.lon = String(meta.lng ?? meta.longitude); delete meta.lng; delete meta.longitude; }
      if (!meta.place_id && meta.placeId) { meta.place_id = meta.placeId; delete meta.placeId; }
      if (!meta.source) meta.source = 'manual';
      return item;
    }
    const name = String(item.name || item.label || item.city || '').trim();
    if (!name) return null;
    track(`userdata.geographic_areas[${idx}]`, 'flat', 'wrapped', 'wrapped in geographic_area_meta');
    return { geographic_area_meta: { name, label: String(item.label || item.name || '').trim(), lat: item.latitude != null ? String(item.latitude) : (item.lat || ''), lon: item.longitude != null ? String(item.longitude) : (item.lon || item.lng || ''), place_id: String(item.place_id || item.placeId || '').trim(), source: String(item.source || 'manual'), primary: Boolean(item.primary) || idx === 0 } };
  }).filter(Boolean);

  for (const field of SCALAR_STRING_FIELDS) {
    const orig = p.userdata[field];
    if (orig !== undefined && typeof orig !== 'string') { track(`userdata.${field}`, Array.isArray(orig) ? 'array' : typeof orig, 'string', 'coerced to string'); p.userdata[field] = coerceToString(orig); }
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

async function invokeRepairAgent(prompt, timeoutMs = 50000) {
  const appId = Deno.env.get('BASE44_APP_ID');
  const serviceRoleKey = Deno.env.get('BASE44_SERVICE_ROLE_KEY');
  if (!appId || !serviceRoleKey) return { ok: false, json: null, rawContent: '', error: 'missing_env_credentials' };

  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceRoleKey}` };
  const base = `https://base44.app/api/apps/${appId}/agents/conversations`;

  let convId;
  try {
    const r = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ agent_name: 'pro_submission_repair_agent', metadata: { source: 'repair_function' } }) });
    if (!r.ok) return { ok: false, json: null, rawContent: '', error: `create_conv_${r.status}` };
    const c = await r.json();
    convId = c?.id;
    if (!convId) return { ok: false, json: null, rawContent: '', error: 'no_conversation_id' };
  } catch (e) { return { ok: false, json: null, rawContent: '', error: `create_conv_exception: ${e.message}` }; }

  try {
    const r = await fetch(`${base}/${convId}/messages`, { method: 'POST', headers, body: JSON.stringify({ role: 'user', content: prompt }) });
    if (!r.ok) return { ok: false, json: null, rawContent: '', error: `send_msg_${r.status}` };
  } catch (e) { return { ok: false, json: null, rawContent: '', error: `send_msg_exception: ${e.message}` }; }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const r = await fetch(`${base}/${convId}`, { headers });
      if (!r.ok) continue;
      const conv = await r.json();
      const msgs = Array.isArray(conv.messages) ? conv.messages : [];
      const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant' && last.content && last.streaming === false) {
        const extracted = extractJsonObjectFromText(last.content);
        return extracted.ok
          ? { ok: true, json: extracted.value, rawContent: last.content, error: null }
          : { ok: false, json: null, rawContent: last.content, error: `json_extraction: ${extracted.error}` };
      }
    } catch { /* continue */ }
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

// ─── Agent prompt builder ─────────────────────────────────────────────────────

function buildRepairPrompt({ rawPayloadStr, rawResponsesStr, primaryError, fallbackError, retryError, businessName, businessDomain, sessionId }) {
  const schema = `Required shape: { metadata: { business_name: string, businessDomain: string, submission_datetime: string, service_type: "pro" }, userdata: { additional_pages_list: object, service_offerings: string[], target_industries: string[], geographic_areas: [{geographic_area_meta:{name,label,lat,lon,place_id,source,primary}}], pricing_packaging: string[], company_goals: string[], certifications_partnerships: object[], service_guarantee_items: object[], website_objectives: string[], client_challenges: string[], client_outcomes: string[], delivery_model: string, brand_tone: string, company_description: string, differentiation: string, sales_process: string, client_acquisition: string, client_size: string, client_frustrations: string, value_description: string, ideal_client: string, avoided_clients: string, primary_cta: string, additional_notes: string } }`;

  const lines = [
    'TASK: Repair the structural/type errors in the following Pro Questionnaire submission payload.',
    'CONSTRAINTS: Do NOT invent missing business_name or businessDomain. Do NOT add fake data. Do NOT rewrite any text field. Only fix JSON structure and types.',
    '',
    `Business Name (trusted): ${businessName || '(unknown)'}`,
    `Business Domain (trusted): ${businessDomain || '(unknown)'}`,
    `Session ID: ${sessionId || '(unknown)'}`,
    '',
    `SCHEMA REFERENCE: ${schema}`,
    '',
    'FAILED PAYLOAD (may be malformed):',
    (rawPayloadStr || '(none)').slice(0, 8000),
  ];

  if (rawResponsesStr) { lines.push('', 'RAW RESPONSES:', rawResponsesStr.slice(0, 2000)); }
  if (primaryError) { lines.push('', 'PRIMARY ERROR:', String(primaryError).slice(0, 500)); }
  if (fallbackError) { lines.push('', 'FALLBACK ERROR:', String(fallbackError).slice(0, 500)); }
  if (retryError) { lines.push('', 'RETRY ERROR:', String(retryError).slice(0, 500)); }

  lines.push('', 'Respond with ONLY a JSON object matching the required response contract. No markdown. No prose outside JSON.');

  return lines.join('\n');
}

// ─── Core repair logic (shared between intake and draft) ─────────────────────

async function runRepairPipeline({ base44, rawPayload, context, mode, sessionId, allowRetry }) {
  // Step 1: Deterministic repair
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

  // Step 2: Call AI agent
  const prompt = buildRepairPrompt({
    rawPayloadStr: JSON.stringify(rawPayload, null, 2),
    businessName: context.businessName,
    businessDomain: context.businessDomain,
    sessionId
  });

  await emitEvent(base44, sessionId, 'ai_repair_started', context);
  const agentResult = await invokeRepairAgent(prompt, 50000);

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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ success: false, error: { message: 'Forbidden: Admin access required' } }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const intakeId = typeof body?.intakeId === 'string' ? body.intakeId : '';
    const questionnaireSessionId = typeof body?.questionnaireSessionId === 'string' ? body.questionnaireSessionId : '';
    const draftId = typeof body?.draftId === 'string' ? body.draftId : '';
    const mode = ['diagnose_only', 'repair_only', 'repair_and_retry'].includes(body?.mode) ? body.mode : 'diagnose_only';
    const forceRetry = Boolean(body?.forceRetry);

    if (!intakeId && !questionnaireSessionId && !draftId) {
      return Response.json({ success: false, error: { message: 'intakeId, questionnaireSessionId, or draftId is required' } }, { status: 400 });
    }

    const now = new Date().toISOString();

    // ── DRAFT MODE ────────────────────────────────────────────────────────────
    if (draftId && !intakeId && !questionnaireSessionId) {
      const draftList = await base44.asServiceRole.entities.ProFormDraft.filter({ id: draftId });
      const draft = Array.isArray(draftList) && draftList.length > 0 ? draftList[0] : null;
      if (!draft) return Response.json({ success: false, error: { message: 'Draft not found' } }, { status: 404 });

      // Build candidate payload
      let rawPayload = null;
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
      }

      const context = { businessName: draft.business_name, businessDomain: draft.domain };
      const repairResult = await runRepairPipeline({
        base44, rawPayload, context, mode, sessionId: draft.session_id, allowRetry: false
      });

      const updateData = {
        ai_repair_status: repairResult.ok ? 'completed' : 'needs_human_review',
        last_ai_repair_at: now,
        ai_repair_report_json: JSON.stringify(repairResult.report),
        ai_repaired_payload_json: repairResult.payload ? JSON.stringify(repairResult.payload) : '',
        ai_repair_error_json: repairResult.ok ? '' : JSON.stringify(repairResult.errors)
      };
      await base44.asServiceRole.entities.ProFormDraft.update(draft.id, updateData);

      return Response.json({
        success: true,
        draftMode: true,
        submissionCreated: false,
        repairSource: repairResult.source,
        repairOk: repairResult.ok,
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

    // Guard: already submitted
    if (intake.linked_submission_id && !forceRetry) {
      return Response.json({ success: true, alreadySubmitted: true, linkedSubmissionId: intake.linked_submission_id, intakeId: intake.id });
    }

    // Parse intake payload
    const payloadParsed = safeJsonParse(intake.transformed_payload_json);
    const rawPayload = payloadParsed.ok ? payloadParsed.value : {};

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

    // diagnose_only: just repair + validate, save report, no submission
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
      base44, rawPayload, context, mode, sessionId: intake.questionnaire_session_id, allowRetry: mode === 'repair_and_retry'
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

    // repair_and_retry: create submission exactly once
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
      await emitEvent(base44, intake.questionnaire_session_id, 'ai_repair_retry_succeeded', context);
      return Response.json({ success: true, mode: 'repair_and_retry', linkedSubmissionId: submission.id, repairSource: repairResult.source, report: repairResult.report, intakeId: intake.id });
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