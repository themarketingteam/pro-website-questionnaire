import { createClientFromRequest } from 'npm:@base44/sdk';
import { ADMIN_API_OPERATION_NAMES, createAdminFunctionHandler } from '../_shared/proDraftAdminRequest/entry.ts';
import { createMigrationRepository } from '../_shared/proDraftMigrationRepository/entry.ts';
import { PRO_FORM_MIGRATION_APPLY_SECRET, verifyMigrationApplyToken } from '../_shared/proDraftMigrationAuthorization/entry.ts';
import { rollbackMigrationPage } from '../_shared/proDraftMigrationService/entry.ts';

Deno.serve(createAdminFunctionHandler({
  operation: ADMIN_API_OPERATION_NAMES.ROLLBACK_MIGRATION, maxBytes: 64 * 1024,
  createClientFromRequest, getEnvironmentValue: (name) => Deno.env.get(name),
  execute: async ({ client, authorization, payload }) => {
    const options = { secret: Deno.env.get(PRO_FORM_MIGRATION_APPLY_SECRET) };
    const verified = await verifyMigrationApplyToken(payload.applyToken, { environment: authorization.environment }, options);
    return rollbackMigrationPage(
      createMigrationRepository(client.asServiceRole?.entities as Record<string, unknown>),
      { ...payload, environment: verified.claims.environment, migrationName: verified.claims.migrationName, migrationVersion: verified.claims.migrationVersion, batchId: verified.claims.batchId, reportHash: verified.claims.reportHash }, options,
    );
  },
}));
