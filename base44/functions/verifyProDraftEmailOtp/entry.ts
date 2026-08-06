import { createEmailVerificationFunctionHandler } from '../_shared/proDraftEmailVerification/entry.ts';

export default createEmailVerificationFunctionHandler({
  operation: 'verify_otp',
  getEnvironmentValue: (name) => Deno.env.get(name),
});
