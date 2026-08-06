import { createClientFromRequest } from 'npm:@base44/sdk';
import {
  createVerifyDraftRecoveryAccessHandler,
} from '../_shared/proDraftAdminAuthorization/entry.ts';

const handler = createVerifyDraftRecoveryAccessHandler({
  createClientFromRequest,
  // eslint-disable-next-line no-undef
  getEnvironmentValue: (name) => Deno.env.get(name),
});

// eslint-disable-next-line no-undef
Deno.serve(handler);
