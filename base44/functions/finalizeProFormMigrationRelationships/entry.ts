import { createClientFromRequest } from 'npm:@base44/sdk';
import { ADMIN_API_OPERATION_NAMES, createAdminFunctionHandler } from '../_shared/proDraftAdminRequest/entry.ts';
import { verifyCrossAppMigrationAuthorization } from '../_shared/proFormCrossAppMigrationAuth/entry.ts';
import { assertCrossAppMigrationRoute, getCrossAppMigrationConfig } from '../_shared/proFormCrossAppMigrationConfig/entry.ts';
import { finalizeMigrationRelationships } from '../_shared/proFormCrossAppMigrationService/entry.ts';

Deno.serve(createAdminFunctionHandler({
  operation: ADMIN_API_OPERATION_NAMES.FINALIZE_CROSS_APP_MIGRATION,
  maxBytes: 128 * 1024,
  createClientFromRequest,
  getEnvironmentValue: (name) => Deno.env.get(name),
  execute: async ({ client, payload }) => {
    const config = getCrossAppMigrationConfig((name) => Deno.env.get(name));
    const claims = await verifyCrossAppMigrationAuthorization(payload.migrationAuthorization, {
      scope: 'finalize',
      sourceAppId: payload.sourceAppId,
      destinationAppId: config.localAppId,
      migrationDirection: payload.migrationDirection,
      entityName: 'all',
      batchId: payload.batchId,
      bundleHash: null,
    }, { secret: config.secret, clockSkewSeconds: config.clockSkewSeconds });
    assertCrossAppMigrationRoute(config, {
      operation: 'destination',
      sourceAppId: String(payload.sourceAppId),
      destinationAppId: config.localAppId,
      direction: String(payload.migrationDirection),
      sourceEnvironment: String(claims.sourceEnvironment),
      destinationEnvironment: String(claims.destinationEnvironment),
    });
    return finalizeMigrationRelationships(
      client.asServiceRole?.entities as Record<string, Record<string, unknown>>,
      payload,
      { apply: payload.apply === true, destinationAppId: config.localAppId, destinationEnvironment: config.environment },
    );
  },
}));
