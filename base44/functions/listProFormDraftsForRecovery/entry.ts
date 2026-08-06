import { createClientFromRequest } from 'npm:@base44/sdk';
import { ADMIN_API_OPERATION_NAMES, createAdminFunctionHandler } from '../_shared/proDraftAdminRequest/entry.ts';
import { listDraftsForRecovery } from '../_shared/proDraftAdminService/entry.ts';

Deno.serve(createAdminFunctionHandler({
  operation: ADMIN_API_OPERATION_NAMES.LIST_DRAFTS, maxBytes: 64 * 1024, createClientFromRequest,
  getEnvironmentValue: (name) => Deno.env.get(name),
  execute: async ({ client, authorization, payload }) => listDraftsForRecovery(client.asServiceRole?.entities as never, payload as never, {
    cursor: Deno.env.get('PRO_FORM_ADMIN_GRANT_SECRET') ?? '',
    email: Deno.env.get('PRO_FORM_EMAIL_LOOKUP_SECRET') ?? '',
  }),
}));
