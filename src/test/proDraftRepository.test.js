import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DRAFT_QUERY_LIMIT,
  PRO_DRAFT_REPOSITORY_ERROR_CODES,
  conditionalUpdateDraftRecord,
  createDraftEvents,
  createDraftRecord,
  createDraftRepository,
  findDraftByBootstrapIdempotencyHash,
  findDraftEventsByEventIds,
  findDraftsByIdentityKeyHash,
  findDraftsByRecoveryCodeHash,
  findDraftsByRecoveryEmailLookupHash,
  findDraftsByResumeTokenHash,
  getDraftById,
  getSafeRepositoryDiagnostics,
  listDraftEventsByDraftId,
  markDuplicateDraftsSuperseded,
  updateDraftRecord,
} from '../../base44/functions/_shared/proDraftRepository/entry.ts';

const HASH = 'a'.repeat(64);
const createEntity = () => ({
  filter: vi.fn().mockResolvedValue([]),
  get: vi.fn().mockResolvedValue({ id: 'draft-synthetic-1' }),
  create: vi.fn().mockImplementation(async (data) => ({ id: 'created', ...data })),
  update: vi.fn().mockImplementation(async (id, data) => ({ id, ...data })),
  updateMany: vi.fn().mockResolvedValue({ success: true, updated: 1 }),
  bulkCreate: vi.fn().mockImplementation(async (data) => data),
});
const createSdk = () => ({
  asServiceRole: {
    entities: {
      ProFormDraft: createEntity(),
      ProFormDraftEvent: createEntity(),
    },
  },
});
const conditionalInput = (overrides = {}) => ({
  draftId: 'draft-synthetic-1',
  expectedServerRevision: 5,
  expectedStatus: 'active',
  acceptedStateHash: HASH,
  acceptedStatus: 'active',
  changes: { last_sync_reason: 'autosave' },
  ...overrides,
});

describe('Base44 draft repository boundary', () => {
  it('accepts only an already-created service-role client', () => {
    const sdk = createSdk();
    const repository = createDraftRepository(sdk);
    expect(repository.drafts).toBe(sdk.asServiceRole.entities.ProFormDraft);
    expect(repository.events).toBe(sdk.asServiceRole.entities.ProFormDraftEvent);
    expect(() => createDraftRepository({ entities: {} })).toThrowError(
      expect.objectContaining({
        code: PRO_DRAFT_REPOSITORY_ERROR_CODES.CLIENT_INVALID,
      }),
    );
  });

  it.each([
    ['resume_token_hash', findDraftsByResumeTokenHash],
    ['identity_key_hash', findDraftsByIdentityKeyHash],
    ['recovery_code_hash', findDraftsByRecoveryCodeHash],
  ])('uses a bounded filter for %s', async (field, operation) => {
    const sdk = createSdk();
    const repository = createDraftRepository(sdk);
    await operation(repository, HASH);
    expect(repository.drafts.filter).toHaveBeenCalledWith(
      { [field]: HASH },
      '-updated_date',
      DEFAULT_DRAFT_QUERY_LIMIT,
      0,
    );
  });

  it('queries email associations by server-created order with a bounded limit', async () => {
    const repository = createDraftRepository(createSdk());
    await findDraftsByRecoveryEmailLookupHash(repository, HASH);
    expect(repository.drafts.filter).toHaveBeenCalledWith(
      { recovery_email_lookup_hash: HASH },
      '-created_date',
      DEFAULT_DRAFT_QUERY_LIMIT,
      0,
    );
  });

  it('bounds bootstrap idempotency lookup to duplicate detection', async () => {
    const repository = createDraftRepository(createSdk());
    repository.drafts.filter.mockResolvedValue([{ id: 'draft-synthetic-1' }]);
    await expect(findDraftByBootstrapIdempotencyHash(repository, HASH))
      .resolves.toEqual({ id: 'draft-synthetic-1' });
    expect(repository.drafts.filter).toHaveBeenCalledWith(
      { bootstrap_idempotency_key_hash: HASH },
      '-updated_date',
      2,
      0,
    );
  });

  it('uses get, create, and update with no inferred authorization query', async () => {
    const repository = createDraftRepository(createSdk());
    await getDraftById(repository, 'draft-synthetic-1');
    await createDraftRecord(repository, { session_id: 'session-synthetic-1' });
    await updateDraftRecord(repository, 'draft-synthetic-1', { status: 'active' });
    expect(repository.drafts.get).toHaveBeenCalledWith('draft-synthetic-1');
    expect(repository.drafts.create).toHaveBeenCalledWith({
      session_id: 'session-synthetic-1',
    });
    expect(repository.drafts.update).toHaveBeenCalledWith(
      'draft-synthetic-1',
      { status: 'active' },
    );
  });

  it('uses bounded event filters and bulkCreate', async () => {
    const repository = createDraftRepository(createSdk());
    await listDraftEventsByDraftId(repository, 'draft-synthetic-1');
    expect(repository.events.filter).toHaveBeenCalledWith(
      { draft_id: 'draft-synthetic-1' },
      '-created_date',
      100,
      0,
    );
    await findDraftEventsByEventIds(
      repository,
      'draft-synthetic-1',
      ['event-1', 'event-2'],
    );
    expect(repository.events.filter).toHaveBeenLastCalledWith(
      {
        draft_id: 'draft-synthetic-1',
        event_id: { $in: ['event-1', 'event-2'] },
      },
      '-created_date',
      2,
      0,
    );
    await createDraftEvents(repository, [{
      draft_id: 'draft-synthetic-1',
      event_id: 'event-1',
    }]);
    expect(repository.events.bulkCreate).toHaveBeenCalledTimes(1);
  });

  it('uses only the verified Base44 SDK entity method names', () => {
    const source = readFileSync(resolve(
      'base44/functions/_shared/proDraftRepository/entry.ts',
    ), 'utf8');
    expect(source).not.toMatch(/\.find(?:One)?\s*\(/u);
    expect(source).not.toMatch(/\.(?:insert|remove|list)\s*\(/u);
    expect(getSafeRepositoryDiagnostics().methods).toEqual([
      'filter', 'get', 'create', 'update', 'updateMany', 'bulkCreate',
    ]);
  });
});

describe('conditional authoritative update', () => {
  it('updates exactly one revision and verifies the post-read record', async () => {
    const repository = createDraftRepository(createSdk());
    repository.drafts.get.mockResolvedValue({
      id: 'draft-synthetic-1',
      server_revision: 6,
      state_hash: HASH,
      status: 'active',
    });
    const result = await conditionalUpdateDraftRecord(
      repository,
      conditionalInput(),
    );
    expect(repository.drafts.updateMany).toHaveBeenCalledWith(
      {
        id: 'draft-synthetic-1',
        server_revision: 5,
        status: 'active',
      },
      {
        $set: {
          last_sync_reason: 'autosave',
          state_hash: HASH,
          status: 'active',
        },
        $inc: { server_revision: 1 },
      },
    );
    expect(repository.drafts.get.mock.invocationCallOrder[0]).toBeGreaterThan(
      repository.drafts.updateMany.mock.invocationCallOrder[0],
    );
    expect(result.server_revision).toBe(6);
  });

  it('treats an update count of zero as a conflict without fallback update', async () => {
    const repository = createDraftRepository(createSdk());
    repository.drafts.updateMany.mockResolvedValue({ success: true, updated: 0 });
    await expect(conditionalUpdateDraftRecord(repository, conditionalInput()))
      .rejects.toMatchObject({
        code: PRO_DRAFT_REPOSITORY_ERROR_CODES.CONDITIONAL_CONFLICT,
      });
    expect(repository.drafts.get).not.toHaveBeenCalled();
    expect(repository.drafts.update).not.toHaveBeenCalled();
  });

  it('blocks unsupported updateMany result shapes and multi-record updates', async () => {
    const repository = createDraftRepository(createSdk());
    repository.drafts.updateMany.mockResolvedValue({ success: true });
    await expect(conditionalUpdateDraftRecord(repository, conditionalInput()))
      .rejects.toMatchObject({
        code: PRO_DRAFT_REPOSITORY_ERROR_CODES.CONDITIONAL_UPDATE_UNSUPPORTED,
      });
    repository.drafts.updateMany.mockResolvedValue({ success: true, updated: 2 });
    await expect(conditionalUpdateDraftRecord(repository, conditionalInput()))
      .rejects.toMatchObject({
        code: PRO_DRAFT_REPOSITORY_ERROR_CODES.CONDITIONAL_UPDATE_UNSUPPORTED,
      });
  });

  it.each([
    { server_revision: 7, state_hash: HASH, status: 'active' },
    { server_revision: 6, state_hash: 'b'.repeat(64), status: 'active' },
    { server_revision: 6, state_hash: HASH, status: 'submitted' },
  ])('rejects post-read mismatches without unguarded repair', async (accepted) => {
    const repository = createDraftRepository(createSdk());
    repository.drafts.get.mockResolvedValue({
      id: 'draft-synthetic-1',
      ...accepted,
    });
    await expect(conditionalUpdateDraftRecord(repository, conditionalInput()))
      .rejects.toMatchObject({
        code: PRO_DRAFT_REPOSITORY_ERROR_CODES.CONDITIONAL_POST_READ_MISMATCH,
      });
    expect(repository.drafts.update).not.toHaveBeenCalled();
  });

  it('marks bounded active duplicates with updateMany', async () => {
    const repository = createDraftRepository(createSdk());
    await expect(markDuplicateDraftsSuperseded(
      repository,
      ['draft-duplicate-1', 'draft-duplicate-2'],
      'draft-canonical',
      '2026-08-05T12:00:00.000Z',
    )).resolves.toBe(2);
    expect(repository.drafts.updateMany).toHaveBeenCalledTimes(2);
    expect(repository.drafts.update).not.toHaveBeenCalled();
  });
});
