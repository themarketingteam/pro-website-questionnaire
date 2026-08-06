import { describe, expect, it } from 'vitest';
import {
  PRO_DRAFT_REPLACEMENT_VERSION,
  REPLACEMENT_ERROR_CODES,
  REPLACEMENT_OPERATION_TYPES,
  REPLACEMENT_TRANSACTION_STATUSES,
  getSafeReplacementDiagnostics,
} from '../../base44/functions/_shared/proDraftReplacement/entry.ts';

describe('replacement service contract', () => {
  it('exports the versioned operations, statuses, and error codes', () => {
    expect(PRO_DRAFT_REPLACEMENT_VERSION).toBe(1);
    expect(Object.values(REPLACEMENT_OPERATION_TYPES)).toEqual([
      'clear_all', 'start_new_after_submission',
    ]);
    expect(Object.values(REPLACEMENT_TRANSACTION_STATUSES)).toEqual([
      'pending', 'committed', 'orphaned', 'failed',
    ]);
    expect(REPLACEMENT_ERROR_CODES.SOURCE_UPDATE_CONFLICT).toBeTruthy();
  });

  it('reports deletion, submitted mutation, raw storage, and cache safety', () => {
    expect(getSafeReplacementDiagnostics()).toMatchObject({
      deletesSourceDraft: false,
      mutatesSubmittedCanonicalState: false,
      storesRawRecoveryCode: false,
      storesRawResumeToken: false,
      pendingEmailRecoverable: false,
      responsesCacheable: false,
    });
  });
});
