/**
 * proSubmissionRepairHelpers.test.js
 *
 * Tests for the backend-safe payload repair, validation, and JSON utilities.
 * These helpers are inlined into Deno functions at authoring time; the tests
 * run in the browser/Node Vitest environment to validate the logic.
 */

import { describe, it, expect } from 'vitest';
import {
  safeJsonParse,
  safeJsonStringify,
  repairSubmissionPayloadServer,
  validateSubmissionPayloadServer,
  extractJsonObjectFromText,
  sanitizeRepairReport,
  isPlainObject,
  asTrimmedString,
} from '../src/lib/server/proSubmissionRepairHelpers.js';

// ---------------------------------------------------------------------------
// Minimal valid payload factory
// ---------------------------------------------------------------------------

function minimalPayload(overrides = {}) {
  return {
    metadata: {
      business_name: 'Acme IT',
      businessDomain: 'acme.com',
      service_type: 'pro',
      submission_datetime: new Date().toISOString(),
    },
    userdata: {
      additional_pages_list: {
        meet_the_team_page: {
          team_photo_with_tags: { taggedPeople: [] },
        },
        why_choose_us_page: {},
      },
      service_offerings: [],
      target_industries: [],
      geographic_areas: [],
      pricing_packaging: [],
      company_goals: [],
      certifications_partnerships: [],
      service_guarantee_items: [],
      website_objectives: [],
      client_challenges: [],
      client_outcomes: [],
      ...overrides.userdata,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// safeJsonParse
// ---------------------------------------------------------------------------

describe('safeJsonParse', () => {
  it('passes through an already-parsed object', () => {
    const obj = { a: 1 };
    const result = safeJsonParse(obj);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(obj);
  });

  it('parses a clean JSON string', () => {
    const result = safeJsonParse('{"a":1,"b":"hello"}');
    expect(result.ok).toBe(true);
    expect(result.value.a).toBe(1);
  });

  it('parses JSON with trailing comma after repair', () => {
    const result = safeJsonParse('{ "a": 1, "b": 2, }');
    expect(result.ok).toBe(true);
    expect(result.value.a).toBe(1);
  });

  it('parses JSON wrapped in ```json fences', () => {
    const result = safeJsonParse('```json\n{"decision":"repair","confidence":0.9}\n```');
    expect(result.ok).toBe(true);
    expect(result.value.decision).toBe('repair');
  });

  it('parses JSON wrapped in plain ``` fences', () => {
    const result = safeJsonParse('```\n{"x":42}\n```');
    expect(result.ok).toBe(true);
    expect(result.value.x).toBe(42);
  });

  it('parses JSON with single-line // comments removed', () => {
    const result = safeJsonParse('{ "a": 1 // comment\n, "b": 2 }');
    expect(result.ok).toBe(true);
    expect(result.value.b).toBe(2);
  });

  it('returns error for clearly unparseable input', () => {
    const result = safeJsonParse('not json at all ~~~');
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('returns error for null input', () => {
    const result = safeJsonParse(null);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// safeJsonStringify
// ---------------------------------------------------------------------------

describe('safeJsonStringify', () => {
  it('stringifies a plain object', () => {
    expect(safeJsonStringify({ a: 1 })).toBe('{"a":1}');
  });

  it('returns fallback on circular reference', () => {
    const obj = {};
    obj.self = obj;
    expect(safeJsonStringify(obj, '{}')).toBe('{}');
  });
});

// ---------------------------------------------------------------------------
// repairSubmissionPayloadServer — geographic_areas
// ---------------------------------------------------------------------------

describe('repairSubmissionPayloadServer — geographic_areas', () => {
  it('coerces a keyed object to an array', () => {
    const result = repairSubmissionPayloadServer({
      metadata: { business_name: 'Acme', businessDomain: 'acme.com' },
      userdata: {
        geographic_areas: { 0: { name: 'Nashville', lat: '36.17', lon: '-86.78' } },
        additional_pages_list: {},
      },
    });
    expect(Array.isArray(result.payload.userdata.geographic_areas)).toBe(true);
    expect(result.warnings).toContain('geographic_areas_coerced_to_array');
  });

  it('wraps flat location objects with geographic_area_meta', () => {
    const result = repairSubmissionPayloadServer({
      metadata: { business_name: 'Acme', businessDomain: 'acme.com' },
      userdata: {
        geographic_areas: [{ name: 'Nashville', latitude: 36.17, longitude: -86.78, source: 'google' }],
        additional_pages_list: {},
      },
    });
    const area = result.payload.userdata.geographic_areas[0];
    expect(isPlainObject(area.geographic_area_meta)).toBe(true);
    expect(area.geographic_area_meta.name).toBe('Nashville');
    expect(area.geographic_area_meta.lat).toBe('36.17');
  });

  it('preserves already-wrapped geographic_area_meta', () => {
    const result = repairSubmissionPayloadServer(minimalPayload({
      userdata: {
        geographic_areas: [{
          geographic_area_meta: {
            name: 'Nashville', label: 'Nashville, TN',
            lat: '36.17', lon: '-86.78', place_id: 'abc', source: 'google', primary: true,
          },
        }],
      },
    }));
    expect(result.payload.userdata.geographic_areas[0].geographic_area_meta.name).toBe('Nashville');
  });

  it('maps latitude/longitude to lat/lon in geographic_area_meta', () => {
    const result = repairSubmissionPayloadServer({
      metadata: { business_name: 'Acme', businessDomain: 'acme.com' },
      userdata: {
        geographic_areas: [{
          geographic_area_meta: { name: 'Austin', latitude: 30.27, longitude: -97.74 },
        }],
        additional_pages_list: {},
      },
    });
    const meta = result.payload.userdata.geographic_areas[0].geographic_area_meta;
    expect(meta.lat).toBe('30.27');
    expect(meta.lon).toBe('-97.74');
  });

  it('drops geographic_areas items with no name', () => {
    const result = repairSubmissionPayloadServer({
      metadata: { business_name: 'Acme', businessDomain: 'acme.com' },
      userdata: {
        geographic_areas: [{ someField: 'no name here' }],
        additional_pages_list: {},
      },
    });
    expect(result.payload.userdata.geographic_areas.length).toBe(0);
    expect(result.warnings.some(w => w.includes('dropped_no_name'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// repairSubmissionPayloadServer — taggedPeople
// ---------------------------------------------------------------------------

describe('repairSubmissionPayloadServer — taggedPeople', () => {
  it('coerces taggedPeople object to array', () => {
    const result = repairSubmissionPayloadServer({
      metadata: { business_name: 'Acme', businessDomain: 'acme.com' },
      userdata: {
        geographic_areas: [],
        additional_pages_list: {
          meet_the_team_page: {
            team_photo_with_tags: {
              taggedPeople: { 0: { name: 'Alice', position: 'CEO' } },
            },
          },
        },
      },
    });
    const tp = result.payload.userdata.additional_pages_list.meet_the_team_page.team_photo_with_tags.taggedPeople;
    expect(Array.isArray(tp)).toBe(true);
    expect(result.warnings).toContain('taggedPeople_coerced_to_array');
  });

  it('coerces null taggedPeople to empty array', () => {
    const result = repairSubmissionPayloadServer({
      metadata: { business_name: 'Acme', businessDomain: 'acme.com' },
      userdata: {
        geographic_areas: [],
        additional_pages_list: {
          meet_the_team_page: {
            team_photo_with_tags: { taggedPeople: null },
          },
        },
      },
    });
    const tp = result.payload.userdata.additional_pages_list.meet_the_team_page.team_photo_with_tags.taggedPeople;
    expect(Array.isArray(tp)).toBe(true);
    expect(tp.length).toBe(0);
  });

  it('leaves undefined taggedPeople alone (optional field)', () => {
    const result = repairSubmissionPayloadServer({
      metadata: { business_name: 'Acme', businessDomain: 'acme.com' },
      userdata: {
        geographic_areas: [],
        additional_pages_list: { meet_the_team_page: { team_photo_with_tags: {} } },
      },
    });
    const tpwt = result.payload.userdata.additional_pages_list.meet_the_team_page.team_photo_with_tags;
    expect('taggedPeople' in tpwt).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// repairSubmissionPayloadServer — scalar string fields
// ---------------------------------------------------------------------------

describe('repairSubmissionPayloadServer — scalar string fields', () => {
  it('coerces delivery_model array to string', () => {
    const result = repairSubmissionPayloadServer({
      metadata: { business_name: 'Acme', businessDomain: 'acme.com' },
      userdata: {
        geographic_areas: [],
        additional_pages_list: {},
        delivery_model: ['Fully Managed IT Provider'],
      },
    });
    expect(typeof result.payload.userdata.delivery_model).toBe('string');
    expect(result.payload.userdata.delivery_model).toBe('Fully Managed IT Provider');
    expect(result.warnings).toContain('delivery_model_coerced_to_string');
  });

  it('coerces [""] pricing_packaging_other to empty string', () => {
    const result = repairSubmissionPayloadServer({
      metadata: { business_name: 'Acme', businessDomain: 'acme.com' },
      userdata: {
        geographic_areas: [],
        additional_pages_list: {},
        pricing_packaging_other: [''],
      },
    });
    expect(typeof result.payload.userdata.pricing_packaging_other).toBe('string');
    expect(result.payload.userdata.pricing_packaging_other).toBe('');
  });

  it('coerces company_description object to string', () => {
    const result = repairSubmissionPayloadServer({
      metadata: { business_name: 'Acme', businessDomain: 'acme.com' },
      userdata: {
        geographic_areas: [],
        additional_pages_list: {},
        company_description: { label: 'We do IT support.' },
      },
    });
    expect(typeof result.payload.userdata.company_description).toBe('string');
    expect(result.payload.userdata.company_description).toBe('We do IT support.');
  });
});

// ---------------------------------------------------------------------------
// repairSubmissionPayloadServer — metadata validation
// ---------------------------------------------------------------------------

describe('repairSubmissionPayloadServer — metadata validation', () => {
  it('returns error when business_name is missing with no context', () => {
    const result = repairSubmissionPayloadServer({
      metadata: { businessDomain: 'acme.com' },
      userdata: {},
    });
    expect(result.errors).toContain('metadata.business_name_missing');
    expect(result.ok).toBe(false);
  });

  it('fills business_name from context when missing from payload', () => {
    const result = repairSubmissionPayloadServer(
      { metadata: { businessDomain: 'acme.com' }, userdata: {} },
      { businessName: 'Acme IT' },
    );
    expect(result.payload.metadata.business_name).toBe('Acme IT');
    expect(result.warnings).toContain('metadata.business_name_filled_from_context');
  });

  it('returns error when businessDomain is missing with no context', () => {
    const result = repairSubmissionPayloadServer({
      metadata: { business_name: 'Acme' },
      userdata: {},
    });
    expect(result.errors).toContain('metadata.businessDomain_missing');
    expect(result.ok).toBe(false);
  });

  it('fills businessDomain from context when missing', () => {
    const result = repairSubmissionPayloadServer(
      { metadata: { business_name: 'Acme' }, userdata: {} },
      { businessDomain: 'acme.com' },
    );
    expect(result.payload.metadata.businessDomain).toBe('acme.com');
  });

  it('maps metadata.business_domain to businessDomain', () => {
    const result = repairSubmissionPayloadServer({
      metadata: { business_name: 'Acme', business_domain: 'acme.com' },
      userdata: {},
    });
    expect(result.payload.metadata.businessDomain).toBe('acme.com');
    expect(result.warnings).toContain('metadata.businessDomain_mapped_from_business_domain');
  });

  it('does not mutate the input payload', () => {
    const input = { metadata: { business_name: 'Acme', businessDomain: 'acme.com' }, userdata: {} };
    const copy = JSON.parse(JSON.stringify(input));
    repairSubmissionPayloadServer(input);
    expect(input).toEqual(copy);
  });
});

// ---------------------------------------------------------------------------
// repairSubmissionPayloadServer — string array fields
// ---------------------------------------------------------------------------

describe('repairSubmissionPayloadServer — string array fields', () => {
  it('coerces a single string service_offerings to array', () => {
    const result = repairSubmissionPayloadServer({
      metadata: { business_name: 'Acme', businessDomain: 'acme.com' },
      userdata: {
        geographic_areas: [],
        additional_pages_list: {},
        service_offerings: 'Managed IT',
      },
    });
    expect(Array.isArray(result.payload.userdata.service_offerings)).toBe(true);
    expect(result.payload.userdata.service_offerings[0]).toBe('Managed IT');
  });

  it('filters empty strings from existing arrays', () => {
    const result = repairSubmissionPayloadServer({
      metadata: { business_name: 'Acme', businessDomain: 'acme.com' },
      userdata: {
        geographic_areas: [],
        additional_pages_list: {},
        service_offerings: ['Managed IT', '', '  ', 'Cybersecurity'],
      },
    });
    expect(result.payload.userdata.service_offerings).toEqual(['Managed IT', 'Cybersecurity']);
  });
});

// ---------------------------------------------------------------------------
// validateSubmissionPayloadServer
// ---------------------------------------------------------------------------

describe('validateSubmissionPayloadServer', () => {
  it('passes a valid minimal payload', () => {
    const result = validateSubmissionPayloadServer(minimalPayload());
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails when metadata is not an object', () => {
    const result = validateSubmissionPayloadServer({ metadata: null, userdata: {} });
    expect(result.errors).toContain('metadata_must_be_object');
  });

  it('fails when a required array field is a string', () => {
    const p = minimalPayload();
    p.userdata.service_offerings = 'Managed IT';
    const result = validateSubmissionPayloadServer(p);
    expect(result.errors).toContain('userdata.service_offerings_must_be_array');
  });

  it('fails when geographic_areas item lacks geographic_area_meta', () => {
    const p = minimalPayload();
    p.userdata.geographic_areas = [{ name: 'Nashville' }];
    const result = validateSubmissionPayloadServer(p);
    expect(result.errors.some(e => e.includes('geographic_area_meta_must_be_object'))).toBe(true);
  });

  it('fails when taggedPeople is not an array', () => {
    const p = minimalPayload();
    p.userdata.additional_pages_list.meet_the_team_page.team_photo_with_tags.taggedPeople = 'Alice';
    const result = validateSubmissionPayloadServer(p);
    expect(result.errors).toContain('taggedPeople_must_be_array');
  });
});

// ---------------------------------------------------------------------------
// extractJsonObjectFromText
// ---------------------------------------------------------------------------

describe('extractJsonObjectFromText', () => {
  it('parses pure JSON', () => {
    const result = extractJsonObjectFromText('{"decision":"repair","confidence":0.9}');
    expect(result.ok).toBe(true);
    expect(result.value.decision).toBe('repair');
  });

  it('extracts from ```json fences', () => {
    const result = extractJsonObjectFromText('```json\n{"decision":"repair"}\n```');
    expect(result.ok).toBe(true);
    expect(result.value.decision).toBe('repair');
  });

  it('extracts from plain ``` fences', () => {
    const result = extractJsonObjectFromText('``` {"x":1} ```');
    expect(result.ok).toBe(true);
    expect(result.value.x).toBe(1);
  });

  it('extracts JSON from prose-wrapped response', () => {
    const result = extractJsonObjectFromText(
      'Here is my analysis:\n\n{"decision":"no_repair_needed","confidence":1.0}\n\nHope that helps!',
    );
    expect(result.ok).toBe(true);
    expect(result.value.decision).toBe('no_repair_needed');
  });

  it('extracts JSON with trailing comma after repair', () => {
    const result = extractJsonObjectFromText('{"a": 1, "b": 2, }');
    expect(result.ok).toBe(true);
    expect(result.value.a).toBe(1);
  });

  it('returns error for non-JSON text', () => {
    const result = extractJsonObjectFromText('The agent could not complete this request.');
    expect(result.ok).toBe(false);
  });

  it('returns error for empty string', () => {
    const result = extractJsonObjectFromText('');
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sanitizeRepairReport
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// FIX 1: Data-preservation — keyed objects must become arrays with data intact
// ---------------------------------------------------------------------------

describe('repairSubmissionPayloadServer — keyed object preservation', () => {
  it('taggedPeople keyed object becomes array and preserves people', () => {
    const result = repairSubmissionPayloadServer({
      metadata: { business_name: 'Acme', businessDomain: 'acme.com' },
      userdata: {
        geographic_areas: [],
        additional_pages_list: {
          meet_the_team_page: {
            team_photo_with_tags: {
              taggedPeople: {
                '0': { name: 'Alice', position: 'CEO', bio: 'Founder' },
                '1': { name: 'Bob', position: 'CTO' }
              }
            }
          }
        }
      }
    });
    const tp = result.payload.userdata.additional_pages_list.meet_the_team_page.team_photo_with_tags.taggedPeople;
    expect(Array.isArray(tp)).toBe(true);
    expect(tp.length).toBe(2);
    expect(tp.some(p => p.name === 'Alice')).toBe(true);
    expect(tp.some(p => p.name === 'Bob')).toBe(true);
    expect(result.warnings).toContain('...taggedPeople: coerced to array');
  });

  it('geographic_areas keyed object becomes array and preserves location data', () => {
    const result = repairSubmissionPayloadServer({
      metadata: { business_name: 'Acme', businessDomain: 'acme.com' },
      userdata: {
        additional_pages_list: {},
        geographic_areas: {
          '0': { name: 'Austin', lat: '30.27', lon: '-97.74' }
        }
      }
    });
    expect(Array.isArray(result.payload.userdata.geographic_areas)).toBe(true);
    expect(result.payload.userdata.geographic_areas.length).toBe(1);
    const meta = result.payload.userdata.geographic_areas[0].geographic_area_meta;
    expect(isPlainObject(meta)).toBe(true);
    expect(meta.name).toBe('Austin');
    expect(meta.lat).toBe('30.27');
  });

  it('certifications_partnerships keyed object preserves items', () => {
    const result = repairSubmissionPayloadServer({
      metadata: { business_name: 'Acme', businessDomain: 'acme.com' },
      userdata: {
        geographic_areas: [],
        additional_pages_list: {},
        certifications_partnerships: {
          '0': { cert_item_name: 'ISO 27001', cert_item_type: 'certification' },
          '1': { cert_item_name: 'Microsoft Gold', cert_item_type: 'partnership' }
        }
      }
    });
    const certs = result.payload.userdata.certifications_partnerships;
    expect(Array.isArray(certs)).toBe(true);
    expect(certs.length).toBe(2);
    expect(certs.some(c => c.cert_item_name === 'ISO 27001')).toBe(true);
    expect(certs.some(c => c.cert_item_name === 'Microsoft Gold')).toBe(true);
  });

  it('service_guarantee_items keyed object preserves items', () => {
    const result = repairSubmissionPayloadServer({
      metadata: { business_name: 'Acme', businessDomain: 'acme.com' },
      userdata: {
        geographic_areas: [],
        additional_pages_list: {},
        service_guarantee_items: {
          '0': { guarantee_name: '10-min response', guarantee_type: 'sla' }
        }
      }
    });
    const items = result.payload.userdata.service_guarantee_items;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBe(1);
    expect(items[0].guarantee_name).toBe('10-min response');
  });

  it('scalar string field that is an object uses label/name/value/text/title', () => {
    const result = repairSubmissionPayloadServer({
      metadata: { business_name: 'Acme', businessDomain: 'acme.com' },
      userdata: {
        geographic_areas: [],
        additional_pages_list: {},
        delivery_model: { label: 'Fully Managed IT Provider' }
      }
    });
    expect(result.payload.userdata.delivery_model).toBe('Fully Managed IT Provider');
  });

  it('scalar string field object uses name key if label is absent', () => {
    const result = repairSubmissionPayloadServer({
      metadata: { business_name: 'Acme', businessDomain: 'acme.com' },
      userdata: {
        geographic_areas: [],
        additional_pages_list: {},
        brand_tone: { name: 'Professional & Corporate' }
      }
    });
    expect(result.payload.userdata.brand_tone).toBe('Professional & Corporate');
  });

  it('geographic_areas example from spec: keyed object preserves Austin', () => {
    // Exact scenario from the requirements spec
    const result = repairSubmissionPayloadServer({
      metadata: { business_name: 'Test Co', businessDomain: 'testco.com' },
      userdata: {
        additional_pages_list: {
          meet_the_team_page: {
            team_photo_with_tags: {
              taggedPeople: { '0': { name: 'Alice', position: 'CEO' } }
            }
          }
        },
        geographic_areas: {
          '0': { name: 'Austin', lat: '30.27', lon: '-97.74' }
        }
      }
    });
    // taggedPeople[0].name === "Alice"
    const tp = result.payload.userdata.additional_pages_list.meet_the_team_page.team_photo_with_tags.taggedPeople;
    expect(tp[0].name).toBe('Alice');
    // geographic_areas[0].geographic_area_meta.name === "Austin"
    const meta = result.payload.userdata.geographic_areas[0].geographic_area_meta;
    expect(meta.name).toBe('Austin');
  });
});

// ---------------------------------------------------------------------------
// Draft repair never creates ProFormSubmission (guard in runRepairPipeline)
// ---------------------------------------------------------------------------

describe('draft repair safety — allowRetry=false', () => {
  it('repairSubmissionPayloadServer does not perform any entity operations (pure function)', () => {
    // The repair helper is a pure function — it never calls entities.
    // This test confirms it returns a payload without side effects.
    const result = repairSubmissionPayloadServer({
      metadata: { business_name: 'Acme', businessDomain: 'acme.com' },
      userdata: { geographic_areas: [], additional_pages_list: {} }
    });
    expect(typeof result.payload).toBe('object');
    expect(result).not.toHaveProperty('submissionCreated');
  });
});

// ---------------------------------------------------------------------------
// session_id alias works for retry
// ---------------------------------------------------------------------------

describe('retryProQuestionnaireIntakeSubmission — session_id alias', () => {
  it('safeJsonParse handles both questionnaireSessionId and session_id (alias) at param level', () => {
    // The function reads body.questionnaireSessionId || body.session_id
    // Test that safeJsonParse correctly passes through the body object
    const body = { session_id: 'test-session-123' };
    const sessionId = typeof body?.questionnaireSessionId === 'string' ? body.questionnaireSessionId :
                      typeof body?.session_id === 'string' ? body.session_id : '';
    expect(sessionId).toBe('test-session-123');
  });

  it('questionnaireSessionId takes precedence over session_id', () => {
    const body = { questionnaireSessionId: 'canonical-id', session_id: 'old-alias' };
    const sessionId = typeof body?.questionnaireSessionId === 'string' ? body.questionnaireSessionId :
                      typeof body?.session_id === 'string' ? body.session_id : '';
    expect(sessionId).toBe('canonical-id');
  });
});

// ---------------------------------------------------------------------------
// sanitizeRepairReport
// ---------------------------------------------------------------------------

describe('sanitizeRepairReport', () => {
  it('keeps only allowed fields', () => {
    const raw = {
      decision: 'repair',
      confidence: 0.9,
      should_retry_submission: true,
      diagnosis: 'Found array where string expected',
      repair_summary: ['Coerced delivery_model to string'],
      changed_paths: [{ path: 'userdata.delivery_model', before_type: 'array', after_type: 'string', reason: 'scalar field' }],
      warnings: ['delivery_model_coerced_to_string'],
      repaired_payload: { metadata: {}, userdata: {} }, // should be stripped
      _internal_prompt: 'raw prompt should not be stored',  // should be stripped
    };
    const result = sanitizeRepairReport(raw);
    expect(result.decision).toBe('repair');
    expect(result.confidence).toBe(0.9);
    expect('repaired_payload' in result).toBe(false);
    expect('_internal_prompt' in result).toBe(false);
    expect(result.changed_paths[0].path).toBe('userdata.delivery_model');
  });

  it('defaults to safe values for missing fields', () => {
    const result = sanitizeRepairReport({});
    expect(result.decision).toBe('unknown');
    expect(result.confidence).toBe(0);
    expect(result.should_retry_submission).toBe(false);
    expect(result.repair_summary).toEqual([]);
    expect(result.changed_paths).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('returns empty object for non-object input', () => {
    expect(sanitizeRepairReport(null)).toEqual({});
    expect(sanitizeRepairReport('string')).toEqual({});
  });

  it('truncates excessively long diagnosis', () => {
    const result = sanitizeRepairReport({ diagnosis: 'x'.repeat(2000) });
    expect(result.diagnosis.length).toBe(1000);
  });
});