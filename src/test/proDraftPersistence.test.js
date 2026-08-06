import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_API_REQUEST_BYTES,
  DEFAULT_MAX_CANONICAL_STATE_BYTES,
  DRAFT_STATUS_TRANSITIONS,
  DRAFT_STATUS_VALUES,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  MIN_IDEMPOTENCY_KEY_LENGTH,
  PERSISTENCE_ERROR_CODES,
  PRO_DRAFT_PERSISTENCE_VERSION,
  ProDraftPersistenceError,
  assertDraftStatusTransitionAllowed,
  buildDraftCompatibilityColumns,
  buildSafeConflictProjection,
  buildSafeErrorResponse,
  buildSafeJsonResponse,
  createServerRequestId,
  evaluateRevisionWrite,
  getSafePersistenceDiagnostics,
  isDraftStatusTransitionAllowed,
  normalizeDraftLifecycleStatus,
  normalizeRevision,
  readBoundedJsonBody,
  selectCanonicalDuplicateDraft,
  validateCanonicalPayloadSize,
  validateIdempotencyKey,
  validateJsonContentType,
  validateMutationId,
  validateRequestMethod,
} from '../../base44/functions/_shared/proDraftPersistence/entry.ts';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const SESSION_HASH = 'c'.repeat(64);
const IDEMPOTENCY_KEY = 'idem.synthetic-0001';
const STORED_IDEMPOTENCY_KEY = 'idem.synthetic-0000';
const REQUEST_ID = `pdrq_${'R'.repeat(43)}`;

const canonicalState = (overrides = {}) => ({
  schemaVersion: 4,
  formType: 'pro-questionnaire',
  draftId: 'draft-synthetic-1',
  sessionId: 'session-synthetic-1',
  draftStatus: 'active',
  clientRevision: 2,
  serverRevision: 5,
  savedAtClient: '2026-08-05T12:00:00.000Z',
  savedAtServer: '2026-08-05T12:00:01.000Z',
  sourceTabId: 'tab-synthetic-1',
  responses: { 6: 'Synthetic answer value' },
  validationStatus: { 6: 'complete' },
  touchedQuestions: { 6: true },
  expandedQuestions: { 6: true },
  textValidationMeta: { 6: { isDirty: false } },
  credentials: {
    businessName: 'Synthetic Business',
    domain: 'synthetic.example.test',
    userId: 'synthetic-user',
    userEmail: 'synthetic@example.test',
    recoveryEmail: 'synthetic@example.test',
  },
  identityContext: {
    identityContextVersion: 1,
    recoveryEmailSource: 'client_entered',
    recoveryEmailVerificationStatus: 'unverified',
    identityAssociationIntent: 'new_invitation',
    anonymousRecoveryAcknowledged: false,
    signedInvitationEmailChanged: false,
  },
  uiDraftState: {},
  fieldChangeMetadata: {},
  currentQuestionId: '6',
  lastChangedQuestionId: '6',
  lastMutation: null,
  submission: {
    finalSubmissionId: null,
    submittedAt: null,
    submittedStateHash: null,
    pdfSourceStateHash: null,
    lastSubmissionErrorCode: null,
  },
  compatibility: {
    sourceType: 'canonical',
    sourceVersion: 4,
    migratedAtClient: null,
    migrationWarnings: [],
  },
  ...overrides,
});

const mappedPayload = (overrides = {}) => ({
  metadata: { currentQuestion: '6', version: 1 },
  userdata: { company_description: 'Synthetic answer value' },
  nested: { preserved: true },
  ...overrides,
});

const revisionInput = (overrides = {}) => ({
  storedClientRevision: 2,
  storedServerRevision: 5,
  storedStateHash: HASH_A,
  storedStatus: 'active',
  incomingClientRevision: 3,
  expectedServerRevision: 5,
  incomingStateHash: HASH_B,
  incomingStatus: 'active',
  idempotencyKey: IDEMPOTENCY_KEY,
  storedIdempotencyKey: STORED_IDEMPOTENCY_KEY,
  ...overrides,
});

const expectPersistenceCode = (operation, code) => {
  expect(operation).toThrowError(expect.objectContaining({ code }));
};

describe('draft lifecycle normalization and exhaustive transition matrix', () => {
  it.each([
    ['draft', 'active'],
    ['', 'active'],
    ['   ', 'active'],
    [null, 'active'],
    [undefined, 'active'],
    ...DRAFT_STATUS_VALUES.map((status) => [status, status]),
  ])('normalizes %j to %s', (input, expected) => {
    expect(normalizeDraftLifecycleStatus(input)).toBe(expected);
  });

  it('fails closed for unknown lifecycle values', () => {
    expectPersistenceCode(
      () => normalizeDraftLifecycleStatus('future_status'),
      PERSISTENCE_ERROR_CODES.INVALID_STATUS,
    );
    expect(isDraftStatusTransitionAllowed('future_status', 'active', {
      migrationMode: true,
    })).toBe(false);
  });

  const transitionSources = [null, ...DRAFT_STATUS_VALUES];
  const transitionCases = transitionSources.flatMap((from) => (
    DRAFT_STATUS_VALUES.map((to) => {
      const transitionKey = from === null ? 'new' : from;
      let expected = DRAFT_STATUS_TRANSITIONS[transitionKey].includes(to);
      if (from === 'submitted' || from === 'cleared_superseded') expected = false;
      return [from, to, expected];
    })
  ));

  it.each(transitionCases)(
    'covers transition %s -> %s (default allowed=%s)',
    (from, to, expected) => {
      expect(isDraftStatusTransitionAllowed(from, to)).toBe(expected);
    },
  );

  it('permits only protected idempotent terminal self-transitions', () => {
    expect(isDraftStatusTransitionAllowed('submitted', 'submitted', {
      idempotent: true,
      preservesSubmissionIdentity: true,
    })).toBe(true);
    expect(isDraftStatusTransitionAllowed('submitted', 'submitted', {
      idempotent: true,
      preservesSubmissionIdentity: false,
    })).toBe(false);
    expect(isDraftStatusTransitionAllowed(
      'cleared_superseded',
      'cleared_superseded',
      { idempotent: true, metadataOnly: true },
    )).toBe(true);
    expect(isDraftStatusTransitionAllowed(
      'cleared_superseded',
      'cleared_superseded',
      { idempotent: true, metadataOnly: false },
    )).toBe(false);
  });

  it('asserts an allowed transition and rejects a prohibited transition', () => {
    expect(assertDraftStatusTransitionAllowed('active', 'submit_attempted'))
      .toEqual({ fromStatus: 'active', toStatus: 'submit_attempted' });
    expectPersistenceCode(
      () => assertDraftStatusTransitionAllowed('submitted', 'active'),
      PERSISTENCE_ERROR_CODES.STATUS_TRANSITION_REJECTED,
    );
  });
});

describe('server-authoritative revision truth table', () => {
  const truthTable = [
    {
      name: 'higher valid revision is accepted',
      input: {},
      decision: 'accept',
      reasonCode: PERSISTENCE_ERROR_CODES.WRITE_ACCEPTED,
      nextServerRevision: 6,
      idempotent: false,
    },
    {
      name: 'same revision and same hash is idempotent despite expected-server mismatch',
      input: { incomingClientRevision: 2, incomingStateHash: HASH_A, expectedServerRevision: 1 },
      decision: 'idempotent_success',
      reasonCode: PERSISTENCE_ERROR_CODES.WRITE_IDEMPOTENT,
      nextServerRevision: 5,
      idempotent: true,
    },
    {
      name: 'same revision and different hash conflicts',
      input: { incomingClientRevision: 2, incomingStateHash: HASH_B },
      decision: 'reject_same_revision_different_hash',
      reasonCode: PERSISTENCE_ERROR_CODES.SAME_REVISION_DIFFERENT_HASH,
      nextServerRevision: 5,
      idempotent: false,
    },
    {
      name: 'lower client revision is stale',
      input: { incomingClientRevision: 1 },
      decision: 'reject_stale_client_revision',
      reasonCode: PERSISTENCE_ERROR_CODES.STALE_CLIENT_REVISION,
      nextServerRevision: 5,
      idempotent: false,
    },
    {
      name: 'expected server revision mismatch conflicts',
      input: { expectedServerRevision: 4 },
      decision: 'reject_server_revision_mismatch',
      reasonCode: PERSISTENCE_ERROR_CODES.SERVER_REVISION_MISMATCH,
      nextServerRevision: 5,
      idempotent: false,
    },
    {
      name: 'invalid revision fails closed',
      input: { incomingClientRevision: -1 },
      decision: 'reject_invalid_revision',
      reasonCode: PERSISTENCE_ERROR_CODES.INVALID_REVISION,
      nextServerRevision: null,
      idempotent: false,
    },
    {
      name: 'submitted regression is rejected before stale-write handling',
      input: { storedStatus: 'submitted', incomingStatus: 'active', incomingClientRevision: 1 },
      decision: 'reject_status_transition',
      reasonCode: PERSISTENCE_ERROR_CODES.STATUS_TRANSITION_REJECTED,
      nextServerRevision: 5,
      idempotent: false,
    },
    {
      name: 'cleared draft cannot be reactivated by a later autosave',
      input: { storedStatus: 'cleared_superseded', incomingStatus: 'active' },
      decision: 'reject_status_transition',
      reasonCode: PERSISTENCE_ERROR_CODES.STATUS_TRANSITION_REJECTED,
      nextServerRevision: 5,
      idempotent: false,
    },
  ];

  it.each(truthTable)('$name', (row) => {
    const result = evaluateRevisionWrite(revisionInput(row.input));
    expect(result).toMatchObject({
      decision: row.decision,
      reasonCode: row.reasonCode,
      nextServerRevision: row.nextServerRevision,
      idempotent: row.idempotent,
    });
  });

  it('accounts for every public revision decision value', () => {
    const decisions = new Set(truthTable.map((row) => row.decision));
    expect(decisions).toEqual(new Set([
      'accept',
      'idempotent_success',
      'reject_stale_client_revision',
      'reject_server_revision_mismatch',
      'reject_same_revision_different_hash',
      'reject_status_transition',
      'reject_invalid_revision',
    ]));
  });

  it.each([0, 1])('accepts new-draft client revision %i', (incomingClientRevision) => {
    const result = evaluateRevisionWrite(revisionInput({
      storedClientRevision: 0,
      storedServerRevision: 0,
      storedStateHash: null,
      storedStatus: null,
      incomingClientRevision,
      expectedServerRevision: 0,
      incomingStateHash: HASH_A,
      incomingStatus: 'active',
      storedIdempotencyKey: null,
    }));
    expect(result).toMatchObject({ decision: 'accept', nextServerRevision: 1 });
  });

  it('rejects an undocumented new-draft starting revision', () => {
    expect(evaluateRevisionWrite(revisionInput({
      storedClientRevision: 0,
      storedServerRevision: 0,
      storedStateHash: null,
      storedStatus: null,
      incomingClientRevision: 2,
      expectedServerRevision: 0,
      incomingStateHash: HASH_A,
      incomingStatus: 'active',
      storedIdempotencyKey: null,
    }))).toMatchObject({
      decision: 'reject_invalid_revision',
      nextServerRevision: 0,
    });
  });

  it('rejects an inconsistent stored record masquerading as a new draft', () => {
    expect(evaluateRevisionWrite(revisionInput({
      storedClientRevision: 1,
      storedServerRevision: 1,
      storedStateHash: null,
      storedStatus: 'active',
      incomingClientRevision: 1,
      expectedServerRevision: 1,
      incomingStateHash: HASH_A,
      incomingStatus: 'active',
      storedIdempotencyKey: null,
    }))).toMatchObject({
      decision: 'reject_invalid_revision',
      reasonCode: PERSISTENCE_ERROR_CODES.INVALID_REVISION,
    });
  });

  it('allows an exact submitted retry without changing its server revision', () => {
    expect(evaluateRevisionWrite(revisionInput({
      storedStatus: 'submitted',
      incomingStatus: 'submitted',
      incomingClientRevision: 2,
      incomingStateHash: HASH_A,
    }))).toMatchObject({
      decision: 'idempotent_success',
      idempotent: true,
      nextServerRevision: 5,
      statusTransitionAllowed: true,
    });
  });

  it('uses a matching idempotency key and hash as an exact repeat', () => {
    expect(evaluateRevisionWrite(revisionInput({
      incomingClientRevision: 3,
      incomingStateHash: HASH_A,
      idempotencyKey: STORED_IDEMPOTENCY_KEY,
      expectedServerRevision: 1,
    }))).toMatchObject({
      decision: 'idempotent_success',
      idempotent: true,
      nextServerRevision: 5,
    });
  });

  it('rejects reuse of one idempotency key for different state', () => {
    expect(evaluateRevisionWrite(revisionInput({
      idempotencyKey: STORED_IDEMPOTENCY_KEY,
      incomingStateHash: HASH_B,
    }))).toMatchObject({
      decision: 'reject_same_revision_different_hash',
      reasonCode: PERSISTENCE_ERROR_CODES.IDEMPOTENCY_KEY_REUSED,
      conflict: true,
      nextServerRevision: 5,
    });
  });

  it('allows exact cleared metadata completion but rejects changed state', () => {
    expect(evaluateRevisionWrite(revisionInput({
      storedStatus: 'cleared_superseded',
      incomingStatus: 'cleared_superseded',
      incomingClientRevision: 2,
      incomingStateHash: HASH_A,
    }))).toMatchObject({ decision: 'idempotent_success', nextServerRevision: 5 });
    expect(evaluateRevisionWrite(revisionInput({
      storedStatus: 'cleared_superseded',
      incomingStatus: 'cleared_superseded',
      incomingClientRevision: 3,
      incomingStateHash: HASH_B,
    }))).toMatchObject({ decision: 'reject_status_transition' });
  });

  it('normalizes only nonnegative safe integer revisions', () => {
    expect(normalizeRevision(0)).toBe(0);
    expect(normalizeRevision(undefined, { defaultValue: 7 })).toBe(7);
    for (const invalid of [-1, 1.5, '2', Number.MAX_SAFE_INTEGER + 1]) {
      expectPersistenceCode(
        () => normalizeRevision(invalid),
        PERSISTENCE_ERROR_CODES.INVALID_REVISION,
      );
    }
  });
});

describe('idempotency and mutation identifier validation', () => {
  it('accepts bounded opaque keys without normalization', () => {
    const minimum = 'a'.repeat(MIN_IDEMPOTENCY_KEY_LENGTH);
    const maximum = 'Z'.repeat(MAX_IDEMPOTENCY_KEY_LENGTH);
    expect(validateIdempotencyKey(minimum)).toBe(minimum);
    expect(validateIdempotencyKey(maximum)).toBe(maximum);
    expect(validateIdempotencyKey('Abc_123-xyz.value:9')).toBe('Abc_123-xyz.value:9');
  });

  it.each([
    '',
    'a'.repeat(MIN_IDEMPOTENCY_KEY_LENGTH - 1),
    'a'.repeat(MAX_IDEMPOTENCY_KEY_LENGTH + 1),
    'contains whitespace',
    'synthetic@example.test',
    'slash/not/allowed',
  ])('rejects invalid idempotency key %j', (value) => {
    expectPersistenceCode(
      () => validateIdempotencyKey(value),
      PERSISTENCE_ERROR_CODES.INVALID_IDEMPOTENCY_KEY,
    );
  });

  it('applies the same opaque bounds to mutation IDs', () => {
    expect(validateMutationId('mutation.synthetic:01')).toBe('mutation.synthetic:01');
    expectPersistenceCode(
      () => validateMutationId('short'),
      PERSISTENCE_ERROR_CODES.INVALID_MUTATION_ID,
    );
  });

  it('rejects an invalid idempotency key before evaluating a write', () => {
    expectPersistenceCode(
      () => evaluateRevisionWrite(revisionInput({ idempotencyKey: 'bad key' })),
      PERSISTENCE_ERROR_CODES.INVALID_IDEMPOTENCY_KEY,
    );
  });
});

describe('bounded request method, content type, and streaming JSON parsing', () => {
  const jsonRequest = (body, options = {}) => new Request('https://local.test/draft', {
    method: options.method ?? 'POST',
    headers: {
      'Content-Type': options.contentType ?? 'application/json; charset=utf-8',
      ...(options.headers ?? {}),
    },
    body,
    signal: options.signal,
    ...(options.duplex ? { duplex: options.duplex } : {}),
  });

  it('validates POST and JSON-compatible content types', () => {
    expect(validateRequestMethod('post')).toBe('POST');
    expect(validateJsonContentType('application/json; charset=utf-8'))
      .toBe('application/json');
    expect(validateJsonContentType('application/problem+json'))
      .toBe('application/problem+json');
  });

  it('returns typed 405 and 415 failures', async () => {
    await expect(readBoundedJsonBody(jsonRequest('{}', { method: 'PUT' })))
      .rejects.toMatchObject({
        code: PERSISTENCE_ERROR_CODES.METHOD_NOT_ALLOWED,
        status: 405,
      });
    await expect(readBoundedJsonBody(jsonRequest('{}', { contentType: 'text/plain' })))
      .rejects.toMatchObject({
        code: PERSISTENCE_ERROR_CODES.CONTENT_TYPE_UNSUPPORTED,
        status: 415,
      });
  });

  it('rejects declared oversize before reading the body', async () => {
    const request = jsonRequest('{}', {
      headers: { 'Content-Length': '101' },
    });
    await expect(readBoundedJsonBody(request, { maxBytes: 100 }))
      .rejects.toMatchObject({
        code: PERSISTENCE_ERROR_CODES.REQUEST_TOO_LARGE,
        status: 413,
      });
  });

  it('enforces a hard streaming limit without Content-Length', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('{"value":"'));
        controller.enqueue(encoder.encode('x'.repeat(128)));
        controller.enqueue(encoder.encode('"}'));
        controller.close();
      },
    });
    const request = jsonRequest(stream, { duplex: 'half' });
    await expect(readBoundedJsonBody(request, { maxBytes: 64 }))
      .rejects.toMatchObject({ code: PERSISTENCE_ERROR_CODES.REQUEST_TOO_LARGE });
  });

  it('rejects malformed and empty JSON without echoing it', async () => {
    await expect(readBoundedJsonBody(jsonRequest('{not json}')))
      .rejects.toMatchObject({ code: PERSISTENCE_ERROR_CODES.JSON_MALFORMED });
    await expect(readBoundedJsonBody(jsonRequest('')))
      .rejects.toMatchObject({ code: PERSISTENCE_ERROR_CODES.JSON_MALFORMED });
  });

  it('handles a request already aborted by its caller', async () => {
    const request = {
      method: 'POST',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      signal: { aborted: true },
      body: null,
    };
    await expect(readBoundedJsonBody(request)).rejects.toMatchObject({
      code: PERSISTENCE_ERROR_CODES.REQUEST_ABORTED,
    });
  });

  it('counts multibyte UTF-8 bytes rather than JavaScript code units', async () => {
    const text = JSON.stringify({ value: '😀😀' });
    const byteLength = new TextEncoder().encode(text).byteLength;
    expect(text.length).toBeLessThan(byteLength);
    await expect(readBoundedJsonBody(jsonRequest(text), { maxBytes: byteLength }))
      .resolves.toEqual({ value: '😀😀' });
    await expect(readBoundedJsonBody(jsonRequest(text), { maxBytes: byteLength - 1 }))
      .rejects.toMatchObject({ code: PERSISTENCE_ERROR_CODES.REQUEST_TOO_LARGE });
  });

  it('publishes the one-megabyte default without allocating beyond it', () => {
    expect(DEFAULT_MAX_API_REQUEST_BYTES).toBe(1024 * 1024);
  });
});

describe('canonical payload bounds and compatibility projection', () => {
  it('stable-serializes a valid canonical payload under 750 KB', () => {
    const result = validateCanonicalPayloadSize(canonicalState());
    expect(result.maxBytes).toBe(DEFAULT_MAX_CANONICAL_STATE_BYTES);
    expect(result.bytes).toBe(new TextEncoder().encode(result.serialized).byteLength);
    expect(JSON.parse(result.serialized)).toEqual(canonicalState());
  });

  it('rejects canonical payloads over a smaller per-function limit', () => {
    const state = canonicalState({ responses: { 6: 'x'.repeat(1024) } });
    expectPersistenceCode(
      () => validateCanonicalPayloadSize(state, { maxBytes: 200 }),
      PERSISTENCE_ERROR_CODES.CANONICAL_STATE_TOO_LARGE,
    );
  });

  it('rejects invalid or authorization-bearing canonical state', () => {
    expectPersistenceCode(
      () => validateCanonicalPayloadSize(canonicalState({ responses: new Map() })),
      PERSISTENCE_ERROR_CODES.CANONICAL_STATE_INVALID,
    );
    expectPersistenceCode(
      () => validateCanonicalPayloadSize(canonicalState({
        credentials: { recoveryCode: 'RAW-CODE' },
      })),
      PERSISTENCE_ERROR_CODES.CANONICAL_STATE_INVALID,
    );
    expectPersistenceCode(
      () => validateCanonicalPayloadSize(canonicalState({
        touchedQuestions: { 6: 'yes' },
      })),
      PERSISTENCE_ERROR_CODES.CANONICAL_STATE_INVALID,
    );
  });

  it('prepares every current compatibility column with canonical JSON', () => {
    const state = canonicalState();
    const mapped = mappedPayload();
    const columns = buildDraftCompatibilityColumns(state, mapped, {
      stateHash: HASH_A,
      serverRevision: 6,
      lastSyncReason: 'accepted_save',
    });
    expect(Object.keys(columns).sort()).toEqual([
      'responses_json',
      'validation_status_json',
      'touched_questions_json',
      'expanded_questions_json',
      'text_validation_meta_json',
      'ui_draft_state_json',
      'field_change_metadata_json',
      'credentials_json',
      'draft_state_json',
      'metadata_json',
      'userdata_json',
      'mapped_payload_json',
      'current_question_id',
      'last_changed_question_id',
      'draft_schema_version',
      'client_revision',
      'server_revision',
      'state_hash',
      'source_tab_id',
      'last_sync_reason',
    ].sort());
    expect(JSON.parse(columns.responses_json)).toEqual(state.responses);
    expect(JSON.parse(columns.draft_state_json)).toEqual(state);
    expect(JSON.parse(columns.mapped_payload_json)).toEqual(mapped);
    expect(columns).toMatchObject({
      draft_schema_version: 4,
      client_revision: 2,
      server_revision: 6,
      state_hash: HASH_A,
      source_tab_id: 'tab-synthetic-1',
      last_sync_reason: 'accepted_save',
    });
  });

  it('never silently replaces serialization failure with an empty object', () => {
    const cyclic = mappedPayload();
    cyclic.nested.self = cyclic;
    expectPersistenceCode(
      () => buildDraftCompatibilityColumns(canonicalState(), cyclic, {
        stateHash: HASH_A,
      }),
      PERSISTENCE_ERROR_CODES.SERIALIZATION_FAILED,
    );
  });

  it('requires validated mapped payload metadata and userdata', () => {
    expectPersistenceCode(
      () => buildDraftCompatibilityColumns(canonicalState(), { metadata: {} }, {
        stateHash: HASH_A,
      }),
      PERSISTENCE_ERROR_CODES.COMPATIBILITY_INPUT_INVALID,
    );
  });
});

describe('deterministic duplicate-draft selection', () => {
  const record = (id, overrides = {}) => ({
    id,
    status: 'active',
    server_revision: 1,
    client_revision: 1,
    last_saved_at: '2026-08-05T12:00:00.000Z',
    updated_date: '2026-08-05T12:00:00.000Z',
    created_date: '2026-08-05T12:00:00.000Z',
    responses_json: '{"6":"Synthetic answer value"}',
    ...overrides,
  });

  it('prefers highest server then client revision for active duplicates', () => {
    const result = selectCanonicalDuplicateDraft([
      record('draft-a', { server_revision: 2, client_revision: 9 }),
      record('draft-b', { server_revision: 3, client_revision: 1 }),
      record('draft-c', { server_revision: 3, client_revision: 2 }),
    ]);
    expect(result.selected.id).toBe('draft-c');
    expect(result.supersededCandidates).toHaveLength(2);
  });

  it('selects within the submitted partition without merging active data', () => {
    const result = selectCanonicalDuplicateDraft([
      record('active-newer', { server_revision: 99 }),
      record('submitted-a', { status: 'submitted', server_revision: 2 }),
      record('submitted-b', { status: 'submitted', server_revision: 3 }),
    ]);
    expect(result.selected.id).toBe('submitted-b');
    expect(result.selected).not.toHaveProperty('merged');
    expect(result.warnings).toContain('SUBMITTED_AND_UNSUBMITTED_PARTITIONED');
  });

  it('excludes cleared/superseded records when a live candidate exists', () => {
    const result = selectCanonicalDuplicateDraft([
      record('cleared', { status: 'cleared_superseded', server_revision: 50 }),
      record('active', { server_revision: 1 }),
    ]);
    expect(result.selected.id).toBe('active');
    expect(result.warnings).toContain('SUPERSEDED_OR_TERMINAL_EXCLUDED');
  });

  it('uses save/update/create timestamps and stable ID only as tie-breakers', () => {
    const result = selectCanonicalDuplicateDraft([
      record('draft-a'),
      record('draft-b', { last_saved_at: '2026-08-05T13:00:00.000Z' }),
    ]);
    expect(result.selected.id).toBe('draft-b');
    const stableTie = selectCanonicalDuplicateDraft([record('draft-a'), record('draft-b')]);
    expect(stableTie.selected.id).toBe('draft-b');
  });

  it('falls through invalid revision and timestamp aliases safely', () => {
    const result = selectCanonicalDuplicateDraft([
      record('draft-a', {
        server_revision: 'invalid',
        serverRevision: 4,
        last_saved_at: 'invalid',
        saved_at_server: '2026-08-05T14:00:00.000Z',
      }),
      record('draft-b', { server_revision: 3 }),
    ]);
    expect(result.selected.id).toBe('draft-a');
  });

  it('normalizes legacy draft and blank status without mutating source records', () => {
    const records = [record('draft-a', { status: 'draft' }), record('draft-b', { status: '' })];
    const before = JSON.stringify(records);
    const result = selectCanonicalDuplicateDraft(records);
    expect(result.selected.id).toBe('draft-b');
    expect(JSON.stringify(records)).toBe(before);
  });

  it('keeps warnings value-free and excludes unknown statuses', () => {
    const result = selectCanonicalDuplicateDraft([
      record('invalid', { status: 'future_status', responses_json: 'PRIVATE_ANSWER' }),
      record('valid'),
    ]);
    expect(result.selected.id).toBe('valid');
    expect(JSON.stringify(result.warnings)).not.toContain('PRIVATE_ANSWER');
    expect(result.warnings).toContain('UNKNOWN_STATUS_EXCLUDED');
  });
});

describe('safe conflict, JSON, error, request-ID, and diagnostic projections', () => {
  const conflictRecord = () => ({
    id: 'draft-synthetic-1',
    session_id_hash: SESSION_HASH,
    status: 'active',
    client_revision: 2,
    server_revision: 5,
    state_hash: HASH_A,
    saved_at_server: '2026-08-05T12:00:01.000Z',
    draft_state_json: JSON.stringify(canonicalState()),
    recovery_email: 'synthetic@example.test',
    recovery_email_lookup_hash: HASH_B,
    resume_token_hash: HASH_B,
    source_app_id: 'private-app-id',
  });

  it('defaults to a value-limited conflict projection', () => {
    const projection = buildSafeConflictProjection(conflictRecord());
    expect(projection).toEqual({
      draftId: 'draft-synthetic-1',
      sessionIdFingerprint: SESSION_HASH.slice(0, 12),
      status: 'active',
      clientRevision: 2,
      serverRevision: 5,
      stateHash: HASH_A,
      savedAtServer: '2026-08-05T12:00:01.000Z',
    });
    expect(JSON.stringify(projection)).not.toMatch(
      /synthetic@example|recovery_email|resume_token|private-app-id/u,
    );
  });

  it('omits a malformed draft identifier from a public conflict projection', () => {
    const record = conflictRecord();
    record.id = 'synthetic@example.test';
    expect(buildSafeConflictProjection(record).draftId).toBeNull();
  });

  it('includes canonical state only after an explicit authorized option', () => {
    const projection = buildSafeConflictProjection(conflictRecord(), {
      includeAuthorizedCanonicalState: true,
    });
    expect(projection.canonicalState).toEqual(canonicalState());
  });

  it('adds mandatory no-store JSON headers', async () => {
    const response = buildSafeJsonResponse({ success: true }, { status: 201 });
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(response.headers.get('pragma')).toBe('no-cache');
    expect(response.headers.get('content-type')).toBe('application/json');
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it('maps typed failures to generic public error bodies', async () => {
    const internal = new ProDraftPersistenceError(
      PERSISTENCE_ERROR_CODES.SERVER_REVISION_MISMATCH,
    );
    internal.stack = 'STACK_WITH_PRIVATE_ANSWER';
    const response = buildSafeErrorResponse(internal, { requestId: REQUEST_ID });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toEqual({
      success: false,
      errorCode: PERSISTENCE_ERROR_CODES.SERVER_REVISION_MISMATCH,
      message: 'The draft could not be updated because it changed.',
      requestId: REQUEST_ID,
      retryable: false,
    });
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE_ANSWER|stack|https?:\/\//iu);
  });

  it('never permits an error helper to emit a success status', async () => {
    const response = buildSafeErrorResponse(new Error('PRIVATE_ANSWER'), {
      requestId: REQUEST_ID,
      status: 200,
    });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('PRIVATE_ANSWER');
  });

  it('creates secure opaque request IDs and supports deterministic injection', () => {
    expect(createServerRequestId({ generator: () => REQUEST_ID })).toBe(REQUEST_ID);
    expect(createServerRequestId()).toMatch(/^pdrq_[A-Za-z0-9_-]{43}$/u);
    expectPersistenceCode(
      () => createServerRequestId({ generator: () => 'request-for-email@example.test' }),
      PERSISTENCE_ERROR_CODES.REQUEST_ID_INVALID,
    );
  });

  it('returns only nonsecret diagnostics with a one-way key fingerprint', async () => {
    const diagnostics = await getSafePersistenceDiagnostics({
      error: new ProDraftPersistenceError(PERSISTENCE_ERROR_CODES.STALE_CLIENT_REVISION),
      decision: 'reject_stale_client_revision',
      status: 'active',
      clientRevision: 2,
      serverRevision: 5,
      requestId: REQUEST_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      recordCount: 3,
      selectedPresent: true,
      privateAnswer: 'PRIVATE_ANSWER',
      email: 'synthetic@example.test',
    });
    expect(diagnostics).toMatchObject({
      version: PRO_DRAFT_PERSISTENCE_VERSION,
      maximumApiRequestBytes: DEFAULT_MAX_API_REQUEST_BYTES,
      maximumCanonicalStateBytes: DEFAULT_MAX_CANONICAL_STATE_BYTES,
      decision: 'reject_stale_client_revision',
      errorCode: PERSISTENCE_ERROR_CODES.STALE_CLIENT_REVISION,
      requestId: REQUEST_ID,
      recordCount: 3,
      selectedPresent: true,
    });
    expect(diagnostics.idempotencyKeyFingerprint).toMatch(/^[0-9a-f]{12}$/u);
    expect(JSON.stringify(diagnostics)).not.toMatch(
      /PRIVATE_ANSWER|synthetic@example|idem\.synthetic/u,
    );
  });

  it('rejects unrecognized diagnostic decisions rather than reflecting them', async () => {
    const diagnostics = await getSafePersistenceDiagnostics({
      decision: 'synthetic@example.test',
    });
    expect(diagnostics.decision).toBeNull();
    expect(JSON.stringify(diagnostics)).not.toContain('synthetic@example.test');
  });

  it('contains no endpoint, logging, environment read, or Base44 operation', () => {
    const source = readFileSync(resolve(
      process.cwd(),
      'base44/functions/_shared/proDraftPersistence/entry.ts',
    ), 'utf8');
    expect(source).not.toMatch(/export\s+default|Deno\.serve|Deno\.env|process\.env/u);
    expect(source).not.toMatch(/console\s*\.|@base44\/sdk|createClientFromRequest/u);
    expect(source).not.toMatch(/entities\.|functions\.invoke|fetch\(/u);
    expect(source).not.toMatch(/transformResponsesToPayload/u);
  });
});
