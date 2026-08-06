import { createClientFromRequest } from 'npm:@base44/sdk';
import {
  REPLACEMENT_OPERATION_TYPES,
  createReplacementFunctionHandler,
} from '../_shared/proDraftReplacement/entry.ts';

const handler = createReplacementFunctionHandler(
  REPLACEMENT_OPERATION_TYPES.START_NEW_AFTER_SUBMISSION,
  {
    createClientFromRequest,
    getEnvironmentValue: (name) => Deno.env.get(name),
  },
);

Deno.serve(handler);
