import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from 'react-redux';
import { Button as ButtonComponent } from '@/components/ui/button';
import { Input as InputComponent } from '@/components/ui/input';
import { ProDraftCredentialProvider } from '@/contexts/ProDraftCredentialContext';
import { useQuestionnairePersistence } from '@/components/store/QuestionnairePersistenceContext';
import ProDraftRecoveryCaptcha from '@/components/pro-form/ProDraftRecoveryCaptcha';
import ProDraftRecoveryChoiceList from '@/components/pro-form/ProDraftRecoveryChoiceList';
import { useProDraftBootstrap } from '@/hooks/useProDraftBootstrap';
import { createClientDraftIdentityContext } from '@/lib/proDraftClientIdentityContext';
import { normalizeRecoveryEmail } from '@/lib/proDraftIdentity';
import {
  formatSafeDraftStatus,
  formatSafeSavedTime,
} from '@/lib/proDraftDisplaySafety';
import {
  frontendRuntimeConfig,
  isDurableDraftClientEnabled,
  isPublicEmailRecoveryClientEnabled,
} from '@/lib/proDraftRuntimeConfig';

const Button = /** @type {any} */ (ButtonComponent);
const Input = /** @type {any} */ (InputComponent);
const GENERIC_FAILURE = 'We could not recover a questionnaire with the information provided.';
const PREPARING_PHASES = new Set([
  'idle', 'reading_identity', 'reading_local_cache', 'reading_credentials',
  'resuming_stored_draft', 'loading_authorized_draft', 'reconciling_state',
  'hydrating_redux',
]);

const recoveryIdentity = createClientDraftIdentityContext({
  recoveryEmail: '',
  signedInvitationEmail: '',
  recoveryEmailSource: 'anonymous',
  associationIntent: 'anonymous_start',
  anonymousRecoveryAcknowledged: true,
});

function EnabledProDraftRecoveryPage({
  runtimeConfig = frontendRuntimeConfig,
  coordinator,
  captchaProvider,
  captchaSiteKey,
}) {
  const navigate = useNavigate();
  const store = useStore();
  const persistence = useQuestionnairePersistence();
  const bootstrap = useProDraftBootstrap({
    store,
    storage: persistence.storage,
    browserNamespace: persistence.namespace,
    identityContext: recoveryIdentity,
    runtimeConfig,
    ...(coordinator ? { coordinator } : {}),
  });
  const [method, setMethod] = useState('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [emailError, setEmailError] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const [captchaToken, setCaptchaToken] = useState(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [recoveryComplete, setRecoveryComplete] = useState(false);
  const [summary, setSummary] = useState(null);
  const [readOnly, setReadOnly] = useState(false);
  const [choiceListOpen, setChoiceListOpen] = useState(false);
  const [choices, setChoices] = useState([]);
  const [choicesLoading, setChoicesLoading] = useState(false);
  const [choiceError, setChoiceError] = useState('');
  const [selectingDraftId, setSelectingDraftId] = useState(null);
  const emailTabRef = useRef(null);
  const codeTabRef = useRef(null);

  useEffect(() => {
    if (bootstrap.phase !== 'ready' || bootstrap.outcome === 'legacy_flow') return;
    setRecoveryComplete(true);
    setReadOnly(bootstrap.readOnly);
    setSummary(bootstrap.draftSummary);
  }, [bootstrap.draftSummary, bootstrap.outcome, bootstrap.phase, bootstrap.readOnly]);

  const resetTransientChallenge = () => {
    setCaptchaToken(null);
    setCaptchaResetKey((value) => value + 1);
  };

  const completeRecovery = (result, recoveryMethod) => {
    resetTransientChallenge();
    if (result?.phase === 'ready') {
      setFailure(null);
      setRecoveryComplete(true);
      setReadOnly(result.readOnly === true);
      setSummary(result.draftSummary || null);
      setEmail('');
      setCode('');
      if (recoveryMethod !== 'email') {
        setChoiceListOpen(false);
        setChoices([]);
      }
      return true;
    }
    setFailure({
      message: GENERIC_FAILURE,
      captchaRequired: result?.captchaRequired === true,
      retryAfterSeconds: result?.retryAfterSeconds || 0,
    });
    return false;
  };

  const recoverByEmail = async (event) => {
    event?.preventDefault();
    const normalized = normalizeRecoveryEmail(email);
    if (!normalized.valid || !normalized.normalizedEmail) {
      setEmailError('Enter a valid email address.');
      return;
    }
    setEmailError('');
    setBusy(true);
    setFailure(null);
    const token = captchaToken;
    try {
      const result = await bootstrap.recoverDraftByEmail(normalized.displayEmail, {
        ...(token ? { captchaToken: token } : {}),
      });
      completeRecovery(result, 'email');
    } catch {
      completeRecovery(null, 'email');
    } finally {
      setBusy(false);
    }
  };

  const recoverByCode = async (event) => {
    event?.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setFailure(null);
    const token = captchaToken;
    try {
      const result = await bootstrap.recoverDraftByCode(code, {
        keepInBrowser: true,
        ...(token ? { captchaToken: token } : {}),
      });
      completeRecovery(result, 'code');
    } catch {
      completeRecovery(null, 'code');
    } finally {
      setBusy(false);
    }
  };

  const loadChoices = async () => {
    setChoiceListOpen(true);
    setChoicesLoading(true);
    setChoiceError('');
    try {
      const result = await bootstrap.listRecoveryChoices();
      if (!result?.success) {
        setChoiceError('Authorized questionnaire choices are not available right now.');
        setChoices([]);
        return;
      }
      setChoices(result.choices);
    } catch {
      setChoiceError('Authorized questionnaire choices are not available right now.');
      setChoices([]);
    } finally {
      setChoicesLoading(false);
    }
  };

  const selectChoice = async (draftId) => {
    setSelectingDraftId(draftId);
    setChoiceError('');
    try {
      const result = await bootstrap.selectRecoveryChoice(draftId);
      if (!result?.success || result.phase !== 'ready') {
        setChoiceError('We could not open that questionnaire. Please try again.');
        return;
      }
      setRecoveryComplete(true);
      setReadOnly(result.readOnly === true);
      setSummary(result.draftSummary || null);
      setChoices((current) => current.map((choice) => ({
        ...choice,
        isCurrentSelection: choice.draftId === draftId,
      })));
    } catch {
      setChoiceError('We could not open that questionnaire. Please try again.');
    } finally {
      setSelectingDraftId(null);
    }
  };

  const switchMethod = useCallback((nextMethod) => {
    setMethod(nextMethod);
    setFailure(null);
    setCaptchaToken(null);
  }, []);

  const handleTabKeyDown = useCallback((event) => {
    const nextMethod = {
      ArrowLeft: 'email',
      ArrowUp: 'email',
      Home: 'email',
      ArrowRight: 'code',
      ArrowDown: 'code',
      End: 'code',
    }[event.key];
    if (!nextMethod) return;
    event.preventDefault();
    switchMethod(nextMethod);
    (nextMethod === 'email' ? emailTabRef : codeTabRef).current?.focus();
  }, [switchMethod]);

  const preparing = PREPARING_PHASES.has(bootstrap.phase);
  const canListChoices = bootstrap.canListRecoveryChoices;
  const savedTime = useMemo(
    () => formatSafeSavedTime(summary?.lastSavedAt),
    [summary?.lastSavedAt],
  );

  return (
    <ProDraftCredentialProvider coordinator={bootstrap.coordinator}>
      <main
        data-testid="pro-draft-recovery-page"
        className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 sm:py-12"
      >
        <div className="mx-auto max-w-3xl space-y-6">
          <header className="space-y-3">
            <h1 className="text-3xl font-bold text-slate-950">Recover your questionnaire</h1>
            <p className="text-slate-700">
              Use the email address associated with your questionnaire or enter the unique recovery code for the exact draft.
            </p>
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-950">
              Email recovery does not verify ownership of the email address.
            </p>
          </header>

          {preparing ? (
            <div role="status" aria-live="polite" className="rounded-xl border bg-white p-6 text-center">
              Preparing draft recovery…
            </div>
          ) : (
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
              <div role="tablist" aria-label="Recovery method" className="grid grid-cols-2 gap-2">
                <button
                  id="recover-with-email-tab"
                  ref={emailTabRef}
                  type="button"
                  role="tab"
                  aria-selected={method === 'email'}
                  aria-controls="recover-with-email-panel"
                  tabIndex={method === 'email' ? 0 : -1}
                  data-testid="recover-with-email-tab"
                  onClick={() => switchMethod('email')}
                  onKeyDown={handleTabKeyDown}
                  className={`min-h-11 rounded-lg px-3 py-2 font-medium ${method === 'email' ? 'bg-[#1E6BA8] text-white' : 'bg-slate-100 text-slate-800'}`}
                >
                  Recover with email
                </button>
                <button
                  id="recover-with-code-tab"
                  ref={codeTabRef}
                  type="button"
                  role="tab"
                  aria-selected={method === 'code'}
                  aria-controls="recover-with-code-panel"
                  tabIndex={method === 'code' ? 0 : -1}
                  data-testid="recover-with-code-tab"
                  onClick={() => switchMethod('code')}
                  onKeyDown={handleTabKeyDown}
                  className={`min-h-11 rounded-lg px-3 py-2 font-medium ${method === 'code' ? 'bg-[#1E6BA8] text-white' : 'bg-slate-100 text-slate-800'}`}
                >
                  Recover with code
                </button>
              </div>

              {!recoveryComplete && method === 'email' && (
                <form
                  id="recover-with-email-panel"
                  role="tabpanel"
                  aria-labelledby="recover-with-email-tab"
                  className="mt-6 space-y-4"
                  onSubmit={recoverByEmail}
                  data-testid="email-recovery-form"
                >
                  <div className="space-y-2">
                    <label htmlFor="public-recovery-email" className="font-medium text-slate-900">Email address</label>
                    <Input
                      id="public-recovery-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => { setEmail(event.target.value); setEmailError(''); }}
                      aria-invalid={Boolean(emailError)}
                      aria-describedby="public-recovery-email-error"
                    />
                    {emailError && <p id="public-recovery-email-error" role="alert" className="text-sm text-red-700">{emailError}</p>}
                  </div>
                  <Button type="submit" disabled={busy}>Recover questionnaire</Button>
                </form>
              )}

              {!recoveryComplete && method === 'code' && (
                <form
                  id="recover-with-code-panel"
                  role="tabpanel"
                  aria-labelledby="recover-with-code-tab"
                  className="mt-6 space-y-4"
                  onSubmit={recoverByCode}
                  data-testid="code-recovery-form"
                >
                  <div className="space-y-2">
                    <label htmlFor="public-recovery-code" className="font-medium text-slate-900">Recovery code</label>
                    <Input
                      id="public-recovery-code"
                      autoComplete="off"
                      spellCheck="false"
                      placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                    />
                  </div>
                  <Button type="submit" disabled={busy || !code.trim()}>Recover questionnaire</Button>
                </form>
              )}

              <div aria-live="polite" data-testid="recovery-status-region" className="mt-4">
                {busy && <p role="status" className="text-sm text-slate-700">Recovering your questionnaire…</p>}
                {failure && (
                  <div className="space-y-3">
                    <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{failure.message}</p>
                    {failure.retryAfterSeconds > 0 && (
                      <p role="status" className="text-sm text-amber-900">Try again in {failure.retryAfterSeconds} seconds.</p>
                    )}
                    <ProDraftRecoveryCaptcha
                      required={failure.captchaRequired}
                      environment={runtimeConfig.environment}
                      provider={captchaProvider}
                      siteKey={captchaSiteKey}
                      resetKey={captchaResetKey}
                      onToken={(token) => setCaptchaToken(token || null)}
                      onError={() => setCaptchaToken(null)}
                    />
                  </div>
                )}
              </div>

              {recoveryComplete && (
                <div data-testid="recovery-success-summary" className="mt-6 space-y-4">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">
                      {readOnly ? 'Your submitted questionnaire is ready' : 'Your saved questionnaire is ready'}
                    </h2>
                    <div className="mt-2 space-y-1 text-sm text-slate-700">
                      {summary?.businessNameDisplay && <p>Questionnaire: {summary.businessNameDisplay}</p>}
                      {savedTime && <p>Last saved: {savedTime}</p>}
                      <p>{formatSafeDraftStatus(summary?.status, { readOnly })}</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button type="button" onClick={() => navigate('/')}>
                      {readOnly ? 'View submitted questionnaire' : 'Continue to questionnaire'}
                    </Button>
                    {canListChoices && (
                      <Button type="button" variant="outline" onClick={loadChoices}>
                        Recover a different questionnaire
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          {choiceListOpen && (
            <ProDraftRecoveryChoiceList
              choices={choices}
              loading={choicesLoading}
              error={choiceError}
              selectingDraftId={selectingDraftId}
              onSelect={selectChoice}
            />
          )}
        </div>
      </main>
    </ProDraftCredentialProvider>
  );
}

export default function ProDraftRecovery(props) {
  const runtimeConfig = props.runtimeConfig || frontendRuntimeConfig;
  const enabled = isDurableDraftClientEnabled(runtimeConfig)
    && isPublicEmailRecoveryClientEnabled(runtimeConfig);
  if (!enabled) {
    return (
      <main data-testid="pro-draft-recovery-disabled" className="min-h-screen bg-slate-50 p-8">
        <div className="mx-auto max-w-xl rounded-xl border bg-white p-6">
          <h1 className="text-2xl font-bold text-slate-900">Draft recovery is not available</h1>
          <p className="mt-2 text-slate-700">Please return to the questionnaire and use the available recovery options.</p>
        </div>
      </main>
    );
  }
  return <EnabledProDraftRecoveryPage {...props} runtimeConfig={runtimeConfig} />;
}
