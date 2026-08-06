import { createClientFromRequest } from 'npm:@base44/sdk';
import { createProDraftSecuritySelfCheckHandler } from './core.ts';

const handler = createProDraftSecuritySelfCheckHandler({
  createClientFromRequest,
  // eslint-disable-next-line no-undef
  getEnvironmentValue: (name) => Deno.env.get(name),
});

// eslint-disable-next-line no-undef
Deno.serve(handler);
