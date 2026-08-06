import { describe, expect, it } from 'vitest';
import {
  getDraftForRecovery,
  getDraftLineageForRecovery,
  getIntakeForRecovery,
  listDraftEventsForRecovery,
  listDraftsForRecovery,
  listIntakesForRecovery,
  maskRecoveryEmail,
  normalizeAdminDomain,
  parseAdminJsonField,
  safeDraftDetail,
  safeDraftSummary,
  updateDraftForRecovery,
} from '../../base44/functions/_shared/proDraftAdminService/entry.ts';
import { hashNormalizedRecoveryEmail } from '../../base44/functions/_shared/proDraftSecurity/entry.ts';

const secret = 'a'.repeat(64);
const makeEntities = (draftRows = [], eventRows = [], intakeRows = []) => {
  const drafts = draftRows.map((v) => ({ ...v }));
  const events = eventRows.map((v) => ({ ...v }));
  const intakes = intakeRows.map((v) => ({ ...v }));
  const filter = (rows) => async (query, _sort, limit = 100, skip = 0) => rows.filter((row) => Object.entries(query).every(([k,v]) => row[k] === v)).slice(skip, skip + limit);
  return {
    drafts, events, intakes,
    entities: {
      ProFormDraft: {
        get: async (id) => drafts.find((v) => v.id === id),
        filter: filter(drafts),
        updateMany: async (query, change) => {
          const row = drafts.find((v) => Object.entries(query).every(([k,val]) => v[k] === val));
          if (!row) return 0;
          Object.assign(row, change.$set); return 1;
        },
      },
      ProFormDraftEvent: { filter: filter(events), create: async (value) => { events.push(value); return value; } },
      ProFormSubmissionIntake: { get: async (id) => intakes.find((v) => v.id === id), filter: filter(intakes) },
    },
  };
};

describe('admin draft safe projections', () => {
  it('masks email addresses', () => expect(maskRecoveryEmail('person@example.com')).toBe('p***@example.com'));
  it('rejects invalid email display values', () => expect(maskRecoveryEmail('bad')).toBe(''));
  it('normalizes a domain', () => expect(normalizeAdminDomain('WWW.Example.COM')).toBe('example.com'));
  it('rejects credential-bearing URLs', () => expect(() => normalizeAdminDomain('user@example.com')).toThrow());
  it('parses valid JSON without replacing its raw representation', () => expect(parseAdminJsonField('{"a":1}')).toMatchObject({ valid: true, raw: '{"a":1}', parsed: { a: 1 } }));
  it('reports malformed JSON', () => expect(parseAdminJsonField('{')).toMatchObject({ valid: false, errorCode: 'MALFORMED_JSON' }));
  it('excludes all authorization hashes from summaries', () => {
    const value = safeDraftSummary({ id: 'd1', recovery_email: 'a@b.com', recovery_code_hash: 'x', resume_token_hash: 'y', identity_key_hash: 'z' });
    expect(value).toMatchObject({ id: 'd1', recovery_email: 'a***@b.com' }); expect(value).not.toHaveProperty('recovery_code_hash');
  });
  it('excludes hashes from detail while retaining malformed JSON diagnostics', () => {
    const value = safeDraftDetail({ id: 'd1', draft_state_json: '{', state_hash: 'x', recovery_email_lookup_hash: 'y' });
    expect(value).not.toHaveProperty('state_hash'); expect(value).not.toHaveProperty('recovery_email_lookup_hash');
    expect(value.jsonDiagnostics.draft_state_json.errorCode).toBe('MALFORMED_JSON');
  });
});

describe('admin draft reads', () => {
  it('gets exact draft detail', async () => {
    const { entities } = makeEntities([{ id: 'd1', status: 'active' }]);
    await expect(getDraftForRecovery(entities, { draftId: 'd1' })).resolves.toMatchObject({ draft: { id: 'd1' } });
  });
  it('returns not found for an absent draft', async () => {
    const { entities } = makeEntities(); await expect(getDraftForRecovery(entities, { draftId: 'd1' })).rejects.toMatchObject({ status: 404 });
  });
  it('rejects unsafe identifiers', async () => {
    const { entities } = makeEntities(); await expect(getDraftForRecovery(entities, { draftId: '../x' })).rejects.toMatchObject({ status: 400 });
  });
  it('lists with an enforced maximum page size', async () => {
    const { entities } = makeEntities([{ id: 'd1', status: 'active' }]);
    const result = await listDraftsForRecovery(entities, { pageSize: 999 }, { cursor: secret, email: secret });
    expect(result.pageSize).toBe(25); expect(result.items).toHaveLength(1);
  });
  it('supports exact session lookup', async () => {
    const { entities } = makeEntities([{ id: 'd1', session_id: 's1' }, { id: 'd2', session_id: 's2' }]);
    const result = await listDraftsForRecovery(entities, { search: { mode: 'session_id', value: 's2' } }, { cursor: secret, email: secret });
    expect(result.items.map((v) => v.id)).toEqual(['d2']);
  });
  it('applies allowlisted status and environment filters at the entity boundary', async () => {
    let query;
    const entities = { ProFormDraft: { filter: async (value) => { query = value; return []; } }, ProFormDraftEvent: { filter: async () => [] } };
    await listDraftsForRecovery(entities, { filters: { status: 'submit_failed', environment: 'staging' } }, { cursor: secret, email: secret });
    expect(query).toMatchObject({ status: 'submit_failed', environment: 'staging' });
  });
  it('normalizes and hashes an exact recovery email search', async () => {
    let query; const entities = { ProFormDraft: { filter: async (value) => { query = value; return []; } }, ProFormDraftEvent: { filter: async () => [] } };
    await listDraftsForRecovery(entities, { search: { mode: 'recovery_email', value: 'Person@Example.COM' } }, { cursor: secret, email: secret });
    expect(query.recovery_email_lookup_hash).toBe(await hashNormalizedRecoveryEmail('person@example.com', { name: 'PRO_FORM_EMAIL_LOOKUP_SECRET', value: secret }));
    expect(query).not.toHaveProperty('recovery_email');
  });
  it('uses only the sort allowlist', async () => {
    let sort; const entities = { ProFormDraft: { filter: async (_q, value) => { sort = value; return []; } }, ProFormDraftEvent: { filter: async () => [] } };
    await listDraftsForRecovery(entities, { sort: 'arbitrary_field' }, { cursor: secret, email: secret }); expect(sort).toBe('-last_saved_at');
  });
  it('rejects unknown search modes', async () => {
    const { entities } = makeEntities(); await expect(listDraftsForRecovery(entities, { search: { mode: 'regex', value: '.*' } }, { cursor: secret, email: secret })).rejects.toMatchObject({ status: 400 });
  });
  it('rejects cursor tampering', async () => {
    const { entities } = makeEntities(); await expect(listDraftsForRecovery(entities, { cursor: 'bad.bad' }, { cursor: secret, email: secret })).rejects.toMatchObject({ status: 400 });
  });
  it('redacts event value JSON by default', async () => {
    const { entities } = makeEntities([{ id: 'd1' }], [{ id: 'e1', draft_id: 'd1', value_json: '{"answer":1}' }]);
    const result = await listDraftEventsForRecovery(entities, { draftId: 'd1' }, secret); expect(result.items[0]).not.toHaveProperty('value_json');
  });
  it('allows safe event values only by explicit opt-in', async () => {
    const { entities } = makeEntities([{ id: 'd1' }], [{ id: 'e1', draft_id: 'd1', value_json: '{"answer":1}' }]);
    const result = await listDraftEventsForRecovery(entities, { draftId: 'd1', includeValueJson: true }, secret); expect(result.items[0].value_json).toBe('{"answer":1}');
  });
  it('redacts credential-like keys even with opt-in', async () => {
    const { entities } = makeEntities([{ id: 'd1' }], [{ id: 'e1', draft_id: 'd1', value_json: '{"password":"x"}' }]);
    const result = await listDraftEventsForRecovery(entities, { draftId: 'd1', includeValueJson: true }, secret); expect(result.items[0]).not.toHaveProperty('value_json');
  });
  it('paginates events at the requested bound', async () => {
    const { entities } = makeEntities([{ id: 'd1' }], [{ id: 'e1', draft_id: 'd1' }, { id: 'e2', draft_id: 'd1' }]);
    const result = await listDraftEventsForRecovery(entities, { draftId: 'd1', pageSize: 1 }, secret); expect(result.items).toHaveLength(1); expect(result.nextCursor).toEqual(expect.any(String));
  });
});

describe('admin intake reads', () => {
  it('returns a safe paginated intake projection', async () => {
    const { entities } = makeEntities([], [], [
      { id: 'i1', status: 'received_intake', user_email: 'private@example.test', diagnostics_json: '{"browserOnline":true}' },
      { id: 'i2', status: 'received_intake' },
    ]);
    const result = await listIntakesForRecovery(entities, { pageSize: 1, filters: { status: 'received_intake' } }, secret);
    expect(result.items).toEqual([expect.objectContaining({ id: 'i1', status: 'received_intake' })]);
    expect(result.items[0]).not.toHaveProperty('user_email');
    expect(result.nextCursor).toEqual(expect.any(String));
  });

  it('loads bounded detail and parses diagnostic JSON', async () => {
    const { entities } = makeEntities([], [], [{ id: 'i1', diagnostics_json: '{"browserOnline":true}', transformed_payload_json: '{"safe":true}' }]);
    const result = await getIntakeForRecovery(entities, { intakeId: 'i1' });
    expect(result.intake.jsonDiagnostics.diagnostics_json).toMatchObject({ valid: true, parsed: { browserOnline: true } });
    expect(result.intake).not.toHaveProperty('raw_responses_json');
  });

  it('rejects unsafe intake identifiers and unknown list filters', async () => {
    const { entities } = makeEntities();
    await expect(getIntakeForRecovery(entities, { intakeId: '../unsafe' })).rejects.toMatchObject({ status: 400 });
    await expect(listIntakesForRecovery(entities, { filters: { arbitrary: true } }, secret)).rejects.toMatchObject({ status: 400 });
  });
});

describe('admin draft mutation and lineage', () => {
  it('requires expected revision', async () => {
    const { entities } = makeEntities([{ id: 'd1', server_revision: 1 }]);
    await expect(updateDraftForRecovery(entities, { draftId: 'd1', idempotencyKey: '1234567890123456', changes: {} }, { actorHash: 'a', environment: 'staging', emailSecret: secret })).rejects.toMatchObject({ status: 400 });
  });
  it('rejects unknown edit fields', async () => {
    const { entities } = makeEntities([{ id: 'd1', server_revision: 1 }]);
    await expect(updateDraftForRecovery(entities, { draftId: 'd1', expectedServerRevision: 1, idempotencyKey: '1234567890123456', changes: { status: 'submitted' } }, { actorHash: 'a', environment: 'staging', emailSecret: secret })).rejects.toMatchObject({ status: 400 });
  });
  it('enforces submitted state lock', async () => {
    const { entities } = makeEntities([{ id: 'd1', status: 'submitted', server_revision: 1 }]);
    await expect(updateDraftForRecovery(entities, { draftId: 'd1', expectedServerRevision: 1, idempotencyKey: '1234567890123456', changes: { business_name: 'New' } }, { actorHash: 'a', environment: 'staging', emailSecret: secret })).rejects.toMatchObject({ status: 409 });
  });
  it('permits retention hold on a submitted draft without revision increment', async () => {
    const store = makeEntities([{ id: 'd1', status: 'submitted', server_revision: 1 }]);
    const result = await updateDraftForRecovery(store.entities, { draftId: 'd1', expectedServerRevision: 1, idempotencyKey: '1234567890123456', changes: { retention_hold: true } }, { actorHash: 'a', environment: 'staging', emailSecret: secret });
    expect(result.draft).toMatchObject({ retention_hold: true, server_revision: 1 });
  });
  it('increments revision for state-bearing edits and writes an audit event', async () => {
    const store = makeEntities([{ id: 'd1', session_id: 's1', status: 'active', server_revision: 1 }]);
    const result = await updateDraftForRecovery(store.entities, { draftId: 'd1', expectedServerRevision: 1, idempotencyKey: '1234567890123456', changes: { business_name: 'New' } }, { actorHash: 'actor', environment: 'staging', emailSecret: secret });
    expect(result.draft.server_revision).toBe(2); expect(store.events[0]).toMatchObject({ event_type: 'admin_edit', admin_actor_hash: 'actor' });
  });
  it('normalizes recovery email, recomputes its lookup hash, and resets verification', async () => {
    const store = makeEntities([{ id: 'd1', server_revision: 1, status: 'active' }]);
    await updateDraftForRecovery(store.entities, { draftId: 'd1', expectedServerRevision: 1, idempotencyKey: '1234567890123456', changes: { recovery_email: 'Person@Example.COM' } }, { actorHash: 'a', environment: 'staging', emailSecret: secret });
    expect(store.drafts[0]).toMatchObject({ recovery_email: 'person@example.com', recovery_email_source: 'admin_corrected', recovery_email_verification_status: 'unverified' });
    expect(store.drafts[0].recovery_email_lookup_hash).toMatch(/^[0-9a-f]{64}$/u);
  });
  it('rejects malformed JSON edits', async () => {
    const { entities } = makeEntities([{ id: 'd1', server_revision: 1 }]);
    await expect(updateDraftForRecovery(entities, { draftId: 'd1', expectedServerRevision: 1, idempotencyKey: '1234567890123456', changes: { mapped_payload_json: '{' } }, { actorHash: 'a', environment: 'staging', emailSecret: secret })).rejects.toMatchObject({ status: 400 });
  });
  it('is idempotent for a repeated mutation key', async () => {
    const store = makeEntities([{ id: 'd1', server_revision: 1 }]);
    const input = { draftId: 'd1', expectedServerRevision: 1, idempotencyKey: '1234567890123456', changes: { business_name: 'New' } };
    await updateDraftForRecovery(store.entities, input, { actorHash: 'a', environment: 'staging', emailSecret: secret });
    const result = await updateDraftForRecovery(store.entities, input, { actorHash: 'a', environment: 'staging', emailSecret: secret }); expect(result.idempotent).toBe(true);
  });
  it('reports related session records without merging them', async () => {
    const { entities } = makeEntities([{ id: 'd1', session_id: 's' }, { id: 'd2', session_id: 's' }]);
    const result = await getDraftLineageForRecovery(entities, { draftId: 'd1' }); expect(result.related.map((v) => v.id)).toEqual(['d2']); expect(result.diagnostic.recommendation).toContain('no_automatic_merge');
  });
});
