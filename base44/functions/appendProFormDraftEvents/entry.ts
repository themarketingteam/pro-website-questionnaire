import { createClientFromRequest } from 'npm:@base44/sdk';
import { createAppendProFormDraftEventsHandler } from '../_shared/proDraftSaveEvents/entry.ts';

const handler = createAppendProFormDraftEventsHandler({
  createClientFromRequest,
  getEnvironmentValue: (name) => Deno.env.get(name),
});

Deno.serve(handler);
