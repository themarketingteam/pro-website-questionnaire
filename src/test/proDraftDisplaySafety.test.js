import { describe, expect, it } from 'vitest';
import {
  formatSafeDraftStatus,
  formatSafeSavedTime,
  getRecoveryCodeDisplayState,
  getSafeRecoveryPanelDiagnostics,
  maskRecoveryEmail,
} from '@/lib/proDraftDisplaySafety';

describe('proDraftDisplaySafety', () => {
  it.each([
    ['isaac@example.com', 'i***@example.com'],
    ['ab@example.com', '***@example.com'],
    ['x@example.com', '***@example.com'],
  ])('masks %s without leaking short local parts', (input, expected) => {
    expect(maskRecoveryEmail(input)).toBe(expected);
  });

  it.each(['', 'missing-at.example.com', '@example.com', 'a@localhost', null])(
    'fails closed for invalid email %p',
    (input) => expect(maskRecoveryEmail(input)).toBeNull(),
  );

  it('formats safe statuses and locale-aware timestamps', () => {
    expect(formatSafeDraftStatus('active')).toBe('Active — editable');
    expect(formatSafeDraftStatus('submitted')).toBe('Submitted — read-only');
    expect(formatSafeDraftStatus('unknown')).toBe('Draft status unavailable');
    expect(formatSafeSavedTime('2026-08-06T12:00:00.000Z', {
      locale: 'en-US',
      timeZone: 'UTC',
    })).toContain('Aug 6, 2026');
    expect(formatSafeSavedTime('not-a-date')).toBeNull();
  });

  it('shows a full code only from a valid supplied vault value', () => {
    expect(getRecoveryCodeDisplayState({
      fullCode: '2345 6789 abcd efgh jkmn',
      hint: 'ZZZZ',
    })).toEqual({
      mode: 'full',
      fullCode: '2345-6789-ABCD-EFGH-JKMN',
      hint: 'JKMN',
      canCopy: true,
    });
    expect(getRecoveryCodeDisplayState({ hint: 'JKMN' })).toEqual({
      mode: 'hint', fullCode: null, hint: 'JKMN', canCopy: false,
    });
    expect(getRecoveryCodeDisplayState({ hint: 'bad!' }).mode).toBe('unavailable');
  });

  it('returns diagnostics without raw email, code, or token material', () => {
    const diagnostics = getSafeRecoveryPanelDiagnostics({
      recoveryEmail: 'isaac@example.com',
      codeDisplayState: getRecoveryCodeDisplayState({
        fullCode: '2345-6789-ABCD-EFGH-JKMN',
      }),
      draftStatus: 'active',
      storageMode: 'indexeddb',
      lastLocalSavedAt: '2026-08-06T12:00:00.000Z',
      recoverySessionToken: `${'a'.repeat(43)}.${'b'.repeat(43)}`,
    });
    const serialized = JSON.stringify(diagnostics);
    expect(diagnostics).toMatchObject({
      hasMaskedRecoveryEmail: true,
      hasFullRecoveryCode: true,
      recoveryCodeDisplayMode: 'full',
    });
    expect(serialized).not.toMatch(/isaac|2345|recoverySessionToken|aaa/);
  });
});
