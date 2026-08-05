import { randomUUID } from 'node:crypto';

const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;

export const isValidTestRunId = (value) => SAFE_RUN_ID.test(String(value || ''));

export const createTestRunId = (providedValue) => {
  const provided = String(providedValue || '').trim();
  if (provided) {
    if (!isValidTestRunId(provided)) {
      throw new Error('INVALID_E2E_TEST_RUN_ID');
    }
    return provided;
  }

  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `e2e-${timestamp}-${randomUUID().slice(0, 8)}`;
};

export const createSyntheticBusinessName = (testRunId) => {
  if (!isValidTestRunId(testRunId)) throw new Error('INVALID_E2E_TEST_RUN_ID');
  return `E2E STAGING ${testRunId}`;
};

export const createSyntheticEmail = (testRunId) => {
  if (!isValidTestRunId(testRunId)) throw new Error('INVALID_E2E_TEST_RUN_ID');
  return `e2e+${testRunId.toLowerCase()}@example.test`;
};
