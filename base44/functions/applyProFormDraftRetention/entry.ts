import { createClientFromRequest } from 'npm:@base44/sdk';
import { ADMIN_API_ERROR_CODES, ADMIN_API_OPERATION_NAMES, adminApiError, createAdminFunctionHandler } from '../_shared/proDraftAdminRequest/entry.ts';
import { PRO_FORM_RETENTION_APPLY_SECRET, hashRetentionAdminGrantTokenId, verifyRetentionApplyToken } from '../_shared/proDraftRetentionAuthorization/entry.ts';
import { createRetentionRepository } from '../_shared/proDraftRetentionRepository/entry.ts';
import { applyRetentionPage } from '../_shared/proDraftRetentionService/entry.ts';

Deno.serve(createAdminFunctionHandler({
  operation: ADMIN_API_OPERATION_NAMES.APPLY_RETENTION,
  maxBytes: 32 * 1024,
  createClientFromRequest,
  getEnvironmentValue: (name) => Deno.env.get(name),
  execute: async ({ client, authorization, payload }) => {
    if (payload.environment !== undefined && payload.environment !== authorization.environment) {
      adminApiError(ADMIN_API_ERROR_CODES.AUTHORIZATION_DENIED, 403);
    }
    if (typeof payload.batchId !== 'string' || typeof payload.retentionApplyToken !== 'string') {
      adminApiError(ADMIN_API_ERROR_CODES.INVALID_REQUEST, 400);
    }
    const secret = Deno.env.get(PRO_FORM_RETENTION_APPLY_SECRET);
    const adminGrantTokenIdHash = await hashRetentionAdminGrantTokenId(authorization.tokenId);
    const verifiedToken = await verifyRetentionApplyToken(payload.retentionApplyToken, {
      environment: authorization.environment, batchId: payload.batchId,
      adminGrantTokenIdHash,
    }, { secret });
    return applyRetentionPage(
      createRetentionRepository(client.asServiceRole?.entities as Record<string, unknown>),
      { ...payload, environment: authorization.environment, requestId: authorization.requestId, verifiedToken },
      { environmentValues: (name: string) => Deno.env.get(name) },
    );
  },
}));
