import { useCallback, useMemo, useState } from 'react';
import { useStore } from 'react-redux';
import { ProDraftCredentialProvider } from '@/contexts/ProDraftCredentialContext';
import { useProDraftBootstrap } from '@/hooks/useProDraftBootstrap';
import {
  createClientDraftIdentityContext,
  readProQuestionnaireIdentityParams,
} from '@/lib/proDraftClientIdentityContext';
import { safeGetWindowLocationHref } from '@/lib/browserSafety';
import {
  frontendRuntimeConfig,
  isDurableDraftClientEnabled,
} from '@/lib/proDraftRuntimeConfig';
import { useQuestionnairePersistence } from '@/components/store/QuestionnairePersistenceContext';
import ProDraftEntryModal from './ProDraftEntryModal';
import { ProDraftSyncProvider } from '@/contexts/ProDraftSyncContext';
import { ProDraftConflictProvider } from '@/contexts/ProDraftConflictContext';
import ProDraftConflictDialog from './ProDraftConflictDialog';

const PREPARING_PHASES = new Set([
  'idle',
  'reading_identity',
  'reading_local_cache',
  'reading_credentials',
  'resuming_stored_draft',
  'loading_authorized_draft',
  'reconciling_state',
  'hydrating_redux',
]);

const EnabledProDraftBootstrapGate = ({
  children,
  readOnlyChildren = null,
  runtimeConfig = frontendRuntimeConfig,
  locationHref = undefined,
  coordinator = undefined,
  captchaProvider = undefined,
  captchaSiteKey = undefined,
  onEntryReady = undefined,
}) => {
  const store = useStore();
  const persistence = useQuestionnairePersistence();
  const href = typeof locationHref === 'string'
    ? locationHref
    : safeGetWindowLocationHref();
  const params = useMemo(() => readProQuestionnaireIdentityParams({ href }), [href]);
  const identityContext = useMemo(
    () => createClientDraftIdentityContext(params),
    [params],
  );
  const [entryAcknowledged, setEntryAcknowledged] = useState(false);

  const bootstrap = useProDraftBootstrap({
    store,
    storage: persistence.storage,
    browserNamespace: persistence.namespace,
    identityContext,
    runtimeConfig,
    ...(coordinator ? { coordinator } : {}),
  });

  const createIdentityForEmail = useCallback((recoveryEmail) => (
    createClientDraftIdentityContext({ ...params, recoveryEmail })
  ), [params]);
  const createAnonymousIdentity = useCallback(() => (
    createClientDraftIdentityContext({
      ...params,
      recoveryEmail: '',
      signedInvitationEmail: '',
      recoveryEmailSource: 'anonymous',
      associationIntent: 'anonymous_start',
      anonymousRecoveryAcknowledged: true,
    })
  ), [params]);

  const preparing = PREPARING_PHASES.has(bootstrap.phase);
  const modalReady = !preparing;
  const interactiveReady = bootstrap.phase === 'ready' && entryAcknowledged;
  const completeEntry = () => {
    if (bootstrap.phase !== 'ready') return;
    setEntryAcknowledged(true);
    onEntryReady?.({ readOnly: bootstrap.readOnly, outcome: bootstrap.outcome });
  };

  const content = typeof children === 'function'
    ? children({ readOnly: bootstrap.readOnly })
    : children;
  const submittedContent = readOnlyChildren || content;

  return (
    <ProDraftCredentialProvider coordinator={bootstrap.coordinator}>
      <ProDraftSyncProvider
        enabled={interactiveReady}
        runtimeConfig={runtimeConfig}
        pendingServerSync={bootstrap.pendingServerSync}
      >
        <ProDraftConflictProvider>
          <section
            aria-busy={!interactiveReady}
            data-testid="pro-draft-bootstrap-gate"
            data-bootstrap-phase={bootstrap.phase}
          >
          {preparing && (
            <div
              role="status"
              aria-live="polite"
              className="flex min-h-[18rem] items-center justify-center bg-white px-4 text-center"
            >
              <div className="space-y-3">
                <span
                  className="mx-auto block h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-[#1E6BA8]"
                  aria-hidden="true"
                />
                <p className="font-medium text-slate-800">Preparing draft recovery options…</p>
              </div>
            </div>
          )}
          {modalReady && !entryAcknowledged && (
            <ProDraftEntryModal
              bootstrap={bootstrap}
              initialEmail={params.signedInvitationEmail || params.recoveryEmail}
              signedInvitationEmail={params.signedInvitationEmail}
              environment={runtimeConfig.environment}
              createIdentityForEmail={createIdentityForEmail}
              createAnonymousIdentity={createAnonymousIdentity}
              captchaProvider={captchaProvider}
              captchaSiteKey={captchaSiteKey}
              onComplete={completeEntry}
            />
          )}
          <p className="sr-only" role="status" aria-live="polite">
            {interactiveReady
              ? (bootstrap.readOnly
                ? 'Submitted questionnaire ready in read-only mode.'
                : 'Questionnaire ready.')
              : 'Questionnaire interaction is unavailable until draft recovery is complete.'}
          </p>
          {interactiveReady && bootstrap.readOnly && (
            <fieldset disabled aria-disabled="true" className="min-w-0 border-0 p-0">
              <legend className="sr-only">Submitted questionnaire read-only content</legend>
              {submittedContent}
            </fieldset>
          )}
          {interactiveReady && !bootstrap.readOnly && content}
          </section>
          <ProDraftConflictDialog />
        </ProDraftConflictProvider>
      </ProDraftSyncProvider>
    </ProDraftCredentialProvider>
  );
};

export default function ProDraftBootstrapGate({
  enabled = isDurableDraftClientEnabled(frontendRuntimeConfig),
  children,
  ...props
}) {
  if (!enabled) return children;
  return <EnabledProDraftBootstrapGate {...props}>{children}</EnabledProDraftBootstrapGate>;
}
