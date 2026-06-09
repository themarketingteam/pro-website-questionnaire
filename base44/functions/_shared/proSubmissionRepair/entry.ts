/**
 * proSubmissionRepair.js
 *
 * Backend-safe deterministic payload repair and validation utilities
 * for Pro Questionnaire submissions.
 *
 * IMPORTANT: Base44 Deno functions cannot import from other local files at
 * runtime. This file is a shared SOURCE MODULE intended to be INLINED into
 * consuming functions at authoring time. Do not add `import` statements that
 * reference local paths here.
 *
 * No eval. No browser APIs. No React/Vite aliases.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STRING_ARRAY_FIELDS = [
  'service_offerings',
  'target_industries',
  'pricing_packaging',
  'company_goals',
  'website_objectives',
  'client_challenges',
  'client_outcomes',
];

const OBJECT_ARRAY_FIELDS = [
  'geographic_areas',
  'certifications_partnerships',
  'service_guarantee_items',
];

const SCALAR_STRING_FIELDS = [
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

function isPlainObject(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

/**
 * Detect browser/upload-like objects that should never reach the server.
 * In Deno these won't be File instances but the check is defensive.
 */
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

function asTrimmedString(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(asTrimmedString).filter(Boolean).join(', ');
  if (isPlainObject(v)) {
    // Try common label-like keys
    for (const key of ['label', 'name', 'value', 'text', 'title']) {
      if (typeof v[key] === 'string' && v[key].trim()) return v[key].trim();
    }
    return '';
  }
  return '';
}

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (!trimmed) return [];
    return [trimmed];
  }
  return [v];
}

function asPlainObject(v) {
  if (isPlainObject(v)) return v;
  if (v == null) return {};
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); if (isPlainObject(p)) return p; } catch { /**/ }
  }
  return {};
}

// ---------------------------------------------------------------------------
// 1. safeJsonParse
// ---------------------------------------------------------------------------

/**
 * Safely parse a JSON value from a string or pass-through an object.
 *
 * Repair steps attempted in order when direct parse fails:
 *   1. Trim whitespace
 *   2. Strip markdown code fences (```json ... ``` or ``` ... ```)
 *   3. Normalize smart/curly quotes → straight quotes
 *   4. Remove single-line // comments
 *   5. Remove multi-line / * ... * / comments
 *   6. Remove trailing commas before } or ]
 *   7. Balance obvious unclosed braces/brackets (conservative: only append)
 *
 * Returns { ok: boolean, value: any, error: string | null }
 */
export function safeJsonParse(value) {
  if (value == null) return { ok: false, value: null, error: 'Input is null or undefined' };
  if (typeof value === 'object') return { ok: true, value, error: null };
  if (typeof value !== 'string') return { ok: false, value: null, error: `Cannot parse type: ${typeof value}` };

  // Direct parse first
  try {
    return { ok: true, value: JSON.parse(value), error: null };
  } catch (_e1) { /**/ }

  // Apply structural fixes progressively
  let s = value;

  // Step 1: Trim
  s = s.trim();

  // Step 2: Strip markdown code fences
  s = s.replace(/^```(?:json|javascript|js)?\s*/i, '').replace(/\s*```\s*$/, '');
  s = s.trim();

  // Try after fence strip
  try { return { ok: true, value: JSON.parse(s), error: null }; } catch { /**/ }

  // Step 3: Normalize smart quotes
  s = s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2032]/g, "'")
    .replace(/[\u2033]/g, '"');

  // Step 4: Remove single-line // comments (not inside strings — best-effort)
  s = s.replace(/\/\/[^\n]*/g, '');

  // Step 5: Remove multi-line /* */ comments
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');

  // Try after comment removal
  try { return { ok: true, value: JSON.parse(s), error: null }; } catch { /**/ }

  // Step 6: Remove trailing commas before } or ]
  s = s.replace(/,\s*([}\]])/g, '$1');

  // Try after trailing comma removal
  try { return { ok: true, value: JSON.parse(s), error: null }; } catch { /**/ }

  // Step 7: Balance obvious unclosed braces/brackets (conservative — only append)
  const opens = (s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length;
  const openBrackets = (s.match(/\[/g) || []).length - (s.match(/\]/g) || []).length;
  // Only attempt if imbalance is small (1–3) to avoid corrupting large partial JSON
  if (opens > 0 && opens <= 3) {
    const balanced = s + '}'.repeat(opens);
    try { return { ok: true, value: JSON.parse(balanced), error: null }; } catch { /**/ }
  }
  if (openBrackets > 0 && openBrackets <= 3) {
    const balanced = s + ']'.repeat(openBrackets);
    try { return { ok: true, value: JSON.parse(balanced), error: null }; } catch { /**/ }
  }
  // Combined balance
  if (opens > 0 && opens <= 3 && openBrackets > 0 && openBrackets <= 3) {
    const balanced = s + ']'.repeat(openBrackets) + '}'.repeat(opens);
    try { return { ok: true, value: JSON.parse(balanced), error: null }; } catch { /**/ }
  }

  return { ok: false, value: null, error: 'Unable to parse JSON after repair attempts' };
}

// ---------------------------------------------------------------------------
// 2. safeJsonStringify
// ---------------------------------------------------------------------------

/**
 * Stringify a value without ever throwing.
 * Returns fallback string on any error.
 */
export function safeJsonStringify(value, fallback = '{}') {
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Internal: deep-clone without mutation (no structuredClone dependency needed)
// ---------------------------------------------------------------------------

function deepClone(value, seen = new WeakMap()) {
  if (value == null || typeof value !== 'object') return value;
  if (isUploadLike(value)) return undefined; // strip at clone time
  if (seen.has(value)) return undefined; // circular ref — drop
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) {
    const arr = [];
    seen.set(value, arr);
    for (const item of value) {
      const cloned = deepClone(item, seen);
      arr.push(cloned);
    }
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
// Internal: geographic_areas normalizer
// ---------------------------------------------------------------------------

function normalizeGeographicArea(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const safeItem = asPlainObject(item);

  // Already has geographic_area_meta wrapper
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

  // Flat location object — wrap it
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
// 3. repairSubmissionPayloadServer
// ---------------------------------------------------------------------------

/**
 * Deterministically repair a Pro Questionnaire submission payload.
 *
 * Does NOT mutate the input. Returns a new object.
 *
 * context: { businessName?: string, businessDomain?: string }
 *   — only used to fill metadata if genuinely missing from the payload itself.
 *   Do not pass invented values here.
 *
 * Returns: { payload, ok, errors, warnings, changedPaths }
 *   changedPaths: Array<{ path, beforeType, afterType, reason }>
 */
export function repairSubmissionPayloadServer(rawPayload, context = {}) {
  const warnings = [];
  const errors = [];
  const changedPaths = [];

  const track = (path, beforeType, afterType, reason) => {
    changedPaths.push({ path, beforeType: String(beforeType), afterType: String(afterType), reason });
  };

  // Deep clone to avoid mutation. Upload-like objects removed during clone.
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

  // business_name: only fill from context if genuinely missing
  if (!asTrimmedString(p.metadata.business_name)) {
    if (context.businessName && asTrimmedString(context.businessName)) {
      track('metadata.business_name', 'missing', 'string', 'filled from trusted context');
      p.metadata.business_name = asTrimmedString(context.businessName);
      warnings.push('metadata.business_name_filled_from_context');
    } else {
      errors.push('metadata.business_name_missing');
    }
  }

  // businessDomain: only fill from context if genuinely missing
  if (!asTrimmedString(p.metadata.businessDomain)) {
    // Also check alternate key name
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

  // service_type default
  if (!p.metadata.service_type) {
    p.metadata.service_type = 'pro';
    warnings.push('metadata.service_type_defaulted_to_pro');
  }

  // submission_datetime default
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
    apl.meet_the_team_page = isPlainObject(apl.meet_the_team_page) ? apl.meet_the_team_page : {};
    warnings.push('meet_the_team_page_coerced');
  }

  const mttp = apl.meet_the_team_page;

  if (!isPlainObject(mttp.team_photo_with_tags)) {
    track('userdata.additional_pages_list.meet_the_team_page.team_photo_with_tags', typeof mttp.team_photo_with_tags, 'object', 'coerced to plain object');
    mttp.team_photo_with_tags = {};
    warnings.push('team_photo_with_tags_coerced');
  }

  // taggedPeople: must be array if present (including if null)
  const tpwt = mttp.team_photo_with_tags;
  if ('taggedPeople' in tpwt || tpwt.taggedPeople != null) {
    if (!Array.isArray(tpwt.taggedPeople)) {
      const before = typeof tpwt.taggedPeople;
      tpwt.taggedPeople = isPlainObject(tpwt.taggedPeople)
        ? Object.values(tpwt.taggedPeople)
        : [];
      track('userdata.additional_pages_list.meet_the_team_page.team_photo_with_tags.taggedPeople', before, 'array', 'coerced to array');
      warnings.push('taggedPeople_coerced_to_array');
    }
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
    // Filter out nulls/empty from existing arrays
    if (Array.isArray(p.userdata[field])) {
      p.userdata[field] = p.userdata[field]
        .map(v => (typeof v === 'string' ? v : asTrimmedString(v)))
        .filter(Boolean);
    }
  }

  // --- object array fields ---
  for (const field of OBJECT_ARRAY_FIELDS) {
    const original = p.userdata[field];
    if (original === undefined) continue;
    if (!Array.isArray(original)) {
      const before = typeof original;
      if (isPlainObject(original)) {
        // Object keyed by index — convert values to array
        p.userdata[field] = Object.values(original).filter(isPlainObject);
      } else {
        p.userdata[field] = [];
      }
      track(`userdata.${field}`, before, 'array', 'coerced to object array');
      warnings.push(`${field}_coerced_to_array`);
    }
  }

  // Normalize geographic_areas items
  if (Array.isArray(p.userdata.geographic_areas)) {
    p.userdata.geographic_areas = p.userdata.geographic_areas
      .map((item, idx) => {
        const normalized = normalizeGeographicArea(item);
        if (!normalized) {
          warnings.push(`geographic_areas[${idx}]_dropped_no_name`);
        }
        return normalized;
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

  // --- strip undefined and truncate ---
  const truncated = truncateStrings(p, MAX_STRING_LENGTH);
  const cleaned = stripUndefined(truncated);

  return {
    payload: cleaned,
    ok: errors.length === 0,
    errors,
    warnings,
    changedPaths,
  };
}

// ---------------------------------------------------------------------------
// 4. validateSubmissionPayloadServer
// ---------------------------------------------------------------------------

/**
 * Mirror the essential frontend validateSubmissionPayload checks
 * in a backend-safe, zero-dependency form.
 *
 * Returns { ok: boolean, errors: string[] }
 */
export function validateSubmissionPayloadServer(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    errors.push('payload_must_be_object');
    return { ok: false, errors };
  }

  if (!isPlainObject(payload.metadata)) errors.push('metadata_must_be_object');
  if (!isPlainObject(payload.userdata)) errors.push('userdata_must_be_object');

  if (!asTrimmedString(payload.metadata?.business_name)) errors.push('metadata.business_name_missing');
  if (!asTrimmedString(payload.metadata?.businessDomain)) errors.push('metadata.businessDomain_missing');

  if (!isPlainObject(payload.userdata?.additional_pages_list)) {
    errors.push('userdata.additional_pages_list_must_be_object');
  }

  const requiredArrayFields = [
    'service_offerings',
    'target_industries',
    'geographic_areas',
    'pricing_packaging',
    'company_goals',
    'certifications_partnerships',
    'service_guarantee_items',
    'website_objectives',
    'client_challenges',
    'client_outcomes',
  ];

  for (const field of requiredArrayFields) {
    if (!Array.isArray(payload.userdata?.[field])) {
      errors.push(`userdata.${field}_must_be_array`);
    }
  }

  // geographic_areas items must contain geographic_area_meta object
  if (Array.isArray(payload.userdata?.geographic_areas)) {
    payload.userdata.geographic_areas.forEach((item, idx) => {
      if (!isPlainObject(item)) {
        errors.push(`userdata.geographic_areas[${idx}]_must_be_object`);
        return;
      }
      if (!isPlainObject(item.geographic_area_meta)) {
        errors.push(`userdata.geographic_areas[${idx}].geographic_area_meta_must_be_object`);
      }
    });
  }

  // team_photo_with_tags must be an object
  const teamPhoto = payload.userdata?.additional_pages_list?.meet_the_team_page?.team_photo_with_tags;
  if (teamPhoto != null && !isPlainObject(teamPhoto)) {
    errors.push('team_photo_with_tags_must_be_object');
  }

  // taggedPeople must be array if present
  if (teamPhoto?.taggedPeople != null && !Array.isArray(teamPhoto.taggedPeople)) {
    errors.push('taggedPeople_must_be_array');
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// 5. extractJsonObjectFromText
// ---------------------------------------------------------------------------

/**
 * Extract and parse the first valid JSON object from an Agent response string.
 *
 * Handles:
 * - Responses wrapped in ```json ... ``` fences
 * - Responses with leading/trailing prose
 * - Responses that are already pure JSON
 *
 * Returns { ok: boolean, value: any, error: string | null }
 */
export function extractJsonObjectFromText(text) {
  if (!text || typeof text !== 'string') {
    return { ok: false, value: null, error: 'Input must be a non-empty string' };
  }

  // Try direct parse first
  const direct = safeJsonParse(text);
  if (direct.ok && isPlainObject(direct.value)) return direct;

  // Try extracting content inside code fences
  const fenceMatch = text.match(/```(?:json|javascript|js)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    const inner = safeJsonParse(fenceMatch[1].trim());
    if (inner.ok && isPlainObject(inner.value)) return inner;
  }

  // Scan for first { and try to parse from there
  const firstBrace = text.indexOf('{');
  if (firstBrace !== -1) {
    // Find the last } and try progressively shorter substrings from the end
    let lastBrace = text.lastIndexOf('}');
    while (lastBrace > firstBrace) {
      const candidate = text.slice(firstBrace, lastBrace + 1);
      const attempt = safeJsonParse(candidate);
      if (attempt.ok && isPlainObject(attempt.value)) return attempt;
      // Move one step earlier
      lastBrace = text.lastIndexOf('}', lastBrace - 1);
    }
  }

  return { ok: false, value: null, error: 'No valid JSON object found in text' };
}

// ---------------------------------------------------------------------------
// 6. sanitizeRepairReport
// ---------------------------------------------------------------------------

/**
 * Keep only the safe, auditable summary fields from a repair agent report.
 * Strips any raw prompt content, PII, or payload data that shouldn't be stored.
 *
 * Returns a sanitized plain object.
 */
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
      ? report.changed_paths
          .filter(isPlainObject)
          .slice(0, 100)
          .map(cp => ({
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

// ---------------------------------------------------------------------------
// Manual validation harness (run with: deno run functions/_shared/proSubmissionRepair.js)
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const assert = (label, condition) => {
    if (!condition) throw new Error(`FAIL: ${label}`);
    console.log(`PASS: ${label}`);
  };

  // Test 1: geographic_areas object becomes array
  const r1 = repairSubmissionPayloadServer({
    metadata: { business_name: 'Acme', businessDomain: 'acme.com' },
    userdata: {
      geographic_areas: { 0: { name: 'Nashville', lat: '36.17', lon: '-86.78' } },
      additional_pages_list: {},
    },
  });
  assert('geographic_areas object → array', Array.isArray(r1.payload.userdata.geographic_areas));

  // Test 2: taggedPeople object becomes array
  const r2 = repairSubmissionPayloadServer({
    metadata: { business_name: 'Acme', businessDomain: 'acme.com' },
    userdata: {
      geographic_areas: [],
      additional_pages_list: {
        meet_the_team_page: {
          team_photo_with_tags: { taggedPeople: { 0: { name: 'Alice' } } },
        },
      },
    },
  });
  assert(
    'taggedPeople object → array',
    Array.isArray(r2.payload.userdata.additional_pages_list.meet_the_team_page.team_photo_with_tags.taggedPeople),
  );

  // Test 3: scalar string fields supplied as arrays become strings
  const r3 = repairSubmissionPayloadServer({
    metadata: { business_name: 'Acme', businessDomain: 'acme.com' },
    userdata: { geographic_areas: [], additional_pages_list: {}, delivery_model: ['Fully Managed IT Provider'] },
  });
  assert('delivery_model array → string', typeof r3.payload.userdata.delivery_model === 'string');

  // Test 4: malformed JSON with trailing comma parses
  const p4 = safeJsonParse('{ "a": 1, "b": 2, }');
  assert('trailing comma parse', p4.ok && p4.value.a === 1);

  // Test 5: missing business_name remains error unless context provided
  const r5a = repairSubmissionPayloadServer({ metadata: { businessDomain: 'x.com' }, userdata: {} });
  assert('missing business_name → error', r5a.errors.includes('metadata.business_name_missing'));
  const r5b = repairSubmissionPayloadServer({ metadata: { businessDomain: 'x.com' }, userdata: {} }, { businessName: 'MyBiz' });
  assert('business_name from context → ok', r5b.payload.metadata.business_name === 'MyBiz');

  // Test 6: missing businessDomain remains error unless context provided
  const r6a = repairSubmissionPayloadServer({ metadata: { business_name: 'X' }, userdata: {} });
  assert('missing businessDomain → error', r6a.errors.includes('metadata.businessDomain_missing'));

  // Test 7: Agent response in ```json fences can be parsed
  const fenced = '```json\n{"decision":"repair","confidence":0.9}\n```';
  const p7 = extractJsonObjectFromText(fenced);
  assert('fenced json extracted', p7.ok && p7.value.decision === 'repair');

  console.log('\nAll manual validation tests passed.');
}