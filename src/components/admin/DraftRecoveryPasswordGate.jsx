import { useState } from 'react';
import { KeyRound, Loader2, LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useProDraftAdminAuthorization } from '@/hooks/useProDraftAdminAuthorization';

const PERSISTENT_NOTICE = 'This device will remain authorized until access is revoked, the recovery authorization is rotated, or you choose Forget this device.';
const MEMORY_NOTICE = 'This browser is not allowing persistent storage. You may need to enter the recovery password again after closing it.';

export default function DraftRecoveryPasswordGate({ children }) {
  const { authorizationState, authorizeWithPassword } = useProDraftAdminAuthorization();
  const [password, setPassword] = useState('');
  const [submittedError, setSubmittedError] = useState('');
  const submitting = authorizationState.status === 'authenticating';

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!password || submitting) return;
    const submitted = password;
    setPassword('');
    setSubmittedError('');
    const result = await authorizeWithPassword(submitted);
    if (!result.authorized) setSubmittedError('Draft Recovery access could not be verified. Check the password and try again.');
  };

  if (authorizationState.authorized) return children;

  if (authorizationState.status === 'loading') {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6" aria-live="polite">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          Loading stored Draft Recovery access…
        </div>
      </main>
    );
  }

  const limited = authorizationState.status === 'rate_limited' || authorizationState.status === 'locked';
  const retry = authorizationState.retryAfterSeconds > 0
    ? ` Try again in ${authorizationState.retryAfterSeconds} seconds.` : '';

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-6">
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-700">
            <LockKeyhole className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold leading-none tracking-tight text-slate-900">Draft Recovery Access</h1>
            <p className="text-sm leading-6 text-slate-600">{PERSISTENT_NOTICE}</p>
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label htmlFor="draft-recovery-password" className="text-sm font-medium text-slate-800">
                Recovery access password
              </label>
              <Input id="draft-recovery-password" type="password" value={password}
                onChange={(event) => setPassword(event.target.value)} autoComplete="current-password"
                required disabled={submitting || limited} aria-describedby="draft-recovery-status" />
            </div>
            {(submittedError || limited || authorizationState.status === 'error') ? (
              <p id="draft-recovery-status" className="text-sm text-red-700" role="alert">
                {limited ? `Draft Recovery access is temporarily unavailable.${retry}` : submittedError || 'Draft Recovery access could not be verified. Try again.'}
              </p>
            ) : null}
            {authorizationState.storageMode === 'memory_only' ? (
              <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{MEMORY_NOTICE}</p>
            ) : null}
            <Button type="submit" className="w-full gap-2" disabled={submitting || limited || !password}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <KeyRound className="h-4 w-4" aria-hidden="true" />}
              {submitting ? 'Authenticating…' : 'Unlock Draft Recovery'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

export { MEMORY_NOTICE, PERSISTENT_NOTICE };
