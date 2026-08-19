import { beforeEach, describe, expect, it } from 'vitest';
import { base44 } from '@/api/base44Client';
import {
  getRecoveryRequestErrorMessage,
  listRecoveryRecords,
} from '@/lib/draftRecoveryApi';

describe('draft recovery API errors', () => {
  beforeEach(() => {
    base44.functions.invoke.mockReset();
  });

  it('surfaces the backend reason instead of the generic Axios HTTP message', async () => {
    base44.functions.invoke.mockRejectedValue({
      message: 'Request failed with status code 400',
      response: {
        status: 400,
        data: { success: false, error: 'Unsupported recovery record type.' },
      },
    });

    await expect(listRecoveryRecords({
      recoveryGrant: 'signed-grant',
      recordType: 'submission',
    })).rejects.toThrow('Unsupported recovery record type.');
  });

  it('understands Base44 detail and nested error response shapes', () => {
    expect(getRecoveryRequestErrorMessage({
      response: { data: { detail: 'Function version is unavailable.' } },
    })).toBe('Function version is unavailable.');
    expect(getRecoveryRequestErrorMessage({
      response: { data: { error: { message: 'Mapped payload is invalid.' } } },
    })).toBe('Mapped payload is invalid.');
  });
});
