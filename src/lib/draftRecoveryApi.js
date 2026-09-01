import { base44 } from '@/api/base44Client';

const getResponseData = (response) => response?.data ?? response;

const readableErrorValue = (value) => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object') {
    return readableErrorValue(value.message)
      || readableErrorValue(value.error)
      || readableErrorValue(value.detail);
  }
  return '';
};

export const getRecoveryRequestErrorMessage = (error, fallback = 'Unable to load recovery records.') => (
  readableErrorValue(error?.response?.data?.error)
  || readableErrorValue(error?.response?.data?.detail)
  || readableErrorValue(error?.response?.data?.message)
  || readableErrorValue(error?.data?.error)
  || readableErrorValue(error?.data?.detail)
  || readableErrorValue(error?.message)
  || fallback
);

const invokeRecoveryFunction = async (functionName, payload, fallback) => {
  try {
    return await base44.functions.invoke(functionName, payload);
  } catch (error) {
    const normalizedError = new Error(getRecoveryRequestErrorMessage(error, fallback));
    normalizedError.status = error?.response?.status || error?.status;
    normalizedError.response = error?.response;
    throw normalizedError;
  }
};

const invokeRecoveryQuery = async (payload) => {
  const response = await invokeRecoveryFunction(
    'queryProQuestionnaireRecoveryRecords',
    payload,
    'Unable to load recovery records.'
  );
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

export const createRecoveryDraftShareLink = ({ recoveryGrant, recordId }) => invokeRecoveryQuery({
  action: 'create_share_link',
  recoveryGrant,
  recordType: 'draft',
  recordId,
});

export const changeRecoveryRecordLifecycle = async ({
  recoveryGrant,
  recordType,
  recordId,
  action,
  reason = '',
}) => {
  const response = await invokeRecoveryFunction('manageRecoveryRecordLifecycle', {
    recoveryGrant,
    recordType,
    recordId,
    action,
    reason,
  }, 'Unable to change the recovery record state.');
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
  const response = await invokeRecoveryFunction('reviewProQuestionnaireIdentityCandidate', {
    recoveryGrant,
    attemptId,
    field,
    decision,
    expectedFingerprint,
  }, 'Unable to review the identity candidate.');
  const data = getResponseData(response);
  if (!data?.success) {
    throw new Error(data?.error || 'Unable to review the identity candidate.');
  }
  return data;
};
