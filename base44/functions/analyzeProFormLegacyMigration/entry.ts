import { createClientFromRequest } from 'npm:@base44/sdk';
import { ADMIN_API_ERROR_CODES, ADMIN_API_OPERATION_NAMES, adminApiError, createAdminFunctionHandler } from '../_shared/proDraftAdminRequest/entry.ts';
import { createMigrationRepository } from '../_shared/proDraftMigrationRepository/entry.ts';
import { PRO_FORM_MIGRATION_APPLY_SECRET, hashAdminGrantTokenId } from '../_shared/proDraftMigrationAuthorization/entry.ts';
import { analyzeMigrationPage } from '../_shared/proDraftMigrationService/entry.ts';

Deno.serve(createAdminFunctionHandler({
  operation: ADMIN_API_OPERATION_NAMES.ANALYZE_MIGRATION,
  maxBytes: 64 * 1024,
  createClientFromRequest,
  getEnvironmentValue: (name) => Deno.env.get(name),
  execute: async ({ client, authorization, payload }) => {
    if (payload.environment !== undefined && payload.environment !== authorization.environment) adminApiError(ADMIN_API_ERROR_CODES.AUTHORIZATION_DENIED, 403);
    const entities = client.asServiceRole?.entities as Record<string, unknown>;
    const repository = createMigrationRepository(entities);
    const secret = Deno.env.get(PRO_FORM_MIGRATION_APPLY_SECRET);
    const migrationName = payload.migrationName ?? 'pro-form-legacy-upgrade';
    const migrationVersion = payload.migrationVersion ?? 1;
    return analyzeMigrationPage(repository, {
      ...payload,
      environment: authorization.environment,
      migrationName,
      migrationVersion,
      batchId: payload.batchId ?? `${migrationName}-v${migrationVersion}-${authorization.environment}`,
      adminGrantTokenIdHash: await hashAdminGrantTokenId(authorization.tokenId),
      dryRun: true,
    }, { secret });
  },
}));
