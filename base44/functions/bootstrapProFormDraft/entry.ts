import { createClientFromRequest } from 'npm:@base44/sdk';
import { createBootstrapProFormDraftHandler } from '../_shared/proDraftBootstrapLoad/entry.ts';

const handler = createBootstrapProFormDraftHandler({
  createClientFromRequest,
  getEnvironmentValue: (name) => Deno.env.get(name),
});

Deno.serve(handler);
