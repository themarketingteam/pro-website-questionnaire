import { createClientFromRequest } from 'npm:@base44/sdk';
import {
  createRecoverProFormDraftByCodeHandler,
} from '../_shared/proDraftCodeRecovery/entry.ts';

const handler = createRecoverProFormDraftByCodeHandler({
  createClientFromRequest,
  getEnvironmentValue: (name) => Deno.env.get(name),
  safeLog: ({ requestId, errorCode }) => console.warn(
    JSON.stringify({ requestId, errorCode }),
  ),
});

Deno.serve(handler);
