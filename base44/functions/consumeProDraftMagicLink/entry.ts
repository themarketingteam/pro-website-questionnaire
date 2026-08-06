import { createEmailVerificationFunctionHandler } from '../_shared/proDraftEmailVerification/entry.ts';

export default createEmailVerificationFunctionHandler({
  operation: 'consume_magic_link',
  getEnvironmentValue: (name) => Deno.env.get(name),
});
