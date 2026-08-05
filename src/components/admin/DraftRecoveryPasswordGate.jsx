import { createContext, useContext, useEffect, useState } from 'react';
import { KeyRound, Loader2, LockKeyhole } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const STORAGE_KEY = 'pro_draft_recovery_access_v1';

export const DraftRecoveryAccessContext = createContext({ recoveryGrant: '' });

export const useDraftRecoveryAccess = () => useContext(DraftRecoveryAccessContext);

const readSavedGrant = () => {
  try {
    const savedGrant = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
    if (!savedGrant?.token || !Number.isFinite(savedGrant?.expiresAt)) return null;
    if (savedGrant.expiresAt <= Date.now()) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return savedGrant;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
};

const getResponseData = (response) => response?.data ?? response;

const getErrorMessage = (error, fallback) => (
  error?.response?.data?.error
  || error?.data?.error
  || error?.message
  || fallback
);

const getErrorStatus = (error) => error?.status || error?.response?.status;

export default function DraftRecoveryPasswordGate({ children }) {
  const [accessState, setAccessState] = useState('checking');
  const [recoveryGrant, setRecoveryGrant] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    const savedGrant = readSavedGrant();

    if (!savedGrant) {
      setAccessState('locked');
      return () => {
        active = false;
      };
    }

    const verifySavedGrant = async () => {
      try {
        const response = await base44.functions.invoke('verifyDraftRecoveryAccess', {
          token: savedGrant.token
        });
        const data = getResponseData(response);

        if (!active) return;
        if (data?.authorized) {
          setRecoveryGrant(savedGrant.token);
          setAccessState('authorized');
          return;
        }

        window.localStorage.removeItem(STORAGE_KEY);
        setRecoveryGrant('');
        setError(data?.error || 'Your saved access has expired. Enter the password again.');
      } catch (verifyError) {
        if (!active) return;
        if ([401, 403].includes(getErrorStatus(verifyError))) {
          window.localStorage.removeItem(STORAGE_KEY);
        }
        setRecoveryGrant('');
        setError(getErrorMessage(
          verifyError,
          'Unable to verify saved access. Please enter the password again.'
        ));
      }

      if (active) setAccessState('locked');
    };

    verifySavedGrant();
    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!password || submitting) return;

    setSubmitting(true);
    setError('');

    try {
      const response = await base44.functions.invoke('verifyDraftRecoveryAccess', { password });
      const data = getResponseData(response);

      if (!data?.authorized || !data?.token || !Number.isFinite(data?.expiresAt)) {
        throw new Error(data?.error || 'Access could not be verified.');
      }

      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        token: data.token,
        expiresAt: data.expiresAt
      }));
      setRecoveryGrant(data.token);
      setPassword('');
      setAccessState('authorized');
    } catch (submitError) {
      setPassword('');
      setError(getErrorMessage(submitError, 'Incorrect password.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (accessState === 'authorized') {
    return (
      <DraftRecoveryAccessContext.Provider value={{ recoveryGrant }}>
        {children}
      </DraftRecoveryAccessContext.Provider>
    );
  }

  if (accessState === 'checking') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6" aria-live="polite">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          Verifying access…
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-700">
            <LockKeyhole className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="space-y-2">
            <CardTitle className="text-2xl text-slate-900">Draft Recovery Access</CardTitle>
            <p className="text-sm leading-6 text-slate-600">
              Enter the admin password to open draft recovery. Access remains available in this browser for seven days.
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label htmlFor="draft-recovery-password" className="text-sm font-medium text-slate-800">
                Password
              </label>
              <Input
                id="draft-recovery-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                autoFocus
                required
                disabled={submitting}
                aria-describedby={error ? 'draft-recovery-error' : undefined}
              />
            </div>
            {error ? (
              <p id="draft-recovery-error" className="text-sm text-red-600" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={submitting || !password}>
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <KeyRound className="h-4 w-4" aria-hidden="true" />
              )}
              {submitting ? 'Verifying…' : 'Unlock draft recovery'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
