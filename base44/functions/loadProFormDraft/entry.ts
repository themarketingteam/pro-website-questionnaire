import { createClientFromRequest } from 'npm:@base44/sdk';
import { createLoadProFormDraftHandler } from '../_shared/proDraftBootstrapLoad/entry.ts';

const handler = createLoadProFormDraftHandler({
  createClientFromRequest,
  getEnvironmentValue: (name) => Deno.env.get(name),
});

Deno.serve(handler);
