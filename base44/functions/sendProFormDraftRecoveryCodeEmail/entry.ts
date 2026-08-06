import { createClientFromRequest } from 'npm:@base44/sdk';
import {
  createSendProFormDraftRecoveryCodeEmailHandler,
} from '../_shared/proDraftRecoveryEmailDelivery/entry.ts';

const handler = createSendProFormDraftRecoveryCodeEmailHandler({
  createClientFromRequest,
  getEnvironmentValue: (name) => Deno.env.get(name),
});

export default handler;
