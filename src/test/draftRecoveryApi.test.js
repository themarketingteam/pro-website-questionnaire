import { beforeEach, describe, expect, it } from 'vitest';
import { base44 } from '@/api/base44Client';
import {
  getRecoveryRequestErrorMessage,
  getRecoveryDraftVersion,
  listRecoveryDraftVersions,
  createRecoveryDraftVersionCopy,
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

  it('uses protected, record-scoped actions for version history and recovery copies', async () => {
    base44.functions.invoke.mockResolvedValue({ data: { success: true, versions: [] } });

    await listRecoveryDraftVersions({ recoveryGrant: 'signed-grant', recordId: 'draft-1', mode: 'all' });
    await getRecoveryDraftVersion({ recoveryGrant: 'signed-grant', recordId: 'draft-1', versionId: 'revision:rev-1' });
    await createRecoveryDraftVersionCopy({ recoveryGrant: 'signed-grant', recordId: 'draft-1', versionId: 'revision:rev-1' });

    expect(base44.functions.invoke).toHaveBeenNthCalledWith(1, 'queryProQuestionnaireRecoveryRecords', {
      action: 'list_versions',
      recoveryGrant: 'signed-grant',
      recordType: 'draft',
      recordId: 'draft-1',
      mode: 'all',
    });
    expect(base44.functions.invoke).toHaveBeenNthCalledWith(2, 'queryProQuestionnaireRecoveryRecords', {
      action: 'get_version',
      recoveryGrant: 'signed-grant',
      recordType: 'draft',
      recordId: 'draft-1',
      versionId: 'revision:rev-1',
    });
    expect(base44.functions.invoke).toHaveBeenNthCalledWith(3, 'queryProQuestionnaireRecoveryRecords', {
      action: 'create_version_copy',
      recoveryGrant: 'signed-grant',
      recordType: 'draft',
      recordId: 'draft-1',
      versionId: 'revision:rev-1',
    });
  });
});
