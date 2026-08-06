import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Copy, Loader2 } from 'lucide-react';
import { Button as ButtonComponent } from '@/components/ui/button';
import { Checkbox as CheckboxComponent } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent as DialogContentComponent,
  DialogDescription as DialogDescriptionComponent,
  DialogHeader as DialogHeaderComponent,
  DialogTitle as DialogTitleComponent,
} from '@/components/ui/dialog';
import { Input as InputComponent } from '@/components/ui/input';
import {
  compareSignedAndEnteredEmail,
} from '@/lib/proDraftClientIdentityContext';
import { normalizeRecoveryEmail } from '@/lib/proDraftIdentity';
import ProDraftRecoveryCaptcha from './ProDraftRecoveryCaptcha';

// The legacy JavaScript design-system primitives do not publish prop types.
// Keep the compatibility cast at this boundary instead of weakening checking
// for the modal state machine itself.
const Button = /** @type {any} */ (ButtonComponent);
const Checkbox = /** @type {any} */ (CheckboxComponent);
const DialogContent = /** @type {any} */ (DialogContentComponent);
const DialogDescription = /** @type {any} */ (DialogDescriptionComponent);
const DialogHeader = /** @type {any} */ (DialogHeaderComponent);
const DialogTitle = /** @type {any} */ (DialogTitleComponent);
const Input = /** @type {any} */ (InputComponent);

export const PRO_DRAFT_ENTRY_MODAL_STATES = Object.freeze([
  'choose_recovery_method',
  'email_entry',
  'email_recovery_loading',
  'email_recovery_result',
  'code_entry',
  'code_recovery_loading',
  'code_recovery_result',
  'creating_new_draft',
  'recovery_code_acknowledgement',
  'welcome_back',
  'submitted_read_only_ready',
  'error',
]);

const NEW_DRAFT_OUTCOMES = new Set([
  'new_draft_created',
  'signed_invitation_new_draft',
  'anonymous_draft_created',
]);

const GENERIC_RECOVERY_MESSAGE =
  'We could not recover a questionnaire with the information provided.';

const loadingLabel = (step) => ({
  email_recovery_loading: 'Looking for your saved questionnaire…',
  code_recovery_loading: 'Recovering your questionnaire…',
  creating_new_draft: 'Preparing your questionnaire…',
}[step] || 'Preparing your questionnaire…');

const formatSavedTime = (value) => {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return null;
  }
};

const readyStepFor = (bootstrap) => {
  if (bootstrap.readOnly) return 'submitted_read_only_ready';
  if (NEW_DRAFT_OUTCOMES.has(bootstrap.outcome)
    && (bootstrap.getRecoveryCodeForDisplay?.() || bootstrap.getRecoveryCodeHint?.())) {
    return 'recovery_code_acknowledgement';
  }
  return 'welcome_back';
};

const ReadySummary = ({ bootstrap, recovered = false }) => {
  const lastSaved = formatSavedTime(bootstrap.draftSummary?.lastSavedAt);
  const businessName = bootstrap.draftSummary?.businessNameDisplay;
  return (
    <div className="space-y-3 text-sm text-slate-700">
      {businessName && <p><span className="font-medium">Questionnaire:</span> {businessName}</p>}
      {lastSaved && <p><span className="font-medium">Last saved:</span> {lastSaved}</p>}
      <p><span className="font-medium">Access:</span> Read and update</p>
      {recovered && <p>Your saved answers have been loaded. Answer previews are not shown here.</p>}
    </div>
  );
};

export default function ProDraftEntryModal({
  bootstrap,
  initialEmail = '',
  signedInvitationEmail = '',
  environment = 'unknown',
  createIdentityForEmail,
  createAnonymousIdentity,
  captchaProvider,
  captchaSiteKey,
  onComplete,
}) {
  const [step, setStep] = useState(() => (
    bootstrap.phase === 'ready'
      ? readyStepFor(bootstrap)
      : (bootstrap.phase === 'error' ? 'error' : 'choose_recovery_method')
  ));
  const [email, setEmail] = useState(initialEmail || signedInvitationEmail || '');
  const [emailError, setEmailError] = useState('');
  const [anonymousAcknowledged, setAnonymousAcknowledged] = useState(false);
  const [codeAcknowledged, setCodeAcknowledged] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [manualCopy, setManualCopy] = useState(false);
  const [captchaToken, setCaptchaToken] = useState(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [recoveryFailure, setRecoveryFailure] = useState(null);
  const [fatalError, setFatalError] = useState(() => (
    bootstrap.phase === 'error'
      ? 'We could not load draft recovery options. Please try again.'
      : ''
  ));
  const [lastEntryStep, setLastEntryStep] = useState('choose_recovery_method');
  const codeRef = useRef(null);

  const changedSignedEmail = useMemo(() => {
    const comparison = compareSignedAndEnteredEmail(signedInvitationEmail, email);
    return comparison.valid && comparison.changed;
  }, [email, signedInvitationEmail]);

  const setCaptcha = useCallback((token) => setCaptchaToken(token || null), []);
  const setCaptchaError = useCallback(() => setCaptchaToken(null), []);

  useEffect(() => {
    if (bootstrap.phase !== 'ready') return;
    if (step === 'email_recovery_loading') {
      setStep('email_recovery_result');
      return;
    }
    if (step === 'code_recovery_loading') {
      setStep('code_recovery_result');
      return;
    }
    if (step === 'creating_new_draft') setStep(readyStepFor(bootstrap));
  }, [bootstrap, step]);

  const validateEmail = ({ allowEmpty = true } = {}) => {
    const normalized = normalizeRecoveryEmail(email, { allowEmpty });
    if (!normalized.valid || (!allowEmpty && !normalized.normalizedEmail)) {
      setEmailError('Enter a valid email address.');
      return null;
    }
    setEmailError('');
    return normalized;
  };

  const finishRecoveryAttempt = (result, successStep) => {
    setCaptchaToken(null);
    setCaptchaResetKey((value) => value + 1);
    if (result?.phase === 'ready') {
      setRecoveryFailure(null);
      setStep(result.readOnly ? 'submitted_read_only_ready' : successStep);
      return;
    }
    setRecoveryFailure({
      message: GENERIC_RECOVERY_MESSAGE,
      captchaRequired: result?.captchaRequired === true,
      retryAfterSeconds: result?.retryAfterSeconds || 0,
    });
    setStep(successStep);
  };

  const continueWithEmail = async () => {
    const normalized = validateEmail({ allowEmpty: false });
    if (!normalized) return;
    setFatalError('');
    setLastEntryStep('email_entry');
    setStep('creating_new_draft');
    try {
      const identity = createIdentityForEmail?.(normalized.displayEmail);
      const result = await bootstrap.createNewDraftAssociation({ identity });
      if (result?.phase !== 'ready') {
        setFatalError('We could not prepare your questionnaire. Please try again.');
        setStep('error');
      }
    } catch {
      setFatalError('We could not prepare your questionnaire. Please try again.');
      setStep('error');
    }
  };

  const continueWithoutEmail = async () => {
    if (!anonymousAcknowledged) return;
    setFatalError('');
    setLastEntryStep('email_entry');
    setStep('creating_new_draft');
    try {
      const identity = createAnonymousIdentity?.();
      const result = await bootstrap.createNewDraftAssociation({
        identity,
        anonymousAcknowledged: true,
      });
      if (result?.phase !== 'ready') {
        setFatalError('We could not prepare your questionnaire. Please try again.');
        setStep('error');
      }
    } catch {
      setFatalError('We could not prepare your questionnaire. Please try again.');
      setStep('error');
    }
  };

  const recoverByEmail = async () => {
    const normalized = validateEmail({ allowEmpty: false });
    if (!normalized) return;
    setRecoveryFailure(null);
    setLastEntryStep('email_entry');
    setStep('email_recovery_loading');
    const token = captchaToken;
    try {
      const result = await bootstrap.recoverDraftByEmail(normalized.displayEmail, {
        ...(token ? { captchaToken: token } : {}),
      });
      finishRecoveryAttempt(result, 'email_recovery_result');
    } catch {
      finishRecoveryAttempt(null, 'email_recovery_result');
    }
  };

  const recoverByCode = async () => {
    if (!recoveryCode.trim()) return;
    setRecoveryFailure(null);
    setLastEntryStep('code_entry');
    setStep('code_recovery_loading');
    const token = captchaToken;
    try {
      const result = await bootstrap.recoverDraftByCode(recoveryCode, {
        keepInBrowser: true,
        ...(token ? { captchaToken: token } : {}),
      });
      finishRecoveryAttempt(result, 'code_recovery_result');
    } catch {
      finishRecoveryAttempt(null, 'code_recovery_result');
    }
  };

  const selectCodeForManualCopy = () => {
    const node = codeRef.current;
    if (!node || typeof window.getSelection !== 'function') return;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(node);
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  const copyRecoveryCode = async () => {
    const code = bootstrap.getRecoveryCodeForDisplay?.();
    if (!code) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('CLIPBOARD_UNAVAILABLE');
      await navigator.clipboard.writeText(code);
      setManualCopy(false);
      setCopyStatus('Recovery code copied');
      setCodeAcknowledged(true);
    } catch {
      selectCodeForManualCopy();
      setManualCopy(true);
      setCopyStatus('Copy was not available. The recovery code is selected for manual copying.');
    }
  };

  const recoveryResultContent = (method) => {
    if (!recoveryFailure) {
      return (
        <>
          <DialogHeader>
            <DialogTitle>Your saved questionnaire is ready</DialogTitle>
            <DialogDescription>
              Continue when you are ready to return to the questionnaire.
            </DialogDescription>
          </DialogHeader>
          <ReadySummary bootstrap={bootstrap} recovered />
          {method === 'email' && bootstrap.otherEligibleDraftsAvailable && (
            <Button type="button" variant="outline" onClick={() => setStep('email_entry')}>
              Recover a different questionnaire
            </Button>
          )}
          <Button type="button" size="lg" onClick={onComplete}>
            Continue to questionnaire
          </Button>
        </>
      );
    }
    const locked = recoveryFailure.retryAfterSeconds > 0;
    const retryDisabled = locked
      || (recoveryFailure.captchaRequired && !captchaToken);
    return (
      <>
        <DialogHeader>
          <DialogTitle>Questionnaire recovery</DialogTitle>
          <DialogDescription>{recoveryFailure.message}</DialogDescription>
        </DialogHeader>
        {locked && (
          <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            Try again in {recoveryFailure.retryAfterSeconds} seconds.
          </p>
        )}
        <ProDraftRecoveryCaptcha
          required={recoveryFailure.captchaRequired}
          environment={environment}
          provider={captchaProvider}
          siteKey={captchaSiteKey}
          resetKey={captchaResetKey}
          onToken={setCaptcha}
          onError={setCaptchaError}
        />
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            type="button"
            onClick={method === 'email' ? recoverByEmail : recoverByCode}
            disabled={retryDisabled}
          >
            {method === 'email' ? 'Try email recovery again' : 'Try code recovery again'}
          </Button>
          <Button type="button" variant="outline" onClick={() => {
            setRecoveryFailure(null);
            setCaptchaToken(null);
            setStep(method === 'email' ? 'email_entry' : 'code_entry');
          }}>
            Back
          </Button>
        </div>
      </>
    );
  };

  const renderStep = () => {
    if ([
      'email_recovery_loading',
      'code_recovery_loading',
      'creating_new_draft',
    ].includes(step)) {
      return (
        <div role="status" aria-live="polite" className="flex min-h-48 flex-col items-center justify-center gap-3 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#1E6BA8]" aria-hidden="true" />
          <p className="font-medium text-slate-800">{loadingLabel(step)}</p>
        </div>
      );
    }

    if (step === 'choose_recovery_method') {
      return (
        <>
          <DialogHeader>
            <DialogTitle>Save and recover your questionnaire</DialogTitle>
            <DialogDescription className="leading-6 text-slate-700">
              You can provide an email address so we can help locate your most recently created questionnaire draft when you return. You will also receive a unique recovery code for this draft. Save the code somewhere secure.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-950">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <p>Email recovery does not verify ownership of the email address. Anyone who knows the exact email address may be able to access the newest eligible questionnaire associated with it.</p>
          </div>
          <div className="grid gap-3">
            <Button type="button" size="lg" onClick={() => setStep('email_entry')}>
              Continue with an email
            </Button>
            <Button type="button" size="lg" variant="outline" onClick={() => setStep('code_entry')}>
              Recover with a recovery code
            </Button>
            <Button type="button" variant="ghost" onClick={() => {
              setEmail('');
              setEmailError('');
              setStep('email_entry');
            }}>
              Continue without an email
            </Button>
          </div>
        </>
      );
    }

    if (step === 'email_entry') {
      const noEmail = email.trim() === '';
      return (
        <>
          <DialogHeader>
            <DialogTitle>{noEmail ? 'Continue without an email' : 'Use an email address'}</DialogTitle>
            <DialogDescription>
              Email is optional. Recovery by email happens only when you choose it explicitly.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="pro-draft-email" className="text-sm font-medium text-slate-900">
              Email address (optional)
            </label>
            <Input
              id="pro-draft-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (emailError) setEmailError('');
              }}
              onBlur={() => validateEmail({ allowEmpty: true })}
              aria-invalid={Boolean(emailError)}
              aria-describedby="pro-draft-email-help pro-draft-email-error"
            />
            <p id="pro-draft-email-help" className="text-sm text-slate-600">
              Used to locate the most recently created eligible questionnaire associated with this email.
            </p>
            {emailError && <p id="pro-draft-email-error" role="alert" className="text-sm text-red-700">{emailError}</p>}
          </div>
          {changedSignedEmail && (
            <p role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
              Changing this email will start a new questionnaire association. It will not open drafts that already belong to the replacement email.
            </p>
          )}
          {noEmail ? (
            <>
              <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm leading-5 text-slate-800">
                <Checkbox
                  checked={anonymousAcknowledged}
                  onCheckedChange={(checked) => setAnonymousAcknowledged(checked === true)}
                  aria-label="I understand that without an email address or a saved recovery code, I may not be able to recover my answers after leaving this questionnaire."
                />
                <span>I understand that without an email address or a saved recovery code, I may not be able to recover my answers after leaving this questionnaire.</span>
              </label>
              <Button type="button" size="lg" disabled={!anonymousAcknowledged} onClick={continueWithoutEmail}>
                Continue without an email
              </Button>
            </>
          ) : (
            <div className="grid gap-2">
              <Button type="button" size="lg" onClick={continueWithEmail}>
                Continue with this email
              </Button>
              <Button type="button" variant="outline" onClick={recoverByEmail}>
                Recover saved answers using this email
              </Button>
            </div>
          )}
          <Button type="button" variant="ghost" onClick={() => setStep('choose_recovery_method')}>Back</Button>
        </>
      );
    }

    if (step === 'code_entry') {
      return (
        <>
          <DialogHeader>
            <DialogTitle>Recover with a recovery code</DialogTitle>
            <DialogDescription>Enter the exact code you saved for this questionnaire.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="pro-draft-recovery-code" className="text-sm font-medium text-slate-900">Recovery code</label>
            <Input
              id="pro-draft-recovery-code"
              value={recoveryCode}
              onChange={(event) => setRecoveryCode(event.target.value)}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
              autoComplete="off"
              spellCheck="false"
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button type="button" disabled={!recoveryCode.trim()} onClick={recoverByCode}>Recover questionnaire</Button>
            <Button type="button" variant="outline" onClick={() => setStep('choose_recovery_method')}>Back</Button>
          </div>
        </>
      );
    }

    if (step === 'email_recovery_result') return recoveryResultContent('email');
    if (step === 'code_recovery_result') return recoveryResultContent('code');

    if (step === 'recovery_code_acknowledgement') {
      const code = bootstrap.getRecoveryCodeForDisplay?.();
      const hint = bootstrap.getRecoveryCodeHint?.();
      return (
        <>
          <DialogHeader>
            <DialogTitle>Save your recovery code</DialogTitle>
            <DialogDescription>
              This code can be used to recover this questionnaire later, even if this browser does not keep your saved information.
            </DialogDescription>
          </DialogHeader>
          {bootstrap.memoryOnly && (
            <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-950">
              This browser is not allowing persistent storage. Copy your recovery code now. It may not be available after you close this browser.
            </p>
          )}
          {code ? (
            <code
              ref={codeRef}
              tabIndex={0}
              className="block select-all overflow-x-auto rounded-lg border-2 border-[#1E6BA8] bg-blue-50 p-4 text-center font-mono text-lg font-bold tracking-wider text-[#122947] focus:outline-none focus:ring-2 focus:ring-[#1E6BA8]"
              aria-label="Recovery code"
            >
              {code}
            </code>
          ) : (
            <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">
              Your saved code is not available in full in this browser{hint ? ` (ending ${hint})` : ''}.
            </p>
          )}
          {code && (
            <Button type="button" variant="outline" onClick={copyRecoveryCode}>
              {copyStatus === 'Recovery code copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              Copy recovery code
            </Button>
          )}
          <p role="status" aria-live="polite" className="min-h-5 text-sm text-slate-700">{copyStatus}</p>
          {manualCopy && <p className="text-sm text-slate-700">Press Control+C or Command+C to copy the selected code.</p>}
          {code && (
            <label className="flex items-start gap-3 text-sm text-slate-800">
              <Checkbox
                checked={codeAcknowledged}
                onCheckedChange={(checked) => setCodeAcknowledged(checked === true)}
                aria-label="I have viewed or copied my recovery code."
              />
              <span>I have viewed or copied my recovery code.</span>
            </label>
          )}
          <Button type="button" size="lg" disabled={Boolean(code) && !codeAcknowledged} onClick={onComplete}>
            Continue to questionnaire
          </Button>
        </>
      );
    }

    if (step === 'submitted_read_only_ready') {
      return (
        <>
          <DialogHeader>
            <DialogTitle>Your submitted questionnaire is ready</DialogTitle>
            <DialogDescription>
              This questionnaire has already been submitted and will open in read-only mode. You can review the submitted answers and generate the PDF.
            </DialogDescription>
          </DialogHeader>
          <Button type="button" size="lg" onClick={onComplete}>View submitted questionnaire</Button>
        </>
      );
    }

    if (step === 'error') {
      return (
        <>
          <DialogHeader>
            <DialogTitle>We could not prepare the questionnaire</DialogTitle>
            <DialogDescription>{fatalError || 'Please try again.'}</DialogDescription>
          </DialogHeader>
          <Button type="button" onClick={() => setStep(lastEntryStep)}>Try again</Button>
          <Button type="button" variant="outline" onClick={() => setStep('choose_recovery_method')}>Choose another option</Button>
        </>
      );
    }

    return (
      <>
        <DialogHeader>
          <DialogTitle>Your saved questionnaire is ready</DialogTitle>
          <DialogDescription>Continue when you are ready.</DialogDescription>
        </DialogHeader>
        <ReadySummary bootstrap={bootstrap} />
        <Button type="button" size="lg" onClick={onComplete}>Continue to questionnaire</Button>
      </>
    );
  };

  return (
    <Dialog open modal onOpenChange={() => {}}>
      <DialogContent
        showCloseButton={false}
        data-testid="pro-draft-entry-modal"
        data-modal-state={step}
        className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-xl overflow-y-auto rounded-xl p-4 sm:max-h-[calc(100dvh-3rem)] sm:p-6"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        aria-describedby={undefined}
      >
        {renderStep()}
      </DialogContent>
    </Dialog>
  );
}
