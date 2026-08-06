import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import fixtures from './fixtures/proDraftIdentityConformance.json';
import {
  DRAFT_LIFECYCLE_STATUS_VALUES,
  EMAIL_RECOVERY_ELIGIBLE_STATUSES,
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_ENTROPY_BITS,
  RECOVERY_CODE_ERROR_CODES,
  RECOVERY_CODE_GROUP_COUNT,
  RECOVERY_CODE_GROUP_SIZE,
  RECOVERY_CODE_LENGTH,
  RECOVERY_CODE_VERSION,
  RecoveryCodeContractError,
  encodeRecoveryCodeFromRandomValues,
  formatRecoveryCode,
  getSafeDraftSelectionDiagnostics,
  getSafeRecoveryCodeDiagnostics,
  isDraftEligibleForAutomaticEmailRecovery,
  normalizeLegacyDraftStatus,
  normalizeRecoveryCodeInput,
  normalizeRecoveryEmail,
  selectNewestEligibleDraft,
  sortDraftsForEmailRecovery,
  validateRecoveryCodeFormat,
} from '../../base44/functions/_shared/proDraftIdentity/entry.ts';

const makeRecord = (status, overrides = {}) => ({
  id: `synthetic-${status}`,
  status,
  environment: 'production',
  created_date: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('backend recovery-code conformance', () => {
  it('matches every shared recovery-code constant', () => {
    expect(RECOVERY_CODE_VERSION).toBe(fixtures.contract.recoveryCodeVersion);
    expect(RECOVERY_CODE_ALPHABET).toBe(fixtures.contract.alphabet);
    expect(RECOVERY_CODE_LENGTH).toBe(fixtures.contract.length);
    expect(RECOVERY_CODE_GROUP_SIZE).toBe(fixtures.contract.groupSize);
    expect(RECOVERY_CODE_GROUP_COUNT).toBe(fixtures.contract.groupCount);
    expect(RECOVERY_CODE_ENTROPY_BITS)
      .toBeGreaterThanOrEqual(fixtures.contract.minimumEntropyBits);
    expect(DRAFT_LIFECYCLE_STATUS_VALUES).toEqual(fixtures.contract.lifecycleStatuses);
    expect(EMAIL_RECOVERY_ELIGIBLE_STATUSES)
      .toEqual(fixtures.contract.emailRecoveryEligibleStatuses);
  });

  it.each(fixtures.recoveryCodeNormalization)(
    'matches shared normalization fixture: $name',
    ({ input, valid, normalizedCode, errorCode }) => {
      expect(normalizeRecoveryCodeInput(input)).toMatchObject({
        valid,
        normalizedCode,
        errorCode,
      });
    },
  );

  it.each(fixtures.deterministicEncoding)(
    'encodes deterministic vector: $name',
    ({ bytes, normalizedCode }) => {
      const encoded = encodeRecoveryCodeFromRandomValues(Uint8Array.from(bytes));
      expect(encoded).toBe(normalizedCode);
      expect(validateRecoveryCodeFormat(encoded).valid).toBe(true);
      expect(formatRecoveryCode(encoded)).toBe(
        fixtures.recoveryCodeFormatting[0].formattedCode,
      );
    },
  );

  it('uses unbiased rejection sampling for bytes 248 through 255', () => {
    const rejectedTail = Array.from({ length: 8 }, (_, index) => 248 + index);
    const accepted = fixtures.deterministicEncoding[0].bytes;
    expect(encodeRecoveryCodeFromRandomValues([...rejectedTail, ...accepted]))
      .toBe(fixtures.deterministicEncoding[0].normalizedCode);
  });

  it('throws a typed insufficient-entropy error after finite input is exhausted', () => {
    try {
      encodeRecoveryCodeFromRandomValues([
        ...Array.from({ length: 8 }, (_, index) => 248 + index),
        ...fixtures.deterministicEncoding[0].bytes.slice(0, 19),
      ]);
      throw new Error('Expected insufficient accepted bytes to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(RecoveryCodeContractError);
      expect(error.code).toBe(RECOVERY_CODE_ERROR_CODES.INSUFFICIENT_ENTROPY);
    }
  });

  it('rejects invalid caller-supplied byte values', () => {
    expect(() => encodeRecoveryCodeFromRandomValues([0, 256]))
      .toThrow(RecoveryCodeContractError);
    expect(() => encodeRecoveryCodeFromRandomValues([0, 1.5]))
      .toThrow(RecoveryCodeContractError);
  });

  it('keeps recovery-code diagnostics code-free', () => {
    const fixture = fixtures.recoveryCodeFormatting[0];
    const diagnostics = getSafeRecoveryCodeDiagnostics(fixture.formattedCode);
    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain(fixture.normalizedCode);
    expect(serialized).not.toContain(fixture.formattedCode);
    expect(serialized).not.toContain(fixture.hint);
  });

  it('contains no random-number source', () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        'base44/functions/_shared/proDraftIdentity/entry.ts',
      ),
      'utf8',
    );
    expect(source).not.toMatch(/Math\s*\.\s*random\s*\(/u);
    expect(source).not.toMatch(/crypto\s*\.\s*getRandomValues\s*\(/u);
  });
});

describe('backend status and email-recovery selection conformance', () => {
  it('normalizes an email association without claiming ownership verification', () => {
    expect(normalizeRecoveryEmail('  Synthetic.User@EXAMPLE.test  ')).toMatchObject({
      valid: true,
      normalizedEmail: 'synthetic.user@example.test',
      normalizationVersion: 1,
    });
    expect(normalizeRecoveryEmail('not-an-email')).toMatchObject({
      valid: false,
      normalizedEmail: '',
    });
  });

  it.each(fixtures.statusNormalization)(
    'normalizes status $input to $expected',
    ({ input, isValidLegacyDraft, expected }) => {
      expect(normalizeLegacyDraftStatus(input, { isValidLegacyDraft }))
        .toBe(expected);
    },
  );

  it.each(fixtures.eligibility)(
    'marks $status eligibility as $eligible',
    ({ status, eligible }) => {
      expect(isDraftEligibleForAutomaticEmailRecovery(makeRecord(status), {
        expectedEnvironment: 'production',
      })).toBe(eligible);
    },
  );

  it('accepts a valid blank-status legacy record as active', () => {
    expect(isDraftEligibleForAutomaticEmailRecovery(makeRecord(''))).toBe(true);
  });

  it.each(fixtures.selections)(
    'selects shared fixture: $name',
    ({ records, options, selectedId, eligibleCount, warnings }) => {
      const result = selectNewestEligibleDraft(records, options);
      expect(result.selected?.id).toBe(selectedId);
      expect(result.eligibleCount).toBe(eligibleCount);
      expect(result.excludedCount).toBe(records.length - eligibleCount);
      expect(result.diagnostics.warnings).toEqual(warnings);
    },
  );

  it('selects a newer submitted record over an older active record', () => {
    const fixture = fixtures.selections.find(
      ({ name }) => name === 'submitted newest wins over active older',
    );
    const result = selectNewestEligibleDraft(fixture.records, fixture.options);
    expect(result.selected).toMatchObject({
      id: 'draft-submitted-newest',
      status: 'submitted',
    });
  });

  it('excludes superseded, soft-deleted, retention-deleted, and mismatched records', () => {
    const records = [
      makeRecord('active', { id: 'eligible' }),
      makeRecord('active', { id: 'superseded', superseded_by_draft_id: 'replacement' }),
      makeRecord('active', { id: 'soft-delete', is_deleted: true }),
      makeRecord('active', { id: 'retention-delete', retention_deletion_finalized: true }),
      makeRecord('active', { id: 'staging', environment: 'staging' }),
      makeRecord('active', { id: 'test-flag', is_test: true }),
    ];
    const result = selectNewestEligibleDraft(records, {
      expectedEnvironment: 'production',
    });
    expect(result.selected?.id).toBe('eligible');
    expect(result.eligibleCount).toBe(1);
    expect(result.excludedCount).toBe(5);
  });

  it('excludes a draft whose retention deadline has elapsed', () => {
    const result = selectNewestEligibleDraft([
      makeRecord('active', {
        id: 'expired-by-retention',
        retention_expires_at: '2026-01-02T00:00:00.000Z',
      }),
      makeRecord('active', {
        id: 'still-eligible',
        created_date: '2025-12-01T00:00:00.000Z',
        retention_expires_at: '2026-12-01T00:00:00.000Z',
      }),
    ], {
      expectedEnvironment: 'production',
      now: new Date('2026-02-01T00:00:00.000Z'),
    });
    expect(result.selected?.id).toBe('still-eligible');
  });

  it('keeps a native green draft newest when an older blue draft is imported later', () => {
    const records = [
      makeRecord('active', {
        id: 'imported-blue',
        origin_record_id: 'blue-draft-1',
        origin_created_at: '2025-01-01T00:00:00.000Z',
        created_date: '2026-08-06T12:00:00.000Z',
      }),
      makeRecord('active', {
        id: 'native-green',
        created_date: '2025-06-01T00:00:00.000Z',
      }),
    ];
    expect(sortDraftsForEmailRecovery(records)[0].id).toBe('native-green');
  });

  it('preserves the original blue creation order for multiple migrated drafts', () => {
    const records = [
      makeRecord('active', {
        id: 'green-import-later',
        origin_record_id: 'blue-later',
        origin_created_at: '2025-02-01T00:00:00.000Z',
        created_date: '2026-08-06T12:00:00.000Z',
      }),
      makeRecord('active', {
        id: 'green-import-earlier',
        origin_record_id: 'blue-earlier',
        origin_created_at: '2025-01-01T00:00:00.000Z',
        created_date: '2026-08-06T12:01:00.000Z',
      }),
    ];
    expect(sortDraftsForEmailRecovery(records).map(({ id }) => id)).toEqual([
      'green-import-later',
      'green-import-earlier',
    ]);
  });

  it('uses origin, source, then destination identity as stable logical ties', () => {
    const created = '2025-01-01T00:00:00.000Z';
    const records = [
      makeRecord('active', {
        id: 'destination-z', origin_record_id: 'origin-a', source_record_id: 'source-z',
        origin_created_at: created,
      }),
      makeRecord('active', {
        id: 'destination-a', origin_record_id: 'origin-z', source_record_id: 'source-a',
        origin_created_at: created,
      }),
    ];
    expect(sortDraftsForEmailRecovery(records)[0].id).toBe('destination-a');
  });

  it('does not mutate source records or input order', () => {
    const records = fixtures.selections[0].records.map((record) => ({ ...record }));
    const before = structuredClone(records);
    selectNewestEligibleDraft(records, fixtures.selections[0].options);
    expect(records).toEqual(before);
  });

  it('safe selection diagnostics omit record PII and answer content', () => {
    const markerEmail = 'private.synthetic@example.test';
    const markerAnswer = 'SYNTHETIC_PRIVATE_ANSWER_MARKER';
    const result = selectNewestEligibleDraft([
      makeRecord('active', {
        recovery_email: markerEmail,
        answers: { q1: markerAnswer },
      }),
    ]);
    const diagnostics = getSafeDraftSelectionDiagnostics(result.diagnostics);
    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain(markerEmail);
    expect(serialized).not.toContain(markerAnswer);
    expect(Object.keys(diagnostics)).toEqual([
      'version',
      'selected',
      'eligibleCount',
      'excludedCount',
      'warnings',
    ]);
  });

  it('never treats email fields as authorization or a selection criterion', () => {
    const records = [
      makeRecord('active', {
        id: 'older-same-email',
        created_date: '2026-01-01T00:00:00.000Z',
        recovery_email: 'association@example.test',
      }),
      makeRecord('active', {
        id: 'newer-different-email',
        created_date: '2026-02-01T00:00:00.000Z',
        recovery_email: 'different@example.test',
      }),
    ];
    expect(selectNewestEligibleDraft(records).selected?.id)
      .toBe('newer-different-email');
  });
});
