import { createClientFromRequest } from 'npm:@base44/sdk';
import { ADMIN_API_OPERATION_NAMES, createAdminFunctionHandler } from '../_shared/proDraftAdminRequest/entry.ts';
import { listDraftEventsForRecovery } from '../_shared/proDraftAdminService/entry.ts';

Deno.serve(createAdminFunctionHandler({
  operation: ADMIN_API_OPERATION_NAMES.LIST_EVENTS, maxBytes: 64 * 1024, createClientFromRequest,
  getEnvironmentValue: (name) => Deno.env.get(name),
  execute: ({ client, payload }) => listDraftEventsForRecovery(client.asServiceRole?.entities as never, payload as never, Deno.env.get('PRO_FORM_ADMIN_GRANT_SECRET') ?? ''),
}));
