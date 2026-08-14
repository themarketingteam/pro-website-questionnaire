import { useState } from 'react';
import { ExternalLink, Loader2, SearchCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { reviewIdentityCandidate } from '@/lib/draftRecoveryApi';
import { toast } from 'sonner';

const percentage = (value) => Number.isFinite(Number(value))
  ? `${Math.round(Number(value) * 100)}%`
  : '—';

const fieldLabel = {
  business_name: 'Business Name',
  domain: 'Domain'
};

const isReviewable = (detail) => Boolean(
  detail?.candidate
  && !['existing', 'applied', 'rejected'].includes(detail?.state)
);

function CandidateField({
  field,
  detail,
  resolution,
  recoveryGrant,
  canApply,
  disabled,
  onReviewed
}) {
  const [running, setRunning] = useState('');
  if (!detail) return null;
  const applyAllowed = canApply && detail.state !== 'conflict';

  const decide = async (decision) => {
    setRunning(decision);
    try {
      await reviewIdentityCandidate({
        recoveryGrant,
        attemptId: resolution.attempt_id,
        field,
        decision,
        expectedFingerprint: resolution.payload_fingerprint
      });
      toast.success(`${fieldLabel[field]} candidate ${decision === 'apply' ? 'applied' : 'rejected'}`);
      await onReviewed?.();
    } catch (error) {
      toast.error(error?.message || `Unable to ${decision} this candidate`);
    } finally {
      setRunning('');
    }
  };

  return (
    <div className="rounded-lg border border-indigo-100 bg-white p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-slate-900">{fieldLabel[field]}</p>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="brand-status-badge brand-status-badge--info">{detail.state || 'unknown'}</Badge>
          <span className="text-xs font-bold text-indigo-900">{percentage(detail.confidence)}</span>
        </div>
      </div>
      {detail.current && <p><span className="font-medium">Current:</span> {detail.current}</p>}
      {detail.candidate && <p><span className="font-medium">Candidate:</span> {detail.candidate}</p>}
      <p className="text-xs text-slate-500">
        Auto-fill threshold: {percentage(detail.threshold)}{detail.auto_eligible ? ' · threshold and evidence gates passed' : ''}
      </p>

      {Array.isArray(detail.evidence) && detail.evidence.length > 0 && (
        <ul className="space-y-1 text-xs text-slate-600">
          {detail.evidence.slice(0, 5).map((evidence, index) => (
            <li key={`${field}-evidence-${index}`} className="rounded bg-slate-50 p-2">
              {evidence.path && <code className="block text-indigo-800">{evidence.path}</code>}
              {evidence.excerpt && <span>{evidence.excerpt}</span>}
              {evidence.url && (
                <a
                  href={evidence.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-1 inline-flex items-center gap-1 text-indigo-700 underline"
                >
                  Review source <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      {isReviewable(detail) && resolution.attempt_id && (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            className="brand-button-primary gap-1"
            disabled={disabled || running || !applyAllowed}
            onClick={() => decide('apply')}
            title={detail.state === 'conflict'
              ? 'Conflicting valid values require direct administrator review; neither value will be overwritten.'
              : (!canApply ? 'Accept or enter the Business Name before applying a Domain.' : undefined)}
          >
            {running === 'apply' ? <Loader2 className="h-3 w-3 animate-spin" /> : <SearchCheck className="h-3 w-3" />}
            Apply
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="brand-button-secondary gap-1"
            disabled={disabled || running}
            onClick={() => decide('reject')}
          >
            {running === 'reject' ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}

export default function IdentityResolutionPanel({
  resolution,
  recoveryGrant = '',
  currentBusinessName = '',
  disabled = false,
  onReviewed
}) {
  if (!resolution) return null;
  const businessAvailable = Boolean(
    currentBusinessName
    || resolution.business_name?.current
    || resolution.applied_fields?.includes('business_name')
    || resolution.business_name?.state === 'existing'
  );

  return (
    <section className="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 text-sm" aria-label="Identity resolution">
      <div>
        <p className="font-semibold text-indigo-950">Business Identity Recovery</p>
        <p className="text-xs text-slate-600">
          Resolver {resolution.resolver_version || '—'} · {resolution.scheduled_shadow_mode ? 'scheduled shadow mode' : (resolution.status || 'analysis complete')}
        </p>
      </div>

      <CandidateField
        field="business_name"
        detail={resolution.business_name}
        resolution={resolution}
        recoveryGrant={recoveryGrant}
        canApply
        disabled={disabled}
        onReviewed={onReviewed}
      />
      <CandidateField
        field="domain"
        detail={resolution.domain}
        resolution={resolution}
        recoveryGrant={recoveryGrant}
        canApply={businessAvailable}
        disabled={disabled}
        onReviewed={onReviewed}
      />

      {Array.isArray(resolution.errors) && resolution.errors.length > 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900" role="status">
          <span className="font-semibold">Resolver notes:</span> {resolution.errors.join(', ')}
        </div>
      )}
    </section>
  );
}
