import { createClientFromRequest } from 'npm:@base44/sdk';
import { ADMIN_API_OPERATION_NAMES, createAdminFunctionHandler } from '../_shared/proDraftAdminRequest/entry.ts';
import { getIntakeForRecovery } from '../_shared/proDraftAdminService/entry.ts';

Deno.serve(createAdminFunctionHandler({
  operation: ADMIN_API_OPERATION_NAMES.GET_INTAKE, maxBytes: 16 * 1024, createClientFromRequest,
  getEnvironmentValue: (name) => Deno.env.get(name),
  execute: ({ client, payload }) => getIntakeForRecovery(client.asServiceRole?.entities as never, payload as never),
}));
