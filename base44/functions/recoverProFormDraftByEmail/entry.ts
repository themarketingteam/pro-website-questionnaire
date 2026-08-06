import { createClientFromRequest } from 'npm:@base44/sdk';
import {
  createRecoverProFormDraftByEmailHandler,
} from '../_shared/proDraftEmailRecovery/entry.ts';

const handler = createRecoverProFormDraftByEmailHandler({
  createClientFromRequest,
  getEnvironmentValue: (name) => Deno.env.get(name),
  safeLog: ({ requestId, errorCode }) => console.warn(
    JSON.stringify({ requestId, errorCode }),
  ),
});

Deno.serve(handler);
