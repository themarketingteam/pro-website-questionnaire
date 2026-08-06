import { createClientFromRequest } from 'npm:@base44/sdk';
import {
  REPLACEMENT_OPERATION_TYPES,
  createReplacementFunctionHandler,
} from '../_shared/proDraftReplacement/entry.ts';

const handler = createReplacementFunctionHandler(
  REPLACEMENT_OPERATION_TYPES.CLEAR_ALL,
  {
    createClientFromRequest,
    getEnvironmentValue: (name) => Deno.env.get(name),
  },
);

Deno.serve(handler);
