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
  deriveRecoveryCodeHint,
  formatRecoveryCode,
  getSafeRecoveryCodeDiagnostics,
  normalizeRecoveryCodeInput,
  validateRecoveryCodeFormat,
} from '@/lib/proDraftRecoveryCodeContract';

describe('frontend recovery-code conformance', () => {
  it('matches the shared constants and status values', () => {
    expect(RECOVERY_CODE_VERSION).toBe(fixtures.contract.recoveryCodeVersion);
    expect(RECOVERY_CODE_ALPHABET).toBe(fixtures.contract.alphabet);
    expect(RECOVERY_CODE_LENGTH).toBe(fixtures.contract.length);
    expect(RECOVERY_CODE_GROUP_SIZE).toBe(fixtures.contract.groupSize);
    expect(RECOVERY_CODE_GROUP_COUNT).toBe(fixtures.contract.groupCount);
    expect(DRAFT_LIFECYCLE_STATUS_VALUES).toEqual(fixtures.contract.lifecycleStatuses);
    expect(EMAIL_RECOVERY_ELIGIBLE_STATUSES)
      .toEqual(fixtures.contract.emailRecoveryEligibleStatuses);
    expect(RECOVERY_CODE_ENTROPY_BITS).toBeGreaterThanOrEqual(
      fixtures.contract.minimumEntropyBits,
    );
  });

  it.each(fixtures.recoveryCodeNormalization)(
    'normalizes shared fixture: $name',
    ({ input, valid, normalizedCode, errorCode }) => {
      expect(normalizeRecoveryCodeInput(input)).toMatchObject({
        valid,
        normalizedCode,
        errorCode,
      });
    },
  );

  it('accepts lowercase, spaces, hyphens, and mixed permitted separators', () => {
    const validNames = ['lowercase', 'spaces', 'hyphens', 'mixed separators'];
    for (const fixture of fixtures.recoveryCodeNormalization) {
      if (validNames.includes(fixture.name)) {
        expect(normalizeRecoveryCodeInput(fixture.input).valid).toBe(true);
      }
    }
  });

  it.each(['0', '1', 'I', 'L', 'O'])(
    'rejects ambiguous character %s',
    (character) => {
      const input = `${character}3456789ABCDEFGHJKMN`;
      expect(input).toHaveLength(RECOVERY_CODE_LENGTH);
      expect(normalizeRecoveryCodeInput(input).errorCode)
        .toBe(RECOVERY_CODE_ERROR_CODES.INVALID_CHARACTER);
    },
  );

  it.each(['!', '_', '.', '/', '\t'])(
    'does not strip arbitrary punctuation or whitespace %p',
    (character) => {
      const input = `${character}3456789ABCDEFGHJKMN`;
      expect(normalizeRecoveryCodeInput(input).valid).toBe(false);
    },
  );

  it('formats only an exact valid normalized code', () => {
    const fixture = fixtures.recoveryCodeFormatting[0];
    expect(formatRecoveryCode(fixture.normalizedCode)).toBe(fixture.formattedCode);
    expect(() => formatRecoveryCode(fixture.formattedCode))
      .toThrow(RecoveryCodeContractError);
    expect(() => formatRecoveryCode(fixture.normalizedCode.toLowerCase()))
      .toThrow(RecoveryCodeContractError);
  });

  it('validates without returning the normalized code', () => {
    const result = validateRecoveryCodeFormat('2345-6789-ABCD-EFGH-JKMN');
    expect(result).toEqual({
      valid: true,
      normalizedLength: RECOVERY_CODE_LENGTH,
      errorCode: null,
    });
    expect(result).not.toHaveProperty('normalizedCode');
  });

  it('derives only the safe last-four hint', () => {
    const fixture = fixtures.recoveryCodeFormatting[0];
    expect(deriveRecoveryCodeHint(fixture.formattedCode)).toBe(fixture.hint);
    expect(deriveRecoveryCodeHint(fixture.formattedCode)).toHaveLength(4);
    expect(() => deriveRecoveryCodeHint('invalid'))
      .toThrow(RecoveryCodeContractError);
  });

  it('safe diagnostics omit raw, normalized, and hinted code values', () => {
    const fixture = fixtures.recoveryCodeFormatting[0];
    const diagnostics = getSafeRecoveryCodeDiagnostics(fixture.formattedCode);
    const serialized = JSON.stringify(diagnostics);

    expect(diagnostics).toEqual({
      version: RECOVERY_CODE_VERSION,
      valid: true,
      normalizedLength: RECOVERY_CODE_LENGTH,
      errorCode: null,
    });
    expect(serialized).not.toContain(fixture.normalizedCode);
    expect(serialized).not.toContain(fixture.formattedCode);
    expect(serialized).not.toContain(fixture.hint);
  });

  it('returns frozen normalization and diagnostic results', () => {
    expect(Object.isFrozen(normalizeRecoveryCodeInput('23456789ABCDEFGHJKMN')))
      .toBe(true);
    expect(Object.isFrozen(getSafeRecoveryCodeDiagnostics('invalid'))).toBe(true);
  });
});
