import { describe, expect, it } from 'vitest';

import * as browserTime from '@/lib/proFormLogicalRecordTime';
import * as backendTime from '../../base44/functions/_shared/proFormLogicalRecordTime/entry.ts';

const implementations = [
  ['browser', browserTime],
  ['backend', backendTime],
];

describe.each(implementations)('Pro Form logical record time (%s)', (_name, subject) => {
  it('uses origin, immediate source, then destination creation time', () => {
    const record = {
      origin_created_at: '2024-01-01T00:00:00.000Z',
      source_created_date: '2025-01-01T00:00:00.000Z',
      created_date: '2026-01-01T00:00:00.000Z',
    };
    expect(subject.getLogicalCreatedAt(record)).toBe('2024-01-01T00:00:00.000Z');
    expect(subject.getSafeLogicalTimeDiagnostics(record).creationSource)
      .toBe('origin_created_at');
  });

  it('does not let an older origin update override a newer immediate source update', () => {
    const record = {
      origin_updated_at: '2024-01-01T00:00:00.000Z',
      source_updated_date: '2025-01-01T00:00:00.000Z',
      updated_date: '2026-01-01T00:00:00.000Z',
    };
    expect(subject.getLogicalUpdatedAt(record)).toBe('2025-01-01T00:00:00.000Z');
    expect(subject.getSafeLogicalTimeDiagnostics(record)).toMatchObject({
      updateSource: 'source_updated_date',
      warnings: expect.arrayContaining(['SOURCE_UPDATE_NEWER_THAN_ORIGIN']),
    });
  });

  it('uses destination update only as a fallback and last_saved_at only when allowed', () => {
    expect(subject.getLogicalUpdatedAt({
      updated_date: '2026-01-01T00:00:00.000Z',
      last_saved_at: '2027-01-01T00:00:00.000Z',
    }, { allowLastSavedAt: true })).toBe('2026-01-01T00:00:00.000Z');
    expect(subject.getLogicalUpdatedAt({
      last_saved_at: '2027-01-01T00:00:00.000Z',
    })).toBeNull();
    expect(subject.getLogicalUpdatedAt({
      last_saved_at: '2027-01-01T00:00:00.000Z',
    }, { allowLastSavedAt: true })).toBe('2027-01-01T00:00:00.000Z');
  });

  it('sorts valid logical times newest first without mutating records', () => {
    const older = Object.freeze({ origin_created_at: '2024-01-01T00:00:00.000Z' });
    const newer = Object.freeze({ created_date: '2025-01-01T00:00:00.000Z' });
    expect([older, newer].sort(subject.compareLogicalCreatedAt)).toEqual([newer, older]);
    expect(subject.compareLogicalUpdatedAt(
      { source_updated_date: '2025-01-01T00:00:00.000Z' },
      { source_updated_date: '2024-01-01T00:00:00.000Z' },
    )).toBeLessThan(0);
  });

  it('returns safe warnings for malformed or missing timestamps', () => {
    expect(subject.getSafeLogicalTimeDiagnostics({ origin_created_at: 'invalid' }))
      .toEqual({
        version: 1,
        logicalCreatedAt: null,
        logicalUpdatedAt: null,
        creationSource: null,
        updateSource: null,
        warnings: [
          'INVALID_ORIGIN_CREATED_AT',
          'LOGICAL_CREATED_AT_UNAVAILABLE',
          'LOGICAL_UPDATED_AT_UNAVAILABLE',
        ],
      });
  });
});
