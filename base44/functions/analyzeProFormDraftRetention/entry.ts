import { createClientFromRequest } from 'npm:@base44/sdk';
import { ADMIN_API_ERROR_CODES, ADMIN_API_OPERATION_NAMES, adminApiError, createAdminFunctionHandler } from '../_shared/proDraftAdminRequest/entry.ts';
import { PRO_FORM_RETENTION_APPLY_SECRET, hashRetentionAdminGrantTokenId } from '../_shared/proDraftRetentionAuthorization/entry.ts';
import { createRetentionRepository } from '../_shared/proDraftRetentionRepository/entry.ts';
import { analyzeRetentionPage } from '../_shared/proDraftRetentionService/entry.ts';

const monthlyBatchId = (environment: string) => {
  const month = new Date().toISOString().slice(0, 7).replace('-', '');
  return `retention-v1-${environment}-${month}`;
};

Deno.serve(createAdminFunctionHandler({
  operation: ADMIN_API_OPERATION_NAMES.ANALYZE_RETENTION,
  maxBytes: 32 * 1024,
  createClientFromRequest,
  getEnvironmentValue: (name) => Deno.env.get(name),
  execute: async ({ client, authorization, payload }) => {
    if (payload.environment !== undefined && payload.environment !== authorization.environment) {
      adminApiError(ADMIN_API_ERROR_CODES.AUTHORIZATION_DENIED, 403);
    }
    const repository = createRetentionRepository(client.asServiceRole?.entities as Record<string, unknown>);
    const batchId = typeof payload.batchId === 'string' ? payload.batchId : monthlyBatchId(authorization.environment);
    return analyzeRetentionPage(repository, {
      ...payload, batchId, environment: authorization.environment,
      requestId: authorization.requestId,
      adminGrantTokenIdHash: await hashRetentionAdminGrantTokenId(authorization.tokenId),
    }, {
      secret: Deno.env.get(PRO_FORM_RETENTION_APPLY_SECRET),
      environmentValues: (name: string) => Deno.env.get(name),
    });
  },
}));
