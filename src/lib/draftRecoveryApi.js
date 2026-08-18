import { base44 } from '@/api/base44Client';

const getResponseData = (response) => response?.data ?? response;

const invokeRecoveryQuery = async (payload) => {
  const response = await base44.functions.invoke('queryDraftRecoveryRecords', payload);
  const data = getResponseData(response);

  if (!data?.success) {
    throw new Error(data?.error || 'Unable to load recovery records.');
  }

  return data;
};

export const listRecoveryRecords = ({
  recoveryGrant,
  recordType,
  page = 1,
  pageSize = 25,
  status = 'all',
  archiveState = 'active',
  search = '',
}) => invokeRecoveryQuery({
  action: 'list',
  recoveryGrant,
  recordType,
  page,
  pageSize,
  status,
  archiveState,
  search,
});

export const getRecoveryRecord = ({ recoveryGrant, recordType, recordId }) => invokeRecoveryQuery({
  action: 'get',
  recoveryGrant,
  recordType,
  recordId,
});

export const updateRecoveryDraft = ({ recoveryGrant, recordId, updates }) => invokeRecoveryQuery({
  action: 'update',
  recoveryGrant,
  recordType: 'draft',
  recordId,
  updates,
});

export const changeRecoveryRecordLifecycle = async ({
  recoveryGrant,
  recordType,
  recordId,
  action,
  reason = '',
}) => {
  const response = await base44.functions.invoke('manageRecoveryRecordLifecycle', {
    recoveryGrant,
    recordType,
    recordId,
    action,
    reason,
  });
  const data = getResponseData(response);
  if (!data?.success) throw new Error(data?.error || 'Unable to change the recovery record state.');
  return data;
};

export const reviewIdentityCandidate = async ({
  recoveryGrant,
  attemptId,
  field,
  decision,
  expectedFingerprint,
}) => {
  const response = await base44.functions.invoke('reviewProQuestionnaireIdentityCandidate', {
    recoveryGrant,
    attemptId,
    field,
    decision,
    expectedFingerprint,
  });
  const data = getResponseData(response);
  if (!data?.success) {
    throw new Error(data?.error || 'Unable to review the identity candidate.');
  }
  return data;
};
