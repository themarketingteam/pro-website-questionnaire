/** Client-injected Base44 repository for authoritative draft backend functions. */

export const PRO_DRAFT_REPOSITORY_VERSION = 1;
export const DEFAULT_DRAFT_QUERY_LIMIT = 25;
export const MAX_DRAFT_QUERY_LIMIT = 100;
export const MAX_EVENT_QUERY_LIMIT = 500;

export const PRO_DRAFT_REPOSITORY_ERROR_CODES = Object.freeze({
  CLIENT_INVALID: 'PRO_DRAFT_REPOSITORY_CLIENT_INVALID',
  INPUT_INVALID: 'PRO_DRAFT_REPOSITORY_INPUT_INVALID',
  READ_FAILED: 'PRO_DRAFT_REPOSITORY_READ_FAILED',
  WRITE_FAILED: 'PRO_DRAFT_REPOSITORY_WRITE_FAILED',
  CONDITIONAL_CONFLICT: 'PRO_DRAFT_REPOSITORY_CONDITIONAL_CONFLICT',
  CONDITIONAL_POST_READ_MISMATCH:
    'PRO_DRAFT_REPOSITORY_CONDITIONAL_POST_READ_MISMATCH',
  CONDITIONAL_UPDATE_UNSUPPORTED:
    'BLOCKED_BASE44_CONDITIONAL_UPDATE_UNSUPPORTED',
} as const);

export type DraftRepositoryErrorCode = typeof PRO_DRAFT_REPOSITORY_ERROR_CODES[
  keyof typeof PRO_DRAFT_REPOSITORY_ERROR_CODES
];
export type DraftRecord = Readonly<Record<string, unknown>>;

type Query = Readonly<Record<string, unknown>>;
type MutableRecord = Record<string, unknown>;

interface Base44EntityApi {
  filter(
    query: Query,
    sort?: string,
    limit?: number,
    skip?: number,
    fields?: string,
  ): Promise<unknown>;
  get(id: string): Promise<unknown>;
  create(data: MutableRecord): Promise<unknown>;
  update(id: string, data: MutableRecord): Promise<unknown>;
  updateMany(query: Query, data: MutableRecord): Promise<unknown>;
  bulkCreate(data: MutableRecord[]): Promise<unknown>;
}

export interface DraftRepository {
  readonly drafts: Base44EntityApi;
  readonly events: Base44EntityApi;
}

export interface ConditionalDraftUpdateInput {
  readonly draftId: string;
  readonly expectedServerRevision: number;
  readonly expectedStatus?: string;
  readonly acceptedStateHash: string;
  readonly acceptedStatus: string;
  readonly changes: Readonly<Record<string, unknown>>;
}

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const STATUS_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;
const ENTITY_METHODS = Object.freeze([
  'filter', 'get', 'create', 'update', 'updateMany', 'bulkCreate',
] as const);

export class ProDraftRepositoryError extends Error {
  readonly code: DraftRepositoryErrorCode;
  readonly retryable: boolean;

  constructor(code: DraftRepositoryErrorCode, retryable = false) {
    super('The draft repository operation failed.');
    this.name = 'ProDraftRepositoryError';
    this.code = code;
    this.retryable = retryable;
  }
}

function repositoryError(
  code: DraftRepositoryErrorCode,
  retryable = false,
): never {
  throw new ProDraftRepositoryError(code, retryable);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireId(value: unknown): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    return repositoryError(PRO_DRAFT_REPOSITORY_ERROR_CODES.INPUT_INVALID);
  }
  return value;
}

function requireHash(value: unknown): string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    return repositoryError(PRO_DRAFT_REPOSITORY_ERROR_CODES.INPUT_INVALID);
  }
  return value;
}

function boundedLimit(value: unknown, maximum: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
    return repositoryError(PRO_DRAFT_REPOSITORY_ERROR_CODES.INPUT_INVALID);
  }
  return Number(value);
}

function records(value: unknown): DraftRecord[] {
  if (!Array.isArray(value) || value.some((record) => !isPlainObject(record))) {
    return repositoryError(PRO_DRAFT_REPOSITORY_ERROR_CODES.READ_FAILED, true);
  }
  return value as DraftRecord[];
}

function record(value: unknown): DraftRecord {
  if (!isPlainObject(value)) {
    return repositoryError(PRO_DRAFT_REPOSITORY_ERROR_CODES.READ_FAILED, true);
  }
  return value;
}

function requireRepository(value: unknown): DraftRepository {
  if (!isPlainObject(value)
    || !isPlainObject(value.drafts)
    || !isPlainObject(value.events)) {
    return repositoryError(PRO_DRAFT_REPOSITORY_ERROR_CODES.CLIENT_INVALID);
  }
  for (const entity of [value.drafts, value.events]) {
    for (const method of ENTITY_METHODS) {
      if (typeof entity[method] !== 'function') {
        return repositoryError(PRO_DRAFT_REPOSITORY_ERROR_CODES.CLIENT_INVALID);
      }
    }
  }
  return value as unknown as DraftRepository;
}

async function safeRead<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ProDraftRepositoryError) throw error;
    return repositoryError(PRO_DRAFT_REPOSITORY_ERROR_CODES.READ_FAILED, true);
  }
}

async function safeWrite<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ProDraftRepositoryError) throw error;
    return repositoryError(PRO_DRAFT_REPOSITORY_ERROR_CODES.WRITE_FAILED, true);
  }
}

export function createDraftRepository(base44: unknown): DraftRepository {
  if (!isPlainObject(base44)
    || !isPlainObject(base44.asServiceRole)
    || !isPlainObject(base44.asServiceRole.entities)) {
    return repositoryError(PRO_DRAFT_REPOSITORY_ERROR_CODES.CLIENT_INVALID);
  }
  return requireRepository(Object.freeze({
    drafts: base44.asServiceRole.entities.ProFormDraft,
    events: base44.asServiceRole.entities.ProFormDraftEvent,
  }));
}

export async function getDraftById(
  repository: DraftRepository,
  draftId: unknown,
): Promise<DraftRecord> {
  const repo = requireRepository(repository);
  return safeRead(async () => record(await repo.drafts.get(requireId(draftId))));
}

async function findDraftsByHash(
  repository: DraftRepository,
  field: string,
  hash: unknown,
  limit?: unknown,
): Promise<readonly DraftRecord[]> {
  const repo = requireRepository(repository);
  const queryLimit = boundedLimit(
    limit,
    MAX_DRAFT_QUERY_LIMIT,
    DEFAULT_DRAFT_QUERY_LIMIT,
  );
  return safeRead(async () => Object.freeze(records(await repo.drafts.filter(
    { [field]: requireHash(hash) },
    '-updated_date',
    queryLimit,
    0,
  ))));
}

export function findDraftsByResumeTokenHash(
  repository: DraftRepository,
  hash: unknown,
  limit?: unknown,
): Promise<readonly DraftRecord[]> {
  return findDraftsByHash(repository, 'resume_token_hash', hash, limit);
}

export function findDraftsByIdentityKeyHash(
  repository: DraftRepository,
  hash: unknown,
  limit?: unknown,
): Promise<readonly DraftRecord[]> {
  return findDraftsByHash(repository, 'identity_key_hash', hash, limit);
}

export function findDraftsByRecoveryEmailLookupHash(
  repository: DraftRepository,
  hash: unknown,
  limit?: unknown,
): Promise<readonly DraftRecord[]> {
  return findDraftsByHash(repository, 'recovery_email_lookup_hash', hash, limit);
}

export function findDraftsByRecoveryCodeHash(
  repository: DraftRepository,
  hash: unknown,
  limit?: unknown,
): Promise<readonly DraftRecord[]> {
  return findDraftsByHash(repository, 'recovery_code_hash', hash, limit);
}

export async function findDraftByBootstrapIdempotencyHash(
  repository: DraftRepository,
  hash: unknown,
): Promise<DraftRecord | null> {
  const matches = await findDraftsByHash(
    repository,
    'bootstrap_idempotency_key_hash',
    hash,
    2,
  );
  if (matches.length > 1) {
    return repositoryError(PRO_DRAFT_REPOSITORY_ERROR_CODES.READ_FAILED);
  }
  return matches[0] ?? null;
}

export async function createDraftRecord(
  repository: DraftRepository,
  data: unknown,
): Promise<DraftRecord> {
  const repo = requireRepository(repository);
  if (!isPlainObject(data)) {
    return repositoryError(PRO_DRAFT_REPOSITORY_ERROR_CODES.INPUT_INVALID);
  }
  return safeWrite(async () => record(await repo.drafts.create({ ...data })));
}

export async function updateDraftRecord(
  repository: DraftRepository,
  draftId: unknown,
  data: unknown,
): Promise<DraftRecord> {
  const repo = requireRepository(repository);
  if (!isPlainObject(data) || Object.hasOwn(data, 'id')) {
    return repositoryError(PRO_DRAFT_REPOSITORY_ERROR_CODES.INPUT_INVALID);
  }
  return safeWrite(async () => record(await repo.drafts.update(
    requireId(draftId),
    { ...data },
  )));
}

export async function conditionalUpdateDraftRecord(
  repository: DraftRepository,
  input: ConditionalDraftUpdateInput,
): Promise<DraftRecord> {
  const repo = requireRepository(repository);
  if (!isPlainObject(input)
    || !Number.isSafeInteger(input.expectedServerRevision)
    || input.expectedServerRevision < 0
    || !isPlainObject(input.changes)
    || Object.hasOwn(input.changes, 'id')
    || Object.hasOwn(input.changes, 'server_revision')) {
    return repositoryError(PRO_DRAFT_REPOSITORY_ERROR_CODES.INPUT_INVALID);
  }
  const draftId = requireId(input.draftId);
  const acceptedStateHash = requireHash(input.acceptedStateHash);
  if (!STATUS_PATTERN.test(input.acceptedStatus)
    || (input.expectedStatus !== undefined
      && !STATUS_PATTERN.test(input.expectedStatus))) {
    return repositoryError(PRO_DRAFT_REPOSITORY_ERROR_CODES.INPUT_INVALID);
  }
  if (typeof repo.drafts.updateMany !== 'function') {
    return repositoryError(
      PRO_DRAFT_REPOSITORY_ERROR_CODES.CONDITIONAL_UPDATE_UNSUPPORTED,
    );
  }
  const query: Record<string, unknown> = {
    id: draftId,
    server_revision: input.expectedServerRevision,
  };
  if (input.expectedStatus !== undefined) query.status = input.expectedStatus;
  let result: unknown;
  try {
    result = await repo.drafts.updateMany(query, {
      $set: {
        ...input.changes,
        state_hash: acceptedStateHash,
        status: input.acceptedStatus,
      },
      $inc: { server_revision: 1 },
    });
  } catch {
    return repositoryError(PRO_DRAFT_REPOSITORY_ERROR_CODES.WRITE_FAILED, true);
  }
  if (!isPlainObject(result) || !Number.isSafeInteger(result.updated)) {
    return repositoryError(
      PRO_DRAFT_REPOSITORY_ERROR_CODES.CONDITIONAL_UPDATE_UNSUPPORTED,
    );
  }
  if (result.updated === 0) {
    return repositoryError(PRO_DRAFT_REPOSITORY_ERROR_CODES.CONDITIONAL_CONFLICT);
  }
  if (result.updated !== 1) {
    return repositoryError(
      PRO_DRAFT_REPOSITORY_ERROR_CODES.CONDITIONAL_UPDATE_UNSUPPORTED,
    );
  }
  const accepted = await getDraftById(repo, draftId);
  if (accepted.server_revision !== input.expectedServerRevision + 1
    || accepted.state_hash !== acceptedStateHash
    || accepted.status !== input.acceptedStatus) {
    return repositoryError(
      PRO_DRAFT_REPOSITORY_ERROR_CODES.CONDITIONAL_POST_READ_MISMATCH,
    );
  }
  return accepted;
}

export async function listDraftEventsByDraftId(
  repository: DraftRepository,
  draftId: unknown,
  limit?: unknown,
): Promise<readonly DraftRecord[]> {
  const repo = requireRepository(repository);
  const queryLimit = boundedLimit(limit, MAX_EVENT_QUERY_LIMIT, 100);
  return safeRead(async () => Object.freeze(records(await repo.events.filter(
    { draft_id: requireId(draftId) },
    '-created_date',
    queryLimit,
    0,
  ))));
}

export async function findDraftEventsByEventIds(
  repository: DraftRepository,
  draftId: unknown,
  eventIds: unknown,
): Promise<readonly DraftRecord[]> {
  const repo = requireRepository(repository);
  if (!Array.isArray(eventIds)
    || eventIds.length < 1
    || eventIds.length > MAX_EVENT_QUERY_LIMIT) {
    return repositoryError(PRO_DRAFT_REPOSITORY_ERROR_CODES.INPUT_INVALID);
  }
  const ids = eventIds.map(requireId);
  return safeRead(async () => Object.freeze(records(await repo.events.filter(
    { draft_id: requireId(draftId), event_id: { $in: ids } },
    '-created_date',
    ids.length,
    0,
  ))));
}

export async function createDraftEvents(
  repository: DraftRepository,
  data: unknown,
): Promise<readonly DraftRecord[]> {
  const repo = requireRepository(repository);
  if (!Array.isArray(data)
    || data.length < 1
    || data.length > 50
    || data.some((item) => !isPlainObject(item))) {
    return repositoryError(PRO_DRAFT_REPOSITORY_ERROR_CODES.INPUT_INVALID);
  }
  return safeWrite(async () => Object.freeze(records(await repo.events.bulkCreate(
    data.map((item) => ({ ...item })),
  ))));
}

export async function markDuplicateDraftsSuperseded(
  repository: DraftRepository,
  draftIds: unknown,
  replacementDraftId: unknown,
  supersededAt: unknown,
): Promise<number> {
  const repo = requireRepository(repository);
  if (!Array.isArray(draftIds)
    || draftIds.length < 1
    || draftIds.length > MAX_DRAFT_QUERY_LIMIT
    || typeof supersededAt !== 'string'
    || Number.isNaN(Date.parse(supersededAt))) {
    return repositoryError(PRO_DRAFT_REPOSITORY_ERROR_CODES.INPUT_INVALID);
  }
  const replacement = requireId(replacementDraftId);
  let updated = 0;
  for (const draftId of draftIds.map(requireId)) {
    if (draftId === replacement) {
      return repositoryError(PRO_DRAFT_REPOSITORY_ERROR_CODES.INPUT_INVALID);
    }
    const result = await safeWrite(() => repo.drafts.updateMany(
      { id: draftId, status: 'active' },
      {
        $set: {
          status: 'cleared_superseded',
          replacement_draft_id: replacement,
          superseded_at: supersededAt,
          superseded_reason: 'duplicate_bootstrap',
        },
      },
    ));
    if (!isPlainObject(result) || !Number.isSafeInteger(result.updated)) {
      return repositoryError(
        PRO_DRAFT_REPOSITORY_ERROR_CODES.CONDITIONAL_UPDATE_UNSUPPORTED,
      );
    }
    updated += Number(result.updated);
  }
  return updated;
}

export function getSafeRepositoryDiagnostics(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    version: PRO_DRAFT_REPOSITORY_VERSION,
    clientInjectionRequired: true,
    serviceRoleOnly: true,
    defaultDraftQueryLimit: DEFAULT_DRAFT_QUERY_LIMIT,
    maxDraftQueryLimit: MAX_DRAFT_QUERY_LIMIT,
    maxEventQueryLimit: MAX_EVENT_QUERY_LIMIT,
    methods: ENTITY_METHODS,
    conditionalUpdate: 'updateMany_then_verified_get',
  });
}
