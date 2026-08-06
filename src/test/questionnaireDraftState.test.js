import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DRAFT_FIELD_OPERATIONS,
  DRAFT_STATE_ERROR_CODES,
  DRAFT_STATE_SOURCE_TYPES,
  DRAFT_STATE_STATUS_VALUES,
  DraftStateSerializationError,
  DraftStateValidationError,
  PRO_FORM_DRAFT_SCHEMA_MIN_SUPPORTED_VERSION,
  PRO_FORM_DRAFT_SCHEMA_VERSION,
  areCanonicalDraftStatesCompatible,
  buildCanonicalFieldPath,
  cloneCanonicalDraftState,
  compareCanonicalDraftFreshness,
  createEmptyCanonicalDraftState,
  extractCanonicalStateFromLegacyDraftRecord,
  extractCanonicalStateFromLegacyRedux,
  getCanonicalDraftStateByteSize,
  getSafeCanonicalDraftDiagnostics,
  hashCanonicalDraftState,
  isPlainDraftObject,
  migrateCanonicalDraftState,
  normalizeCanonicalDraftState,
  normalizeFieldChangeMetadata,
  parseCanonicalDraftState,
  sanitizeDraftSerializableValue,
  serializeCanonicalDraftState,
  stableStringifyCanonicalDraftState,
  validateCanonicalDraftState,
} from '@/lib/questionnaireDraftState';

const completeState = (overrides = {}) => normalizeCanonicalDraftState({
  ...createEmptyCanonicalDraftState({
    draftId: 'draft-1',
    sessionId: 'session-1',
    sourceTabId: 'tab-1',
    credentials: {
      userId: 'user-1',
      userEmail: 'synthetic@example.test',
      userName: 'Synthetic User',
      businessName: 'Synthetic Business',
      domain: 'synthetic.example.test',
    },
  }),
  responses: {
    '6': 'Synthetic response text',
    '3': ['Managed service', 'Security'],
  },
  validationStatus: { '6': 'complete' },
  touchedQuestions: { '6': true },
  expandedQuestions: { '6': true },
  textValidationMeta: {
    '6': { lastValidatedValue: 'Synthetic response text', isDirty: false },
  },
  uiDraftState: {
    '/responses/12.1/editor/0': {
      kind: 'certification-editor',
      version: 1,
      data: { name: 'Synthetic certification' },
      updatedAtClient: '2026-08-05T12:00:00.000Z',
      sourceTabId: 'tab-1',
    },
  },
  fieldChangeMetadata: {
    '/responses/6': {
      operation: 'set',
      clientRevision: 2,
      serverRevision: 1,
      changedAtClient: '2026-08-05T12:00:00.000Z',
      sourceTabId: 'tab-1',
      mutationId: 'mutation-1',
    },
  },
  currentQuestionId: '6',
  lastChangedQuestionId: '6',
  clientRevision: 2,
  serverRevision: 1,
  savedAtClient: '2026-08-05T12:00:00.000Z',
  savedAtServer: '2026-08-05T12:00:01.000Z',
  lastMutation: {
    mutationId: 'mutation-1',
    mutationType: 'answer_changed',
    reason: 'questionnaire_edit',
    changedAtClient: '2026-08-05T12:00:00.000Z',
    sourceTabId: 'tab-1',
  },
  ...overrides,
});

const reorderObject = (value, rotation = 0) => {
  if (Array.isArray(value)) return value.map((item) => reorderObject(item, rotation + 1));
  if (!isPlainDraftObject(value)) return value;
  const keys = Object.keys(value);
  const ordered = keys.length === 0
    ? []
    : [...keys.slice(rotation % keys.length), ...keys.slice(0, rotation % keys.length)].reverse();
  return ordered.reduce((output, key) => {
    output[key] = reorderObject(value[key], rotation + 1);
    return output;
  }, {});
};

describe('canonical draft-state constants and empty state', () => {
  it('uses independently versioned schema 4 with v2 as the minimum', () => {
    expect(PRO_FORM_DRAFT_SCHEMA_VERSION).toBe(4);
    expect(PRO_FORM_DRAFT_SCHEMA_MIN_SUPPORTED_VERSION).toBe(2);
    expect(DRAFT_STATE_STATUS_VALUES).toContain('submitted');
    expect(DRAFT_FIELD_OPERATIONS).toEqual(['set', 'delete', 'reset', 'merge']);
  });

  it('creates the complete empty canonical envelope', () => {
    const state = createEmptyCanonicalDraftState();
    expect(Object.keys(state)).toEqual([
      'schemaVersion', 'formType', 'draftId', 'sessionId', 'draftStatus',
      'clientRevision', 'serverRevision', 'savedAtClient', 'savedAtServer',
      'sourceTabId', 'responses', 'validationStatus', 'touchedQuestions',
      'expandedQuestions', 'textValidationMeta', 'credentials', 'uiDraftState',
      'fieldChangeMetadata', 'currentQuestionId', 'lastChangedQuestionId',
      'lastMutation', 'submission', 'compatibility',
    ]);
    expect(state).toMatchObject({
      schemaVersion: 4,
      formType: 'pro-questionnaire',
      draftStatus: 'active',
      clientRevision: 0,
      serverRevision: 0,
      responses: {},
    });
  });

  it('returns fresh nested objects on every call', () => {
    const first = createEmptyCanonicalDraftState();
    const second = createEmptyCanonicalDraftState();
    expect(first).not.toBe(second);
    expect(first.responses).not.toBe(second.responses);
    expect(first.submission).not.toBe(second.submission);
    expect(first.compatibility.migrationWarnings)
      .not.toBe(second.compatibility.migrationWarnings);
  });

  it('normalizes safe options and freezes only when explicitly requested', () => {
    const state = createEmptyCanonicalDraftState({
      sessionId: ' session-2 ',
      credentials: { businessName: ' Synthetic ' },
      freeze: true,
    });
    expect(state.sessionId).toBe('session-2');
    expect(state.credentials.businessName).toBe('Synthetic');
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.responses)).toBe(true);
    expect(Object.isFrozen(createEmptyCanonicalDraftState())).toBe(false);
  });

  it('rejects secret-bearing creation options', () => {
    expect(() => createEmptyCanonicalDraftState({ recoveryCode: 'not-stored' }))
      .toThrowError(DraftStateValidationError);
  });
});

describe('serializability sanitizer', () => {
  it('clones allowed JSON values without mutating input', () => {
    const input = { text: 'exact ', flag: true, count: 2, nested: [null, { ok: 'yes' }] };
    const output = sanitizeDraftSerializableValue(input);
    expect(output).toEqual(input);
    expect(output).not.toBe(input);
    expect(output.nested).not.toBe(input.nested);
  });

  it('supports explicit object-property undefined omission but never array omission', () => {
    expect(sanitizeDraftSerializableValue({ keep: 1, omit: undefined }, {
      omitUndefined: true,
    })).toEqual({ keep: 1 });
    expect(() => sanitizeDraftSerializableValue([undefined], { omitUndefined: true }))
      .toThrowError(DraftStateSerializationError);
  });

  it('rejects undefined in strict mode', () => {
    expect(() => sanitizeDraftSerializableValue({ answer: undefined }))
      .toThrowError(DraftStateSerializationError);
  });

  it.each([
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
    ['BigInt', 1n],
    ['Symbol', Symbol('synthetic')],
    ['Function', () => 'synthetic'],
    ['RegExp', /synthetic/],
    ['Map', new Map([['synthetic', 1]])],
    ['Set', new Set(['synthetic'])],
    ['WeakMap', new WeakMap()],
    ['WeakSet', new WeakSet()],
    ['Error', new Error('synthetic response must not appear')],
    ['Promise', Promise.resolve('synthetic')],
    ['ArrayBuffer', new ArrayBuffer(8)],
    ['AbortController', new AbortController()],
  ])('rejects %s', (_label, value) => {
    expect(() => sanitizeDraftSerializableValue({ answer: value }))
      .toThrowError(DraftStateSerializationError);
  });

  it('rejects Date unless an explicit normalization path is selected', () => {
    const date = new Date('2026-08-05T12:00:00Z');
    expect(() => sanitizeDraftSerializableValue({ date }))
      .toThrowError(DraftStateSerializationError);
    expect(sanitizeDraftSerializableValue({ date }, { normalizeDates: true }))
      .toEqual({ date: '2026-08-05T12:00:00.000Z' });
  });

  it('rejects custom class instances', () => {
    class SyntheticPlace { constructor() { this.label = 'Synthetic'; } }
    expect(() => sanitizeDraftSerializableValue(new SyntheticPlace()))
      .toThrowError(DraftStateSerializationError);
  });

  it('rejects File, Blob, FileList, DOM nodes, and Events', () => {
    expect(() => sanitizeDraftSerializableValue(new File(['x'], 'synthetic.txt')))
      .toThrowError(DraftStateSerializationError);
    expect(() => sanitizeDraftSerializableValue(new Blob(['x'])))
      .toThrowError(DraftStateSerializationError);
    const input = document.createElement('input');
    input.type = 'file';
    expect(() => sanitizeDraftSerializableValue(input.files))
      .toThrowError(DraftStateSerializationError);
    expect(() => sanitizeDraftSerializableValue(document.createElement('div')))
      .toThrowError(DraftStateSerializationError);
    expect(() => sanitizeDraftSerializableValue(new Event('change')))
      .toThrowError(DraftStateSerializationError);
  });

  it('rejects circular references with a value-free safe path', () => {
    const input = { response: 'must-never-appear-in-error' };
    input.self = input;
    let thrown;
    try { sanitizeDraftSerializableValue(input); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(DraftStateSerializationError);
    expect(thrown.code).toBe(DRAFT_STATE_ERROR_CODES.CIRCULAR_REFERENCE);
    expect(thrown.message).not.toContain(input.response);
  });

  it('rejects accessors without evaluating them', () => {
    let called = false;
    const input = {};
    Object.defineProperty(input, 'answer', {
      enumerable: true,
      get() { called = true; return 'synthetic'; },
    });
    expect(() => sanitizeDraftSerializableValue(input))
      .toThrowError(DraftStateSerializationError);
    expect(called).toBe(false);
  });

  it('enforces maximum depth and property count', () => {
    expect(() => sanitizeDraftSerializableValue({ a: { b: 1 } }, { maxDepth: 1 }))
      .toThrowError(expect.objectContaining({
        code: DRAFT_STATE_ERROR_CODES.MAX_DEPTH_EXCEEDED,
      }));
    expect(() => sanitizeDraftSerializableValue({ a: 1, b: 2 }, { maxProperties: 1 }))
      .toThrowError(expect.objectContaining({
        code: DRAFT_STATE_ERROR_CODES.MAX_PROPERTIES_EXCEEDED,
      }));
  });
});

describe('canonical validation and normalization', () => {
  it('validates a complete current state', () => {
    expect(validateCanonicalDraftState(completeState())).toMatchObject({
      valid: true,
      errorCode: null,
      issues: [],
    });
  });

  it('returns typed issues for missing fields without throwing', () => {
    const result = validateCanonicalDraftState({ schemaVersion: 4 });
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe(DRAFT_STATE_ERROR_CODES.INVALID_FIELD);
    expect(result.issues.length).toBeGreaterThan(1);
  });

  it('reports unknown fields and removes them during normalization', () => {
    const input = { ...completeState(), unknownEnvelopeValue: 'synthetic' };
    expect(validateCanonicalDraftState(input).errorCode)
      .toBe(DRAFT_STATE_ERROR_CODES.UNKNOWN_FIELD);
    const normalized = normalizeCanonicalDraftState(input, { reportUnknownFields: true });
    expect(normalized).not.toHaveProperty('unknownEnvelopeValue');
    expect(normalized.compatibility.migrationWarnings)
      .toContain('UNKNOWN_TOP_LEVEL_FIELD:UNKNOWNENVELOPEVALUE');
  });

  it('supports a fail-closed strict server normalization mode', () => {
    expect(() => normalizeCanonicalDraftState({
      ...completeState(),
      formType: 'arbitrary-client-form',
    }, { strictServer: true })).toThrowError(DraftStateValidationError);
    expect(() => normalizeCanonicalDraftState({
      ...completeState(),
      unknownServerField: true,
    }, { strictServer: true })).toThrowError(expect.objectContaining({
      code: DRAFT_STATE_ERROR_CODES.UNKNOWN_FIELD,
    }));
  });

  it('rejects invalid, future, and ancient schema versions with typed codes', () => {
    expect(validateCanonicalDraftState({ ...completeState(), schemaVersion: '4' }).errorCode)
      .toBe(DRAFT_STATE_ERROR_CODES.INVALID_SCHEMA_VERSION);
    expect(() => normalizeCanonicalDraftState({ ...completeState(), schemaVersion: 5 }))
      .toThrowError(expect.objectContaining({
        code: DRAFT_STATE_ERROR_CODES.UNSUPPORTED_FUTURE_VERSION,
      }));
    expect(() => normalizeCanonicalDraftState({ ...completeState(), schemaVersion: 1 }))
      .toThrowError(expect.objectContaining({
        code: DRAFT_STATE_ERROR_CODES.UNSUPPORTED_LEGACY_VERSION,
      }));
  });

  it('preserves serializable response values exactly', () => {
    const responses = {
      '6': '  exact whitespace  ',
      '5': [{ label: 'Synthetic', latitude: 0, longitude: -0 }],
    };
    expect(normalizeCanonicalDraftState({ ...completeState(), responses }).responses)
      .toEqual(responses);
  });

  it('normalizes boolean maps and rejects non-booleans', () => {
    expect(normalizeCanonicalDraftState({
      ...completeState(),
      touchedQuestions: { '6': false },
    }).touchedQuestions).toEqual({ '6': false });
    expect(() => normalizeCanonicalDraftState({
      ...completeState(),
      touchedQuestions: { '6': 'true' },
    })).toThrowError(DraftStateValidationError);
  });

  it('allows only approved credentials and rejects secret-looking keys', () => {
    const normalized = normalizeCanonicalDraftState({
      ...completeState(),
      credentials: {
        businessName: 'Synthetic',
        domainName: 'example.test',
        ignoredNonSecretField: 'ignored',
      },
    });
    expect(normalized.credentials).toEqual({
      businessName: 'Synthetic',
      domainName: 'example.test',
    });
    expect(() => normalizeCanonicalDraftState({
      ...completeState(),
      credentials: { recoveryCodeHash: 'must-not-store' },
    })).toThrowError(expect.objectContaining({
      code: DRAFT_STATE_ERROR_CODES.SECRET_BEARING_FIELD,
    }));
  });

  it('validates scoped UI draft entries', () => {
    expect(completeState().uiDraftState['/responses/12.1/editor/0'])
      .toMatchObject({ kind: 'certification-editor', version: 1 });
    expect(() => normalizeCanonicalDraftState({
      ...completeState(),
      uiDraftState: { '/responses/6': { kind: 'text', version: 0, data: {} } },
    })).toThrowError(DraftStateValidationError);
  });

  it('validates field change metadata and builds escaped JSON Pointer paths', () => {
    expect(buildCanonicalFieldPath('responses', 'custom/field', '~draft'))
      .toBe('/responses/custom~1field/~0draft');
    expect(normalizeFieldChangeMetadata(completeState().fieldChangeMetadata))
      .toEqual(completeState().fieldChangeMetadata);
    expect(() => normalizeFieldChangeMetadata({
      '/responses/6': { operation: 'overwrite' },
    })).toThrowError(DraftStateValidationError);
  });

  it('does not mutate input and deep-clones output', () => {
    const input = completeState();
    const before = serializeCanonicalDraftState(input);
    const normalized = normalizeCanonicalDraftState(input);
    normalized.responses['6'] = 'Changed clone';
    expect(serializeCanonicalDraftState(input)).toBe(before);
    expect(input.responses['6']).toBe('Synthetic response text');
    expect(normalized.responses).not.toBe(input.responses);
  });
});

describe('legacy migration', () => {
  it('migrates schema v2 step-by-step through v3 to v4', () => {
    const migrated = migrateCanonicalDraftState({
      schemaVersion: 2,
      responses: { '6': 'Legacy v2 response' },
      validationStatus: { '6': 'complete' },
      touchedQuestions: { '6': true },
      expandedQuestions: { '6': false },
      credentials: { businessName: 'Synthetic Legacy' },
    });
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.responses['6']).toBe('Legacy v2 response');
    expect(migrated.compatibility).toMatchObject({
      sourceType: DRAFT_STATE_SOURCE_TYPES.REDUX_PERSIST_V2,
      sourceVersion: 2,
    });
    expect(migrated.compatibility.migrationWarnings).toEqual(expect.arrayContaining([
      'MIGRATED_SCHEMA_V2_TO_V3',
      'MIGRATED_SCHEMA_V3_TO_V4',
    ]));
  });

  it('migrates schema v3 directly to v4', () => {
    const migrated = migrateCanonicalDraftState({
      schemaVersion: 3,
      responses: { '6': 'Legacy v3 response' },
      validationStatus: {},
      touchedQuestions: {},
      expandedQuestions: {},
      textValidationMeta: {},
    });
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.compatibility.sourceType)
      .toBe(DRAFT_STATE_SOURCE_TYPES.REDUX_PERSIST_V3);
  });

  it('extracts legacy Redux and loadInitialState form maps', () => {
    const input = {
      form: {
        responses: { '6': 'Legacy Redux response' },
        validationStatus: { '6': 'needs_work' },
        touchedQuestions: { '6': true },
        expandedQuestions: { '6': false },
        textValidationMeta: { '6': { isDirty: true } },
        credentials: { userName: 'Synthetic User' },
        _persist: { version: 3, rehydrated: true },
      },
      questionnaireSessionId: 'legacy-session',
    };
    const migrated = extractCanonicalStateFromLegacyRedux(input, {
      sourceType: DRAFT_STATE_SOURCE_TYPES.LOAD_INITIAL_STATE,
    });
    expect(migrated).toMatchObject({
      sessionId: 'legacy-session',
      responses: { '6': 'Legacy Redux response' },
      credentials: { userName: 'Synthetic User' },
    });
  });

  it('extracts the current browser failure-backup shape', () => {
    const migrated = extractCanonicalStateFromLegacyRedux({
      namespaceVersion: 4,
      sessionId: 'backup-session',
      savedAt: '2026-08-05T12:00:00Z',
      storageMode: 'localstorage',
      form: {
        responses: { '6': 'Backup response' },
        validationStatus: {},
        touchedQuestions: {},
        expandedQuestions: {},
        textValidationMeta: {},
      },
    }, { sourceType: DRAFT_STATE_SOURCE_TYPES.FAILURE_BACKUP });
    expect(migrated).toMatchObject({
      sessionId: 'backup-session',
      savedAtClient: '2026-08-05T12:00:00.000Z',
      responses: { '6': 'Backup response' },
    });
  });

  it('reconstructs the current legacy Base44 draft columns', () => {
    const record = {
      id: 'draft-legacy',
      session_id: 'session-legacy',
      business_name: 'Synthetic Business',
      domain: 'synthetic.example.test',
      user_id: 'synthetic-user',
      status: 'submit_failed',
      current_question_id: '6',
      last_changed_question_id: '6',
      responses_json: JSON.stringify({ '6': 'Legacy server response' }),
      validation_status_json: JSON.stringify({ '6': 'complete' }),
      touched_questions_json: JSON.stringify({ '6': true }),
      expanded_questions_json: JSON.stringify({ '6': false }),
      metadata_json: JSON.stringify({ business_name: 'Synthetic Business' }),
      userdata_json: JSON.stringify({ company_description: 'Mapped response' }),
      draft_metadata_json: JSON.stringify({ source: 'real_time_draft' }),
      mapped_payload_json: JSON.stringify({ metadata: {}, userdata: {} }),
      last_saved_at: '2026-08-05T12:00:00Z',
      final_submission_id: 'submission-1',
      submit_error: 'unsafe full error is not retained',
    };
    const migrated = extractCanonicalStateFromLegacyDraftRecord(record);
    expect(migrated).toMatchObject({
      draftId: 'draft-legacy',
      sessionId: 'session-legacy',
      draftStatus: 'submit_failed',
      serverRevision: 0,
      responses: { '6': 'Legacy server response' },
      submission: {
        finalSubmissionId: 'submission-1',
        lastSubmissionErrorCode: 'LEGACY_SUBMISSION_ERROR',
      },
    });
    expect(serializeCanonicalDraftState(migrated)).not.toContain('unsafe full error');
  });

  it('preserves valid responses when one noncritical legacy JSON column is malformed', () => {
    const migrated = extractCanonicalStateFromLegacyDraftRecord({
      id: 'draft-legacy',
      session_id: 'session-legacy',
      responses_json: JSON.stringify({ '6': 'Preserved response' }),
      validation_status_json: '{bad-json',
      touched_questions_json: '{}',
      expanded_questions_json: '{}',
      status: 'draft',
    });
    expect(migrated.responses['6']).toBe('Preserved response');
    expect(migrated.validationStatus).toEqual({});
    expect(migrated.compatibility.migrationWarnings)
      .toContain('MALFORMED_VALIDATION_STATUS_JSON');
  });

  it('records multiple malformed legacy columns independently', () => {
    const migrated = extractCanonicalStateFromLegacyDraftRecord({
      id: 'draft-legacy',
      session_id: 'session-legacy',
      responses_json: '{bad',
      validation_status_json: '{bad',
      touched_questions_json: '{bad',
      expanded_questions_json: JSON.stringify({ '6': true }),
      metadata_json: '{bad',
      userdata_json: '{bad',
    });
    expect(migrated.responses).toEqual({});
    expect(migrated.expandedQuestions).toEqual({ '6': true });
    expect(migrated.compatibility.migrationWarnings.length).toBeGreaterThanOrEqual(5);
  });

  it('reconstructs responses from mapped userdata when responses JSON is unavailable', () => {
    const migrated = extractCanonicalStateFromLegacyDraftRecord({
      id: 'draft-legacy',
      session_id: 'session-legacy',
      responses_json: '{bad',
      mapped_payload_json: JSON.stringify({
        metadata: { business_name: 'Synthetic Business', businessDomain: 'example.test' },
        userdata: {
          company_description: 'Reconstructed description',
          service_offerings: ['Managed service'],
          service_guarantee: false,
        },
      }),
    });
    expect(migrated.responses).toMatchObject({
      '3': ['Managed service'],
      '6': 'Reconstructed description',
      '14': 'no',
    });
    expect(migrated.compatibility.migrationWarnings)
      .toContain('RESPONSES_RECONSTRUCTED_FROM_MAPPED_PAYLOAD');
  });
});

describe('stable serialization, parsing, hashing, and byte size', () => {
  it('produces identical strings across 100 object-key permutations', () => {
    const state = completeState();
    const expected = stableStringifyCanonicalDraftState(state);
    for (let index = 0; index < 100; index += 1) {
      expect(stableStringifyCanonicalDraftState(reorderObject(state, index)))
        .toBe(expected);
    }
  });

  it('preserves array order and response string content', () => {
    const first = completeState({ responses: { value: '  exact  ', list: ['a', 'b'] } });
    const second = completeState({ responses: { list: ['b', 'a'], value: '  exact  ' } });
    expect(serializeCanonicalDraftState(first)).toContain('  exact  ');
    expect(serializeCanonicalDraftState(first)).not.toBe(serializeCanonicalDraftState(second));
  });

  it('round-trips a valid canonical state', () => {
    const state = completeState();
    const result = parseCanonicalDraftState(serializeCanonicalDraftState(state));
    expect(result.ok).toBe(true);
    expect(result.state).toEqual(state);
  });

  it('returns typed diagnostics for malformed JSON without replacing last known good', () => {
    const lastKnownGoodState = completeState();
    const result = parseCanonicalDraftState('{malformed', { lastKnownGoodState });
    expect(result).toMatchObject({
      ok: false,
      state: null,
      errorCode: DRAFT_STATE_ERROR_CODES.INVALID_JSON,
    });
    expect(result.lastKnownGoodState).toEqual(lastKnownGoodState);
    expect(result.lastKnownGoodState).not.toBe(lastKnownGoodState);
  });

  it('returns a typed future-version parse failure', () => {
    const result = parseCanonicalDraftState(JSON.stringify({ schemaVersion: 999 }));
    expect(result).toMatchObject({
      ok: false,
      state: null,
      errorCode: DRAFT_STATE_ERROR_CODES.UNSUPPORTED_FUTURE_VERSION,
    });
  });

  it('hashes consistently as lowercase SHA-256 hex in Node and injected Web Crypto', async () => {
    const state = completeState();
    const nodeHash = await hashCanonicalDraftState(state);
    const injectedHash = await hashCanonicalDraftState(state, { crypto: webcrypto });
    expect(nodeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(injectedHash).toBe(nodeHash);
  });

  it('returns a typed failure when an explicitly selected crypto provider is unavailable', async () => {
    await expect(hashCanonicalDraftState(completeState(), { crypto: null }))
      .rejects.toMatchObject({
        code: DRAFT_STATE_ERROR_CODES.CRYPTO_UNAVAILABLE,
      });
  });

  it('changes hash after a response change', async () => {
    const first = completeState();
    const second = completeState({ responses: { '6': 'Different response' } });
    expect(await hashCanonicalDraftState(first))
      .not.toBe(await hashCanonicalDraftState(second));
  });

  it('keeps hash stable when only excluded timestamps and migration diagnostics change', async () => {
    const first = completeState();
    const second = completeState({
      savedAtClient: '2030-01-01T00:00:00Z',
      savedAtServer: '2030-01-01T00:00:01Z',
      compatibility: {
        sourceType: DRAFT_STATE_SOURCE_TYPES.LEGACY_REDUX,
        sourceVersion: 3,
        migratedAtClient: '2030-01-01T00:00:02Z',
        migrationWarnings: ['MIGRATED_SCHEMA_V3_TO_V4'],
      },
    });
    expect(await hashCanonicalDraftState(first)).toBe(await hashCanonicalDraftState(second));
  });

  it('calculates UTF-8 byte size instead of JavaScript character length', () => {
    const ascii = completeState({ responses: { '6': 'a' } });
    const unicode = completeState({ responses: { '6': '😀' } });
    const asciiSize = getCanonicalDraftStateByteSize(ascii);
    const unicodeSize = getCanonicalDraftStateByteSize(unicode);
    expect(unicodeSize.bytes - asciiSize.bytes).toBe(3);
    expect(unicodeSize.kilobytes).toBe(unicodeSize.bytes / 1024);
    expect(unicodeSize.withinRecommendedLimit).toBe(true);
  });
});

describe('compatibility and freshness comparison', () => {
  it('accepts the same known draft and rejects different known drafts', () => {
    expect(areCanonicalDraftStatesCompatible(
      completeState({ draftId: 'draft-a' }),
      completeState({ draftId: 'draft-a' }),
    )).toBe(true);
    expect(areCanonicalDraftStatesCompatible(
      completeState({ draftId: 'draft-a' }),
      completeState({ draftId: 'draft-b' }),
    )).toBe(false);
  });

  it('uses the session only when both draft IDs are absent', () => {
    expect(areCanonicalDraftStatesCompatible(
      completeState({ draftId: null, sessionId: 'session-a' }),
      completeState({ draftId: null, sessionId: 'session-a' }),
    )).toBe(true);
    expect(areCanonicalDraftStatesCompatible(
      completeState({ draftId: null, sessionId: 'session-a' }),
      completeState({ draftId: 'draft-a', sessionId: 'session-a' }),
    )).toBe(false);
  });

  it('protects submitted state before revision comparison', async () => {
    const result = await compareCanonicalDraftFreshness(
      completeState({ draftStatus: 'submitted', serverRevision: 1 }),
      completeState({ draftStatus: 'active', serverRevision: 99 }),
    );
    expect(result).toEqual({
      result: 'a_newer',
      reason: 'submitted_state_protection',
      compatible: true,
      requiresMerge: false,
    });
  });

  it('orders by server revision before client revision', async () => {
    const result = await compareCanonicalDraftFreshness(
      completeState({ serverRevision: 4, clientRevision: 1 }),
      completeState({ serverRevision: 3, clientRevision: 99 }),
    );
    expect(result).toMatchObject({ result: 'a_newer', reason: 'server_revision' });
  });

  it('orders by client revision after equal server revision', async () => {
    const result = await compareCanonicalDraftFreshness(
      completeState({ serverRevision: 3, clientRevision: 4 }),
      completeState({ serverRevision: 3, clientRevision: 3 }),
    );
    expect(result).toMatchObject({ result: 'a_newer', reason: 'client_revision' });
  });

  it('returns equality for equal revisions and hashes', async () => {
    const state = completeState();
    expect(await compareCanonicalDraftFreshness(state, cloneCanonicalDraftState(state)))
      .toMatchObject({ result: 'equal', reason: 'state_hash', requiresMerge: false });
  });

  it('returns divergence for equal revisions/timestamps with different hashes', async () => {
    const result = await compareCanonicalDraftFreshness(
      completeState({ responses: { '6': 'State A' } }),
      completeState({ responses: { '6': 'State B' } }),
    );
    expect(result).toMatchObject({
      result: 'diverged',
      reason: 'equal_revision_different_hash',
      requiresMerge: true,
    });
  });

  it('returns incompatible before inspecting email or business credentials', async () => {
    const sharedCredentials = {
      userEmail: 'same@example.test',
      businessName: 'Same Synthetic Business',
    };
    const result = await compareCanonicalDraftFreshness(
      completeState({ draftId: 'draft-a', credentials: sharedCredentials }),
      completeState({ draftId: 'draft-b', credentials: sharedCredentials }),
    );
    expect(result).toMatchObject({
      result: 'incompatible',
      reason: 'identity_mismatch',
      compatible: false,
    });
  });
});

describe('safe diagnostics and cloning', () => {
  it('reports only counts, presence, safe revisions, and byte size', () => {
    const state = completeState();
    const diagnostics = getSafeCanonicalDraftDiagnostics({
      state,
      hash: 'abcdef1234567890',
    });
    expect(diagnostics).toMatchObject({
      schemaVersion: 4,
      status: 'active',
      clientRevision: 2,
      serverRevision: 1,
      draftIdPresent: true,
      sessionIdPresent: true,
      responseCount: 2,
      validationCount: 1,
      uiDraftScopeCount: 1,
      metadataCount: 1,
      hashPrefix: 'abcdef123456',
    });
    const serializedDiagnostics = JSON.stringify(diagnostics);
    expect(serializedDiagnostics).not.toContain('synthetic@example.test');
    expect(serializedDiagnostics).not.toContain('Synthetic Business');
    expect(serializedDiagnostics).not.toContain('Synthetic response text');
    expect(serializedDiagnostics).not.toContain('draft-1');
  });

  it('deep-clones the full canonical state', () => {
    const state = completeState();
    const clone = cloneCanonicalDraftState(state);
    expect(clone).toEqual(state);
    expect(clone).not.toBe(state);
    expect(clone.responses).not.toBe(state.responses);
    expect(clone.uiDraftState).not.toBe(state.uiDraftState);
  });
});
