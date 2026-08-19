import { createContext, useContext, useEffect, useState } from 'react';
import { KeyRound, Loader2, LockKeyhole } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import mspSuccessDigitalLogoDataUrl from '@/assets/mspSuccessDigitalLogo';
import { getRecoveryRequestErrorMessage } from '@/lib/draftRecoveryApi';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/figtree/300.css';
import '@fontsource/figtree/400.css';
import '@fontsource/figtree/500.css';
import '@fontsource/figtree/600.css';
import './draftRecoveryBrand.css';

// Keep the original storage key so existing seven-day admin grants remain valid.
const STORAGE_KEY = 'pro_draft_recovery_access_v1';

export const AdminAccessContext = createContext({ adminGrant: '', recoveryGrant: '' });
export const DraftRecoveryAccessContext = AdminAccessContext;

export const useAdminAccess = () => useContext(AdminAccessContext);
export const useDraftRecoveryAccess = useAdminAccess;

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
        setError(getRecoveryRequestErrorMessage(
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
      setError(getRecoveryRequestErrorMessage(submitError, 'Incorrect password.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (accessState === 'authorized') {
    return (
      <AdminAccessContext.Provider value={{ adminGrant: recoveryGrant, recoveryGrant }}>
        {children}
      </AdminAccessContext.Provider>
    );
  }

  if (accessState === 'checking') {
    return (
      <div className="draft-recovery-brand draft-recovery-gate" aria-live="polite">
        <div className="draft-recovery-gate__checking text-sm">
          <span className="draft-recovery-brand__logo-plate draft-recovery-gate__logo">
            <img
              src={mspSuccessDigitalLogoDataUrl}
              alt="Kaseya MSP Success"
              className="draft-recovery-brand__logo"
              width="411"
              height="79"
            />
          </span>
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          <span>Verifying access…</span>
        </div>
      </div>
    );
  }

  return (
    <main className="draft-recovery-brand draft-recovery-gate">
      <Card className="draft-recovery-gate__card">
        <CardHeader className="space-y-4 text-center">
          <span className="draft-recovery-brand__logo-plate draft-recovery-gate__logo">
            <img
              src={mspSuccessDigitalLogoDataUrl}
              alt="Kaseya MSP Success"
              className="draft-recovery-brand__logo"
              width="411"
              height="79"
            />
          </span>
          <div className="draft-recovery-gate__icon mx-auto flex h-12 w-12 items-center justify-center rounded-full">
            <LockKeyhole className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="space-y-2">
            <p className="draft-recovery-brand__section-kicker">Admin support workspace</p>
            <CardTitle className="brand-heading text-2xl text-slate-900">Admin Workspace Access</CardTitle>
            <p className="text-sm leading-6 text-slate-600">
              Enter the admin password to open the protected admin tools. Access remains available across admin pages in this browser for seven days.
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
            <Button type="submit" className="brand-button-primary w-full" disabled={submitting || !password}>
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <KeyRound className="h-4 w-4" aria-hidden="true" />
              )}
              {submitting ? 'Verifying…' : 'Unlock admin workspace'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
