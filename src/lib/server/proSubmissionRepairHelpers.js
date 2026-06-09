/**
 * proSubmissionRepairHelpers.js
 *
 * Canonical source for backend-safe deterministic payload repair and validation
 * utilities for Pro Questionnaire submissions.
 *
 * ─── IMPORTANT ───────────────────────────────────────────────────────────────
 * Base44 Deno functions are deployed independently and cannot import from other
 * local files at runtime. This file is the CANONICAL REFERENCE SOURCE. When
 * writing a new Deno function that needs these helpers, INLINE the relevant
 * functions directly into that function file.
 *
 * Do NOT import this file from functions/ — it will cause a deployment failure.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * No eval. No browser APIs. No React/Vite aliases.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const STRING_ARRAY_FIELDS = [
  'service_offerings',
  'target_industries',
  'pricing_packaging',
  'company_goals',
  'website_objectives',
  'client_challenges',
  'client_outcomes',
];

export const OBJECT_ARRAY_FIELDS = [
  'geographic_areas',
  'certifications_partnerships',
  'service_guarantee_items',
];

export const SCALAR_STRING_FIELDS = [
  'service_offerings_other',
  'target_industries_other',
  'delivery_model',
  'delivery_model_other',
  'pricing_packaging_other',
  'differentiation',
  'company_goals_other',
  'brand_tone',
  'brand_tone_other',
  'sales_process',
  'client_acquisition',
  'client_acquisition_other',
  'website_objectives_other',
  'client_size',
  'client_challenges_other',
  'client_frustrations',
  'client_outcomes_other',
  'value_description',
  'ideal_client',
  'avoided_clients',
  'primary_cta',
  'primary_cta_other',
  'additional_notes',
  'company_description',
];

const MAX_STRING_LENGTH = 5000;

// ---------------------------------------------------------------------------
// Internal type helpers
// ---------------------------------------------------------------------------

export function isPlainObject(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

function isUploadLike(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const tag = (v?.constructor?.name) || '';
  if (['File', 'Blob', 'ArrayBuffer', 'FormData'].includes(tag)) return true;
  const hasBinaryMethods =
    typeof v.arrayBuffer === 'function' || typeof v.stream === 'function';
  const hasFileMetadata =
    typeof v.size === 'number' && typeof v.type === 'string';
  return hasBinaryMethods && hasFileMetadata;
}

export function asTrimmedString(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(asTrimmedString).filter(Boolean).join(', ');
  if (isPlainObject(v)) {
    for (const key of ['label', 'name', 'value', 'text', 'title']) {
      if (typeof v[key] === 'string' && v[key].trim()) return v[key].trim();
    }
    return '';
  }
  return '';
}

export function asPlainObject(v) {
  if (isPlainObject(v)) return v;
  if (v == null) return {};
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); if (isPlainObject(p)) return p; } catch { /**/ }
  }
  return {};
}

// ---------------------------------------------------------------------------
// Internal: deep-clone without mutation
// ---------------------------------------------------------------------------

function deepClone(value, seen = new WeakMap()) {
  if (value == null || typeof value !== 'object') return value;
  if (isUploadLike(value)) return undefined;
  if (seen.has(value)) return undefined;
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) {
    const arr = [];
    seen.set(value, arr);
    for (const item of value) arr.push(deepClone(item, seen));
    return arr;
  }
  const obj = {};
  seen.set(value, obj);
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'function') continue;
    const cloned = deepClone(v, seen);
    if (cloned !== undefined) obj[k] = cloned;
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Internal: strip undefined recursively
// ---------------------------------------------------------------------------

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined).filter(v => v !== undefined);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.entries(value).reduce((acc, [k, v]) => {
      const cleaned = stripUndefined(v);
      if (cleaned !== undefined) acc[k] = cleaned;
      return acc;
    }, {});
  }
  return value;
}

// ---------------------------------------------------------------------------
// Internal: truncate long strings
// ---------------------------------------------------------------------------

function truncateStrings(value, max = MAX_STRING_LENGTH) {
  if (typeof value === 'string') return value.length > max ? value.slice(0, max) : value;
  if (Array.isArray(value)) return value.map(v => truncateStrings(v, max));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.entries(value).reduce((acc, [k, v]) => {
      acc[k] = truncateStrings(v, max);
      return acc;
    }, {});
  }
  return value;
}

// ---------------------------------------------------------------------------
// Internal: geographic_areas item normalizer
// ---------------------------------------------------------------------------

function normalizeGeographicArea(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const safeItem = asPlainObject(item);

  if (isPlainObject(safeItem.geographic_area_meta)) {
    const m = safeItem.geographic_area_meta;
    return {
      geographic_area_meta: {
        name: asTrimmedString(m.name || m.label || m.city || ''),
        label: asTrimmedString(m.label || m.name || m.city || ''),
        lat: m.lat != null ? String(m.lat) : (m.latitude != null ? String(m.latitude) : ''),
        lon: m.lon != null ? String(m.lon) : (m.lng != null ? String(m.lng) : (m.longitude != null ? String(m.longitude) : '')),
        place_id: asTrimmedString(m.place_id || m.placeId || ''),
        source: asTrimmedString(m.source) || 'manual',
        primary: Boolean(m.primary),
      },
    };
  }

  const name = asTrimmedString(safeItem.name || safeItem.label || safeItem.city || safeItem.location || '');
  if (!name) return null;

  return {
    geographic_area_meta: {
      name,
      label: asTrimmedString(safeItem.label || safeItem.name || safeItem.city || ''),
      lat: safeItem.lat != null ? String(safeItem.lat) : (safeItem.latitude != null ? String(safeItem.latitude) : ''),
      lon: safeItem.lon != null ? String(safeItem.lon) : (safeItem.lng != null ? String(safeItem.lng) : (safeItem.longitude != null ? String(safeItem.longitude) : '')),
      place_id: asTrimmedString(safeItem.place_id || safeItem.placeId || ''),
      source: asTrimmedString(safeItem.source) || 'manual',
      primary: Boolean(safeItem.primary),
    },
  };
}

// ---------------------------------------------------------------------------
// 1. safeJsonParse
// ---------------------------------------------------------------------------

/**
 * Safely parse a JSON value from a string or pass-through an object.
 *
 * Repair steps attempted in order when direct parse fails:
 *   1. Trim whitespace
 *   2. Strip markdown code fences
 *   3. Normalize smart/curly quotes → straight quotes
 *   4. Remove single-line // comments (best-effort, outside strings)
 *   5. Remove multi-line / * ... * / comments
 *   6. Remove trailing commas before } or ]
 *   7. Balance obvious unclosed braces/brackets (conservative: 1–3 only)
 *
 * Returns { ok: boolean, value: any, error: string | null }
 */
export function safeJsonParse(value) {
  if (value == null) return { ok: false, value: null, error: 'Input is null or undefined' };
  if (typeof value === 'object') return { ok: true, value, error: null };
  if (typeof value !== 'string') return { ok: false, value: null, error: `Cannot parse type: ${typeof value}` };

  try { return { ok: true, value: JSON.parse(value), error: null }; } catch { /**/ }

  let s = value.trim();

  // Strip markdown fences
  s = s.replace(/^```(?:json|javascript|js)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try { return { ok: true, value: JSON.parse(s), error: null }; } catch { /**/ }

  // Normalize smart quotes
  s = s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2032]/g, "'")
    .replace(/[\u2033]/g, '"');

  // Remove // comments
  s = s.replace(/\/\/[^\n]*/g, '');

  // Remove /* */ comments
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  try { return { ok: true, value: JSON.parse(s), error: null }; } catch { /**/ }

  // Remove trailing commas
  s = s.replace(/,\s*([}\]])/g, '$1');
  try { return { ok: true, value: JSON.parse(s), error: null }; } catch { /**/ }

  // Balance braces (conservative)
  const openBraces = (s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length;
  const openBrackets = (s.match(/\[/g) || []).length - (s.match(/\]/g) || []).length;
  if (openBraces > 0 && openBraces <= 3) {
    const b = s + '}'.repeat(openBraces);
    try { return { ok: true, value: JSON.parse(b), error: null }; } catch { /**/ }
  }
  if (openBrackets > 0 && openBrackets <= 3) {
    const b = s + ']'.repeat(openBrackets);
    try { return { ok: true, value: JSON.parse(b), error: null }; } catch { /**/ }
  }
  if (openBraces > 0 && openBraces <= 3 && openBrackets > 0 && openBrackets <= 3) {
    const b = s + ']'.repeat(openBrackets) + '}'.repeat(openBraces);
    try { return { ok: true, value: JSON.parse(b), error: null }; } catch { /**/ }
  }

  return { ok: false, value: null, error: 'Unable to parse JSON after repair attempts' };
}

// ---------------------------------------------------------------------------
// 2. safeJsonStringify
// ---------------------------------------------------------------------------

export function safeJsonStringify(value, fallback = '{}') {
  try { return JSON.stringify(value); } catch { return fallback; }
}

// ---------------------------------------------------------------------------
// 3. repairSubmissionPayloadServer
// ---------------------------------------------------------------------------

/**
 * Deterministically repair a Pro Questionnaire submission payload.
 * Does NOT mutate the input. Returns a new object.
 *
 * context: { businessName?: string, businessDomain?: string }
 *   Only used to fill metadata if genuinely missing from the payload itself.
 *
 * Returns: { payload, ok, errors, warnings, changedPaths }
 *   changedPaths: Array<{ path, beforeType, afterType, reason }>
 *
 * Key differences from src/lib/proPayloadRepair.js:
 *   - No dependency on proResponseNormalizers (normalizeIndustrySelections, etc.)
 *     because those rely on Vite aliases and front-end modules. Here we use
 *     generic string-array coercion instead.
 *   - deepClone removes upload-like objects at clone time rather than in a
 *     separate pass, reducing complexity.
 *   - context.businessName / context.businessDomain provide a trusted fill
 *     path that does not exist in the frontend repair (which always has access
 *     to the Redux store's businessName field).
 *   - changedPaths is returned for Agent audit logging.
 */
export function repairSubmissionPayloadServer(rawPayload, context = {}) {
  const warnings = [];
  const errors = [];
  const changedPaths = [];

  const track = (path, beforeType, afterType, reason) =>
    changedPaths.push({ path, beforeType: String(beforeType), afterType: String(afterType), reason });

  const p = deepClone(rawPayload) ?? {};

  if (!isPlainObject(p)) {
    errors.push('payload_must_be_object');
    return { payload: {}, ok: false, errors, warnings, changedPaths };
  }

  // --- metadata ---
  if (!isPlainObject(p.metadata)) {
    track('metadata', typeof p.metadata, 'object', 'coerced to plain object');
    p.metadata = asPlainObject(p.metadata);
    warnings.push('metadata_coerced');
  }

  if (!asTrimmedString(p.metadata.business_name)) {
    if (context.businessName && asTrimmedString(context.businessName)) {
      track('metadata.business_name', 'missing', 'string', 'filled from trusted context');
      p.metadata.business_name = asTrimmedString(context.businessName);
      warnings.push('metadata.business_name_filled_from_context');
    } else {
      errors.push('metadata.business_name_missing');
    }
  }

  if (!asTrimmedString(p.metadata.businessDomain)) {
    if (asTrimmedString(p.metadata.business_domain)) {
      track('metadata.businessDomain', 'missing', 'string', 'mapped from metadata.business_domain');
      p.metadata.businessDomain = asTrimmedString(p.metadata.business_domain);
      warnings.push('metadata.businessDomain_mapped_from_business_domain');
    } else if (context.businessDomain && asTrimmedString(context.businessDomain)) {
      track('metadata.businessDomain', 'missing', 'string', 'filled from trusted context');
      p.metadata.businessDomain = asTrimmedString(context.businessDomain);
      warnings.push('metadata.businessDomain_filled_from_context');
    } else {
      errors.push('metadata.businessDomain_missing');
    }
  }

  if (!p.metadata.service_type) {
    p.metadata.service_type = 'pro';
    warnings.push('metadata.service_type_defaulted_to_pro');
  }

  if (!p.metadata.submission_datetime) {
    p.metadata.submission_datetime = new Date().toISOString();
    warnings.push('metadata.submission_datetime_defaulted');
  }

  // --- userdata ---
  if (!isPlainObject(p.userdata)) {
    track('userdata', typeof p.userdata, 'object', 'coerced to plain object');
    p.userdata = asPlainObject(p.userdata);
    warnings.push('userdata_coerced');
  }

  // --- additional_pages_list ---
  if (!isPlainObject(p.userdata.additional_pages_list)) {
    track('userdata.additional_pages_list', typeof p.userdata.additional_pages_list, 'object', 'coerced to plain object');
    p.userdata.additional_pages_list = {};
    warnings.push('additional_pages_list_coerced');
  }
  const apl = p.userdata.additional_pages_list;

  if (!isPlainObject(apl.meet_the_team_page)) {
    track('userdata.additional_pages_list.meet_the_team_page', typeof apl.meet_the_team_page, 'object', 'coerced to plain object');
    apl.meet_the_team_page = {};
    warnings.push('meet_the_team_page_coerced');
  }
  const mttp = apl.meet_the_team_page;

  if (!isPlainObject(mttp.team_photo_with_tags)) {
    track('userdata.additional_pages_list.meet_the_team_page.team_photo_with_tags', typeof mttp.team_photo_with_tags, 'object', 'coerced to plain object');
    mttp.team_photo_with_tags = {};
    warnings.push('team_photo_with_tags_coerced');
  }
  const tpwt = mttp.team_photo_with_tags;

  // taggedPeople null → [], keyed object → Object.values (preserves people data)
  if (tpwt.taggedPeople !== undefined && !Array.isArray(tpwt.taggedPeople)) {
    const before = typeof tpwt.taggedPeople;
    tpwt.taggedPeople = (tpwt.taggedPeople === null)
      ? []
      : (isPlainObject(tpwt.taggedPeople) ? Object.values(tpwt.taggedPeople) : []);
    track('...team_photo_with_tags.taggedPeople', before, 'array', 'coerced to array');
    warnings.push('taggedPeople_coerced_to_array');
  }

  // --- string array fields ---
  for (const field of STRING_ARRAY_FIELDS) {
    const original = p.userdata[field];
    if (original === undefined) continue;
    if (!Array.isArray(original)) {
      const before = typeof original;
      if (typeof original === 'string' && original.trim()) {
        p.userdata[field] = [original.trim()];
      } else if (isPlainObject(original)) {
        p.userdata[field] = Object.values(original).filter(v => typeof v === 'string' && v.trim());
      } else {
        p.userdata[field] = [];
      }
      track(`userdata.${field}`, before, 'array', 'coerced to string array');
      warnings.push(`${field}_coerced_to_array`);
    }
    p.userdata[field] = p.userdata[field]
      .map(v => (typeof v === 'string' ? v : asTrimmedString(v)))
      .filter(Boolean);
  }

  // --- object array fields ---
  for (const field of OBJECT_ARRAY_FIELDS) {
    const original = p.userdata[field];
    if (original === undefined) continue;
    if (!Array.isArray(original)) {
      const before = typeof original;
      p.userdata[field] = isPlainObject(original) ? Object.values(original).filter(isPlainObject) : [];
      track(`userdata.${field}`, before, 'array', 'coerced to object array');
      warnings.push(`${field}_coerced_to_array`);
    }
  }

  // Normalize geographic_areas
  if (Array.isArray(p.userdata.geographic_areas)) {
    p.userdata.geographic_areas = p.userdata.geographic_areas
      .map((item, idx) => {
        const n = normalizeGeographicArea(item);
        if (!n) warnings.push(`geographic_areas[${idx}]_dropped_no_name`);
        return n;
      })
      .filter(Boolean);
  }

  // --- scalar string fields ---
  for (const field of SCALAR_STRING_FIELDS) {
    const original = p.userdata[field];
    if (original === undefined) continue;
    if (typeof original !== 'string') {
      const before = typeof original;
      p.userdata[field] = asTrimmedString(original);
      track(`userdata.${field}`, before, 'string', 'coerced to scalar string');
      warnings.push(`${field}_coerced_to_string`);
    }
  }

  const cleaned = stripUndefined(truncateStrings(p, MAX_STRING_LENGTH));

  return { payload: cleaned, ok: errors.length === 0, errors, warnings, changedPaths };
}

// ---------------------------------------------------------------------------
// 4. validateSubmissionPayloadServer
// ---------------------------------------------------------------------------

export function validateSubmissionPayloadServer(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    return { ok: false, errors: ['payload_must_be_object'] };
  }

  if (!isPlainObject(payload.metadata)) errors.push('metadata_must_be_object');
  if (!isPlainObject(payload.userdata)) errors.push('userdata_must_be_object');
  if (!asTrimmedString(payload.metadata?.business_name)) errors.push('metadata.business_name_missing');
  if (!asTrimmedString(payload.metadata?.businessDomain)) errors.push('metadata.businessDomain_missing');

  if (!isPlainObject(payload.userdata?.additional_pages_list)) {
    errors.push('userdata.additional_pages_list_must_be_object');
  }

  const requiredArrayFields = [
    'service_offerings', 'target_industries', 'geographic_areas',
    'pricing_packaging', 'company_goals', 'certifications_partnerships',
    'service_guarantee_items', 'website_objectives', 'client_challenges', 'client_outcomes',
  ];

  for (const field of requiredArrayFields) {
    if (!Array.isArray(payload.userdata?.[field])) errors.push(`userdata.${field}_must_be_array`);
  }

  if (Array.isArray(payload.userdata?.geographic_areas)) {
    payload.userdata.geographic_areas.forEach((item, idx) => {
      if (!isPlainObject(item)) { errors.push(`userdata.geographic_areas[${idx}]_must_be_object`); return; }
      if (!isPlainObject(item.geographic_area_meta)) errors.push(`userdata.geographic_areas[${idx}].geographic_area_meta_must_be_object`);
    });
  }

  const teamPhoto = payload.userdata?.additional_pages_list?.meet_the_team_page?.team_photo_with_tags;
  if (teamPhoto != null && !isPlainObject(teamPhoto)) errors.push('team_photo_with_tags_must_be_object');
  if (teamPhoto?.taggedPeople != null && !Array.isArray(teamPhoto.taggedPeople)) errors.push('taggedPeople_must_be_array');

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// 5. extractJsonObjectFromText
// ---------------------------------------------------------------------------

export function extractJsonObjectFromText(text) {
  if (!text || typeof text !== 'string') {
    return { ok: false, value: null, error: 'Input must be a non-empty string' };
  }

  const direct = safeJsonParse(text);
  if (direct.ok && isPlainObject(direct.value)) return direct;

  const fenceMatch = text.match(/```(?:json|javascript|js)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    const inner = safeJsonParse(fenceMatch[1].trim());
    if (inner.ok && isPlainObject(inner.value)) return inner;
  }

  const firstBrace = text.indexOf('{');
  if (firstBrace !== -1) {
    let lastBrace = text.lastIndexOf('}');
    while (lastBrace > firstBrace) {
      const attempt = safeJsonParse(text.slice(firstBrace, lastBrace + 1));
      if (attempt.ok && isPlainObject(attempt.value)) return attempt;
      lastBrace = text.lastIndexOf('}', lastBrace - 1);
    }
  }

  return { ok: false, value: null, error: 'No valid JSON object found in text' };
}

// ---------------------------------------------------------------------------
// 6. sanitizeRepairReport
// ---------------------------------------------------------------------------

export function sanitizeRepairReport(report) {
  if (!isPlainObject(report)) return {};
  return {
    decision: typeof report.decision === 'string' ? report.decision : 'unknown',
    confidence: typeof report.confidence === 'number' ? report.confidence : 0,
    should_retry_submission: Boolean(report.should_retry_submission),
    diagnosis: typeof report.diagnosis === 'string' ? report.diagnosis.slice(0, 1000) : '',
    repair_summary: Array.isArray(report.repair_summary)
      ? report.repair_summary.filter(s => typeof s === 'string').map(s => s.slice(0, 500))
      : [],
    changed_paths: Array.isArray(report.changed_paths)
      ? report.changed_paths.filter(isPlainObject).slice(0, 100).map(cp => ({
          path: String(cp.path || '').slice(0, 200),
          before_type: String(cp.before_type || '').slice(0, 50),
          after_type: String(cp.after_type || '').slice(0, 50),
          reason: String(cp.reason || '').slice(0, 500),
        }))
      : [],
    warnings: Array.isArray(report.warnings)
      ? report.warnings.filter(s => typeof s === 'string').map(s => s.slice(0, 200)).slice(0, 50)
      : [],
  };
}