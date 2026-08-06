import { createClientFromRequest } from 'npm:@base44/sdk';
import { ADMIN_API_OPERATION_NAMES, createAdminFunctionHandler } from '../_shared/proDraftAdminRequest/entry.ts';
import { updateDraftForRecovery } from '../_shared/proDraftAdminService/entry.ts';

Deno.serve(createAdminFunctionHandler({
  operation: ADMIN_API_OPERATION_NAMES.UPDATE_DRAFT, maxBytes: 1024 * 1024, createClientFromRequest,
  getEnvironmentValue: (name) => Deno.env.get(name),
  execute: ({ client, authorization, payload }) => updateDraftForRecovery(client.asServiceRole?.entities as never, payload as never, {
    actorHash: authorization.actorHash, environment: authorization.environment,
    adminSecret: Deno.env.get('PRO_FORM_ADMIN_GRANT_SECRET') ?? '',
    emailSecret: Deno.env.get('PRO_FORM_EMAIL_LOOKUP_SECRET') ?? '',
  }),
}));
