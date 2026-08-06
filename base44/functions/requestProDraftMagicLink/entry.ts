import { createEmailVerificationFunctionHandler } from '../_shared/proDraftEmailVerification/entry.ts';

export default createEmailVerificationFunctionHandler({
  operation: 'request_magic_link',
  getEnvironmentValue: (name) => Deno.env.get(name),
});
