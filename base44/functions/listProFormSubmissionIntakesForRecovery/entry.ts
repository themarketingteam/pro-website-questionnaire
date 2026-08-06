import { createClientFromRequest } from 'npm:@base44/sdk';
import { ADMIN_API_OPERATION_NAMES, createAdminFunctionHandler } from '../_shared/proDraftAdminRequest/entry.ts';
import { listIntakesForRecovery } from '../_shared/proDraftAdminService/entry.ts';

Deno.serve(createAdminFunctionHandler({
  operation: ADMIN_API_OPERATION_NAMES.LIST_INTAKES, maxBytes: 32 * 1024, createClientFromRequest,
  getEnvironmentValue: (name) => Deno.env.get(name),
  execute: ({ client, payload }) => listIntakesForRecovery(client.asServiceRole?.entities as never, payload as never, Deno.env.get('PRO_FORM_ADMIN_GRANT_SECRET') ?? ''),
}));
