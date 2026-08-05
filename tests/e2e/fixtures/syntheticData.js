import {
  createSyntheticBusinessName,
  createSyntheticEmail,
  createTestRunId,
} from '../helpers/testRunId.js';

export const createSyntheticE2ERecord = (providedRunId = process.env.E2E_TEST_RUN_ID) => {
  const testRunId = createTestRunId(providedRunId);
  return Object.freeze({
    business_name: createSyntheticBusinessName(testRunId),
    environment: 'staging',
    test_run_id: testRunId,
    user_email: createSyntheticEmail(testRunId),
  });
};
