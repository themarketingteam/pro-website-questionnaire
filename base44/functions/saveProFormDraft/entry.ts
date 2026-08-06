import { createClientFromRequest } from 'npm:@base44/sdk';
import { createSaveProFormDraftHandler } from '../_shared/proDraftSaveEvents/entry.ts';

const handler = createSaveProFormDraftHandler({
  createClientFromRequest,
  getEnvironmentValue: (name) => Deno.env.get(name),
});

Deno.serve(handler);
