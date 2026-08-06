import { describe, expect, it } from 'vitest';
import {
  isDraftEligibleForAutomaticEmailRecovery,
  selectNewestEligibleDraft,
} from '../../base44/functions/_shared/proDraftIdentity/entry.ts';

const draft = (overrides = {}) => ({
  id: 'draft-synthetic',
  status: 'active',
  created_date: '2033-05-18T03:33:20.000Z',
  environment: 'staging',
  ...overrides,
});

describe('replacement transaction email selection', () => {
  it.each(['pending', 'orphaned', 'failed'])(
    'excludes %s replacements',
    (replacementTransactionStatus) => {
      expect(isDraftEligibleForAutomaticEmailRecovery(draft({
        replacement_transaction_status: replacementTransactionStatus,
      }), { expectedEnvironment: 'staging' })).toBe(false);
    },
  );

  it('includes committed replacements', () => {
    expect(isDraftEligibleForAutomaticEmailRecovery(draft({
      replacement_transaction_status: 'committed',
    }), { expectedEnvironment: 'staging' })).toBe(true);
  });

  it('keeps legacy records without transaction status eligible', () => {
    expect(isDraftEligibleForAutomaticEmailRecovery(draft(), {
      expectedEnvironment: 'staging',
    })).toBe(true);
  });

  it('selects a newer committed replacement over an older legacy draft', () => {
    const result = selectNewestEligibleDraft([
      draft({ id: 'legacy', created_date: '2033-05-17T03:33:20.000Z' }),
      draft({ id: 'pending', replacement_transaction_status: 'pending' }),
      draft({
        id: 'committed',
        replacement_transaction_status: 'committed',
        created_date: '2033-05-19T03:33:20.000Z',
      }),
    ], { expectedEnvironment: 'staging' });
    expect(result.selected?.id).toBe('committed');
  });
});
