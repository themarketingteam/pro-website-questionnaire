import React, { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Copy, ChevronDown, ChevronUp, AlertTriangle, RefreshCw, Wrench, Pencil, Stethoscope, Loader2 } from 'lucide-react';
import DraftEditPanel from '@/components/admin/DraftEditPanel';
import { toast } from 'sonner';
import QuestionnaireIntakeRecovery from '@/components/admin/QuestionnaireIntakeRecovery';
import AdminQuestionnairePdfSection from '@/components/admin/AdminQuestionnairePdfSection';
import { useDraftRecoveryAccess } from '@/components/admin/DraftRecoveryPasswordGate';
import { transformResponsesToPayload, validateSubmissionPayload } from '@/components/pro-form/submissionPayload';
import { repairProSubmissionPayload } from '@/lib/proPayloadRepair';
import { SERVICE_OPTIONS_GROUPED } from '@/components/pro-form/questionData';
import mspSuccessDigitalLogoDataUrl from '@/assets/mspSuccessDigitalLogo';
import {
  getRecoveryRecord,
  listRecoveryRecords,
  updateRecoveryDraft
} from '@/lib/draftRecoveryApi';
import AdminWorkspaceNav from '@/components/admin/AdminWorkspaceNav';
import IdentityResolutionPanel from '@/components/admin/IdentityResolutionPanel';
import StandaloneSubmissionRecovery from '@/components/admin/StandaloneSubmissionRecovery';
import RecoveryLifecycleActions from '@/components/admin/RecoveryLifecycleActions';

const RECOVERY_PAGE_SIZE = 25;
const RECOVERY_ARCHIVE_STATE_KEY = 'pro-draft-recovery-archive-state';
const VALID_ARCHIVE_STATES = new Set(['active', 'archived', 'deleted', 'all']);

const getInitialArchiveState = () => {
  try {
    const storedState = window.sessionStorage.getItem(RECOVERY_ARCHIVE_STATE_KEY);
    return VALID_ARCHIVE_STATES.has(storedState) ? storedState : 'active';
  } catch {
    return 'active';
  }
};

const safeJsonParse = (value, fallback = {}) => {
  try {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const statusStyles = {
  draft: 'brand-status-badge brand-status-badge--neutral',
  submit_attempted: 'brand-status-badge brand-status-badge--warning',
  submit_failed: 'brand-status-badge brand-status-badge--danger',
  submitted: 'brand-status-badge brand-status-badge--submitted'
};

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
};

const formatRefreshTime = (value) => value?.toLocaleTimeString([], {
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit'
}) || '—';

const parseJson = (value) => {
  try {
    if (!value) return null;
    if (typeof value === 'object') return value;
    return JSON.parse(value);
  } catch { return null; }
};

function DraftAiRepairSection({ draft, recoveryGrant, disabled, onReviewed }) {
  const report = parseJson(draft.ai_repair_report_json);
  const repairError = parseJson(draft.ai_repair_error_json);

  if (!draft.ai_repair_status && !report) return null;

  const aiStatusStyles = {
    completed: 'bg-green-100 text-green-700',
    repair_ready: 'bg-indigo-100 text-indigo-700',
    needs_human_review: 'bg-amber-100 text-amber-800',
    running: 'bg-slate-100 text-slate-600'
  };

  return (
    <div className="brand-ai-panel space-y-2 rounded-lg border p-3 text-sm">
      <p className="font-semibold text-indigo-900">AI Repair Result</p>
      {draft.ai_repair_status && (
        <p><span className="font-medium">Status:</span>{' '}
          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${aiStatusStyles[draft.ai_repair_status] || 'bg-slate-100 text-slate-600'}`}>
            {draft.ai_repair_status}
          </span>
        </p>
      )}
      {draft.last_ai_repair_at && <p><span className="font-medium">Last Repair:</span> {new Date(draft.last_ai_repair_at).toLocaleString()}</p>}
      {draft.ai_repair_applied && <p className="text-green-700 font-medium">✓ Repair was applied</p>}
      {report && (
        <div className="space-y-1">
          <p><span className="font-medium">Decision:</span> <code className="bg-white px-1 rounded">{report.decision}</code></p>
          {report.diagnosis && <p><span className="font-medium">Diagnosis:</span> {report.diagnosis}</p>}
          {Array.isArray(report.changed_paths) && report.changed_paths.length > 0 && (
            <p><span className="font-medium">Changed paths:</span> {report.changed_paths.length}</p>
          )}
        </div>
      )}
      {repairError && (
        <p className="text-red-700 text-xs">{repairError.message || JSON.stringify(repairError)}</p>
      )}
      <IdentityResolutionPanel
        resolution={report?.identity_resolution}
        recoveryGrant={recoveryGrant}
        currentBusinessName={draft.business_name}
        disabled={disabled}
        onReviewed={onReviewed}
      />
    </div>
  );
}

function DraftRow({ draft, expanded, onToggle, hasDuplicateSession, onRetrySuccess, recoveryGrant }) {
  const [retrying, setRetrying] = useState(false);
  // aiRunning: null | 'diagnose_only' | 'repair_only' | 'repair_and_retry'
  const [aiRunning, setAiRunning] = useState(null);
  const [localDraft, setLocalDraft] = useState(draft);
  const [editing, setEditing] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailVersion, setDetailVersion] = useState(0);

  const isWorking = retrying || !!aiRunning;

  // Keep localDraft in sync when parent reloads (but not while editing to avoid clobbering)
  React.useEffect(() => { if (!editing) setLocalDraft(draft); }, [draft, editing]);

  useEffect(() => {
    if (!expanded) return undefined;
    let active = true;

    const loadDetails = async () => {
      setDetailLoading(true);
      setDetailError('');
      try {
        const data = await getRecoveryRecord({
          recoveryGrant,
          recordType: 'draft',
          recordId: draft.id
        });
        if (active) setLocalDraft((current) => ({ ...current, ...data.record }));
      } catch (error) {
        if (active) setDetailError(error?.message || 'Unable to load this draft.');
      } finally {
        if (active) setDetailLoading(false);
      }
    };

    loadDetails();
    return () => {
      active = false;
    };
  }, [expanded, draft.id, recoveryGrant, detailVersion]);

  const parsedResponses = safeJsonParse(localDraft.responses_json, {});

  // Build the final submission payload exactly as it would be sent to ProFormSubmission.create()
  // Step 1: transform raw responses → raw payload
  // Step 2: run through repairProSubmissionPayload (same as the real submit path)
  const { finalSubmissionPayload, repairWarnings } = useMemo(() => {
    try {
      const businessName = localDraft.business_name || '';
      const domain = localDraft.domain || '';
      const rawPayload = transformResponsesToPayload(
        parsedResponses,
        businessName,
        domain,
        SERVICE_OPTIONS_GROUPED
      );
      const { payload, warnings } = repairProSubmissionPayload(rawPayload);
      return { finalSubmissionPayload: payload, repairWarnings: warnings };
    } catch (err) {
      return {
        finalSubmissionPayload: { error: `Failed to build payload: ${err?.message}` },
        repairWarnings: []
      };
    }
  }, [parsedResponses, localDraft.business_name, localDraft.domain]);

  const handleRetry = async (e) => {
    e.stopPropagation();
    setRetrying(true);
    try {
      // If mapped_payload_json is set (manually edited), use direct draft-based retry.
      // Otherwise fall back to session-based intake lookup.
      const params = localDraft.mapped_payload_json
        ? { draftId: localDraft.id, recoveryGrant }
        : {
            questionnaireSessionId: localDraft.session_id,
            session_id: localDraft.session_id,
            recoveryGrant
          };

      const result = await base44.functions.invoke('retryProQuestionnaireIntakeSubmission', params);
      if (result.data?.success) {
        toast.success(
          result.data?.alreadySubmitted
            ? `Already submitted — linked to ${result.data.linkedSubmissionId}`
            : `Submission succeeded for ${localDraft.business_name || localDraft.session_id}`
        );
        onRetrySuccess?.();
        setDetailVersion((version) => version + 1);
      } else {
        const errMsg = result.data?.error?.message || result.data?.error || 'Unknown error';
        toast.error(`Retry failed: ${errMsg}`);
      }
    } catch (err) {
      const errorMessage = err?.response?.data?.error?.message
        || err?.response?.data?.error
        || err?.message
        || 'Unknown error';
      toast.error(`Retry failed: ${errorMessage}`);
    } finally {
      setRetrying(false);
    }
  };

  const handleAiAction = async (e, mode) => {
    e.stopPropagation();
    setAiRunning(mode);
    const modeLabels = {
      diagnose_only: 'Diagnose',
      repair_only: 'Repair Only',
      repair_and_retry: 'Repair + Retry'
    };
    try {
      const result = await base44.functions.invoke('repairProQuestionnaireIntakeSubmission', {
        draftId: localDraft.id,
        mode,
        autoRetry: mode === 'repair_and_retry',
        forceRetry: false,
        recoveryGrant
      });
      const data = result?.data;
      if (data?.success) {
        if (data?.linkedSubmissionId) {
          toast.success(`Repair + Retry succeeded — Submission: ${data.linkedSubmissionId}`);
        } else if (mode === 'repair_and_retry' && data?.zapierSent) {
          toast.success('Repair + Retry delivered the validated payload');
        } else {
          toast.success(`${modeLabels[mode]} completed`);
        }
        if (mode === 'diagnose_only' && data?.report) {
          setLocalDraft((current) => ({
            ...current,
            ai_repair_status: 'diagnosed',
            ai_repair_report_json: JSON.stringify(data.report),
            ai_repair_error_json: ''
          }));
        } else {
          setDetailVersion((version) => version + 1);
        }
      } else {
        const errMsg = data?.error?.message || data?.errors?.[0] || `${modeLabels[mode]} failed`;
        toast.error(errMsg);
      }
    } catch (err) {
      toast.error(err?.response?.data?.error?.message || err?.response?.data?.error || err?.message || `${modeLabels[mode]} failed`);
    } finally {
      setAiRunning(null);
    }
  };

  // The "active" payload: manually edited mapped_payload_json takes priority over computed
  const activeFinalPayload = useMemo(() => {
    if (localDraft.mapped_payload_json) {
      try {
        const p = typeof localDraft.mapped_payload_json === 'string'
          ? JSON.parse(localDraft.mapped_payload_json)
          : localDraft.mapped_payload_json;
        return p;
      } catch { /* fall through */ }
    }
    return finalSubmissionPayload;
  }, [localDraft.mapped_payload_json, finalSubmissionPayload]);

  const isMappedPayloadOverride = !!localDraft.mapped_payload_json;
  const payloadValidation = useMemo(
    () => validateSubmissionPayload(activeFinalPayload),
    [activeFinalPayload]
  );

  const copySubmissionPayload = async () => {
    await navigator.clipboard.writeText(JSON.stringify(activeFinalPayload, null, 2));
    toast.success('Submission payload copied');
  };

  const copyRawResponses = async () => {
    await navigator.clipboard.writeText(JSON.stringify(parsedResponses, null, 2));
    toast.success('Raw responses copied');
  };

  const copyAiRepairedPayload = async () => {
    if (!localDraft.ai_repaired_payload_json) { toast.error('No AI repaired payload available'); return; }
    await navigator.clipboard.writeText(localDraft.ai_repaired_payload_json);
    toast.success('AI repaired payload copied');
  };

  const copyAiReport = async () => {
    if (!localDraft.ai_repair_report_json) { toast.error('No AI repair report available'); return; }
    await navigator.clipboard.writeText(localDraft.ai_repair_report_json);
    toast.success('AI repair report copied');
  };


  return (
    <Card className={`brand-record-card ${expanded ? 'brand-record-card--expanded' : ''}`}>
      <button
        type="button"
        onClick={onToggle}
        className="brand-record-trigger w-full text-left transition-colors"
      >
        <CardContent className="p-4">
          <div className="grid gap-3 md:grid-cols-[1.2fr_1fr_auto_1fr_1fr_1fr] items-start">
            <div>
              <p className="font-medium text-slate-900">{localDraft.business_name || 'Unnamed business'}</p>
              <p className="text-sm text-slate-500 break-all">{localDraft.domain || '—'}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">User Email</p>
              <p className="text-sm text-slate-900 break-all">{draft.user_email || '—'}</p>
            </div>
            <div className="space-y-2">
              <Badge className={statusStyles[draft.status] || statusStyles.draft}>
                {draft.status || 'draft'}
              </Badge>
              {draft.archived_at && (
                <Badge className="brand-status-badge brand-status-badge--archived">
                  archived
                </Badge>
              )}
              {draft.soft_deleted_at && (
                <Badge className="brand-status-badge brand-status-badge--danger">
                  deleted
                </Badge>
              )}
              {draft.link_integrity_status === 'missing_submission' && (
                <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
                  linked submission missing
                </Badge>
              )}
              {hasDuplicateSession && (
                <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 flex items-center gap-1 w-fit">
                  <AlertTriangle className="w-3 h-3" />
                  Duplicate session ID — latest record shown first
                </Badge>
              )}
            </div>
            <div>
              <p className="text-sm text-slate-500">Last Saved</p>
              <p className="text-sm text-slate-900">{formatDate(draft.last_saved_at)}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">Last Changed Question</p>
              <p className="text-sm text-slate-900">{draft.last_changed_question_id || '—'}</p>
            </div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-slate-500">Session ID</p>
                <p className="text-xs text-slate-900 break-all">{draft.session_id}</p>
              </div>
              {expanded ? (
                <ChevronUp className="w-4 h-4 text-slate-500 flex-shrink-0 mt-1" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0 mt-1" />
              )}
            </div>
          </div>
        </CardContent>
      </button>

      {expanded && detailLoading && (
        <div className="brand-expanded-panel flex items-center gap-2 p-4 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading the selected draft details…
        </div>
      )}

      {expanded && !detailLoading && detailError && (
        <div className="brand-expanded-panel p-4 text-sm text-red-700" role="alert">{detailError}</div>
      )}

      {expanded && !detailLoading && !detailError && (
        <div className="brand-expanded-panel p-4 space-y-4">
          {localDraft.archived_at && (
            <div className="brand-archive-notice rounded-lg border p-3 text-sm" role="note">
              <p className="font-semibold">Archived recovery record</p>
              <p>This record is preserved and has not been deleted. It remains available when the record filter is set to Archived Records or All Records.</p>
            </div>
          )}
          {localDraft.soft_deleted_at && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="note">
              <p className="font-semibold">Deleted Records</p>
              <p>This is a reversible soft deletion. The questionnaire and its history remain retained.</p>
              <p className="mt-1">Reason: {localDraft.soft_delete_reason || '—'}</p>
            </div>
          )}
          {localDraft.link_integrity_status === 'missing_submission' && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
              <p className="font-semibold">Linked final submission is unavailable</p>
              <p>The complete draft payload remains retained here and can still be copied or downloaded as a PDF.</p>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 text-sm">
              <p><span className="font-medium">Business Name:</span> {localDraft.business_name || '—'}</p>
              <p><span className="font-medium">Domain:</span> {localDraft.domain || '—'}</p>
              <p><span className="font-medium">User Name:</span> {localDraft.user_name || '—'}</p>
              <p><span className="font-medium">User Email:</span> {localDraft.user_email || '—'}</p>
              <p><span className="font-medium">User ID:</span> {localDraft.user_id || '—'}</p>
              <p><span className="font-medium">Final Submission ID:</span> {localDraft.final_submission_id || '—'}</p>
            </div>
            <div className="space-y-2 text-sm">
              <p><span className="font-medium">Submit Attempted:</span> {formatDate(localDraft.submit_attempted_at)}</p>
              <p><span className="font-medium">Submitted At:</span> {formatDate(localDraft.submitted_at)}</p>
              <p><span className="font-medium">Current Question:</span> {localDraft.current_question_id || '—'}</p>
              <p><span className="font-medium">Last Changed At:</span> {formatDate(localDraft.last_changed_at)}</p>
              <p><span className="font-medium">Save Error:</span> {localDraft.save_error || '—'}</p>
              <p><span className="font-medium">Submit Error:</span> {localDraft.submit_error || '—'}</p>
              <p><span className="font-medium">Archived At:</span> {formatDate(localDraft.archived_at)}</p>
              <p><span className="font-medium">Archive Reason:</span> {localDraft.archive_reason || '—'}</p>
              <p><span className="font-medium">Retention Active Until:</span> {formatDate(localDraft.retention_until)}</p>
              <p><span className="font-medium">Soft Deleted At:</span> {formatDate(localDraft.soft_deleted_at)}</p>
            </div>
          </div>

          {/* Edit panel */}
          {editing ? (
            <DraftEditPanel
              draft={localDraft}
              computedPayload={finalSubmissionPayload}
              saveDraft={async (updates) => {
                const data = await updateRecoveryDraft({
                  recoveryGrant,
                  recordId: localDraft.id,
                  updates
                });
                return data.record;
              }}
              onSaved={(updated) => {
                setLocalDraft(prev => ({ ...prev, ...updated }));
                setEditing(false);
                toast.success('Draft updated — payload preview refreshed');
              }}
              onCancel={() => setEditing(false)}
            />
          ) : null}

          <AdminQuestionnairePdfSection
            sourceType="draft"
            sourceId={localDraft.id}
            sessionId={localDraft.session_id}
            payload={activeFinalPayload}
            fallbackResponses={parsedResponses}
            businessName={localDraft.business_name}
            domain={localDraft.domain}
            submissionDate={localDraft.submitted_at || localDraft.last_saved_at}
            recoveryGrant={recoveryGrant}
            disabled={isWorking}
          />

          <div className="space-y-4">
            <section aria-label="Actions" className="space-y-2">
              <p className="brand-action-label text-xs uppercase">Actions</p>
              <div className="flex flex-wrap gap-2">
                {/* Edit Draft — always available */}
                {!editing && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="brand-button-secondary gap-2"
                    onClick={(e) => { e.stopPropagation(); setEditing(true); }}
                    disabled={isWorking}
                  >
                    <Pencil className="w-3 h-3" />
                    Edit Draft
                  </Button>
                )}

                {/* Retry Submission — all statuses (draft may also need direct submit) */}
                <Button
                  type="button"
                  size="sm"
                  onClick={handleRetry}
                  disabled={isWorking}
                  className="brand-button-primary gap-2"
                >
                  {retrying ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  {retrying ? 'Retrying...' : 'Retry Submission'}
                </Button>
                <RecoveryLifecycleActions
                  recordType="draft"
                  record={localDraft}
                  recoveryGrant={recoveryGrant}
                  disabled={isWorking}
                  onChanged={() => {
                    setEditing(false);
                    onRetrySuccess?.();
                  }}
                />
              </div>
            </section>

            <section aria-label="AI Actions" className="brand-action-divider space-y-2 border-t pt-4">
              <p className="brand-action-label text-xs uppercase">AI Actions</p>
              <div className="flex flex-wrap gap-2">
                {/* Diagnose — identity and structure analysis, no source-record changes or submission */}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="brand-button-secondary gap-2"
                  disabled={isWorking}
                  onClick={(e) => handleAiAction(e, 'diagnose_only')}
                  title="Analyzes structure and missing identity fields without changing the draft or creating a submission."
                >
                  {aiRunning === 'diagnose_only' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Stethoscope className="w-3 h-3" />}
                  {aiRunning === 'diagnose_only' ? 'Diagnosing...' : 'Diagnose'}
                </Button>

                {/* AI Repair Only — repairs and saves to draft, does NOT create submission */}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="brand-button-secondary gap-2"
                  disabled={isWorking}
                  onClick={(e) => handleAiAction(e, 'repair_only')}
                  title="Diagnoses and repairs the draft payload. Does NOT create a final submission."
                >
                  {aiRunning === 'repair_only' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wrench className="w-3 h-3" />}
                  {aiRunning === 'repair_only' ? 'Repairing...' : 'Repair Only'}
                </Button>

                {/* AI Repair + Retry — diagnose, repair, then create submission */}
                <Button
                  type="button"
                  size="sm"
                  className="brand-button-dark gap-2"
                  disabled={isWorking || Boolean(localDraft.final_submission_id)}
                  onClick={(e) => handleAiAction(e, 'repair_and_retry')}
                  title={localDraft.final_submission_id
                    ? 'A final submission already exists. Use Retry Submission only if it must be delivered again.'
                    : 'Diagnoses and repairs the draft, then delivers only a validated payload.'}
                >
                  {aiRunning === 'repair_and_retry' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wrench className="w-3 h-3" />}
                  {aiRunning === 'repair_and_retry'
                    ? 'Running...'
                    : (localDraft.final_submission_id ? 'Already Submitted' : 'Repair + Retry')}
                </Button>
              </div>

              <p className="text-xs text-slate-400">
                {localDraft.final_submission_id
                  ? 'A final submission is already linked. AI Repair + Retry is disabled to prevent accidental duplicate delivery.'
                  : 'Repair + Retry sends only a successfully repaired and validated payload. Failed or timed-out repairs are never submitted.'}
              </p>
            </section>

            <section aria-label="Data Copy Options (JSON)" className="brand-action-divider space-y-2 border-t pt-4">
              <p className="brand-action-label text-xs uppercase">Data Copy Options (JSON)</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={copySubmissionPayload} className="brand-button-secondary gap-2" disabled={isWorking}>
                  <Copy className="w-3 h-3" /> Endpoint Payload
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={copyRawResponses} className="brand-button-secondary gap-2" disabled={isWorking}>
                  <Copy className="w-3 h-3" /> Raw Draft
                </Button>
                {localDraft.ai_repaired_payload_json && (
                  <Button type="button" variant="outline" size="sm" onClick={copyAiRepairedPayload} className="brand-button-secondary gap-2">
                    <Copy className="w-3 h-3" /> Copy AI Repaired Payload
                  </Button>
                )}
                {localDraft.ai_repair_report_json && (
                  <Button type="button" variant="outline" size="sm" onClick={copyAiReport} className="brand-button-secondary gap-2">
                    <Copy className="w-3 h-3" /> Copy AI Report
                  </Button>
                )}
              </div>
            </section>
          </div>

          {/* AI Repair status panel */}
          <DraftAiRepairSection
            draft={localDraft}
            recoveryGrant={recoveryGrant}
            disabled={isWorking}
            onReviewed={() => setDetailVersion((version) => version + 1)}
          />

          <section className="brand-payload-card" aria-label="Final Submission Payload">
            <div className="brand-payload-card__header">
              <h3 className="brand-payload-card__title">Final Submission Payload</h3>
              <span
                className={`brand-payload-card__status ${payloadValidation.ok
                  ? 'brand-payload-card__status--valid'
                  : 'brand-payload-card__status--review'}`}
                role="status"
              >
                {payloadValidation.ok ? 'valid' : 'needs review'}
              </span>
            </div>

            <div className="brand-payload-card__source">
              <p>
                <span className="brand-payload-card__meta-label">Source:</span>{' '}
                <code>{isMappedPayloadOverride ? 'mapped_payload_json' : 'responses_json'}</code>
                <span className="brand-payload-card__source-detail">
                  {isMappedPayloadOverride ? ' · manually edited' : ' · computed and normalized'}
                </span>
              </p>
              <span className="brand-payload-card__usage">Used by Retry Submission</span>
            </div>

            {repairWarnings.length > 0 && (
              <div
                className="brand-payload-card__warnings"
                role="status"
                aria-label="Deterministic repair warnings"
              >
                <span className="brand-payload-card__meta-label">Deterministic repair warnings:</span>
                <span className="brand-payload-card__warning-items">
                  {repairWarnings.map((warning) => (
                    <code className="brand-payload-card__warning" key={warning}>{warning}</code>
                  ))}
                </span>
              </div>
            )}

            <pre
              className="brand-payload-card__json"
              aria-label="Final submission payload JSON"
            >
              {JSON.stringify(activeFinalPayload, null, 2)}
            </pre>
          </section>
        </div>
      )}
    </Card>
  );
}

export default function ProFormDraftRecovery() {
  const { recoveryGrant } = useDraftRecoveryAccess();
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [archiveState, setArchiveState] = useState(getInitialArchiveState);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [expandedId, setExpandedId] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);
  const [duplicateSessionIds, setDuplicateSessionIds] = useState(new Set());

  const reloadDrafts = () => setRefreshKey((k) => k + 1);

  const resetFilters = () => {
    setStatusFilter('all');
    setArchiveState('active');
    setSearch('');
    setDebouncedSearch('');
    setPage(1);
    setExpandedId('');
    reloadDrafts();
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => window.clearTimeout(timeoutId);
  }, [search]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(RECOVERY_ARCHIVE_STATE_KEY, archiveState);
    } catch {
      // The recovery page still functions when browser storage is unavailable.
    }
  }, [archiveState]);

  useEffect(() => {
    let mounted = true;

    const loadDrafts = async () => {
      setLoading(true);
      setError('');

      try {
        const data = await listRecoveryRecords({
          recoveryGrant,
          recordType: 'draft',
          page,
          pageSize: RECOVERY_PAGE_SIZE,
          status: statusFilter,
          archiveState,
          search: debouncedSearch
        });

        if (!mounted) return;
        setDrafts(Array.isArray(data.records) ? data.records : []);
        setHasMore(Boolean(data.hasMore));
        setDuplicateSessionIds(new Set(Array.isArray(data.duplicateSessionIds) ? data.duplicateSessionIds : []));
        setLastRefreshedAt(new Date());
      } catch (loadError) {
        if (!mounted) return;
        setError(loadError?.message || 'Failed to load drafts.');
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadDrafts();
    return () => {
      mounted = false;
    };
  }, [archiveState, debouncedSearch, page, recoveryGrant, refreshKey, statusFilter]);

  const firstVisibleRecord = drafts.length > 0 ? ((page - 1) * RECOVERY_PAGE_SIZE) + 1 : 0;
  const lastVisibleRecord = drafts.length > 0 ? firstVisibleRecord + drafts.length - 1 : 0;

  return (
    <main className="draft-recovery-brand draft-recovery-brand-page">
      <div className="draft-recovery-brand__shell space-y-6">
        <header className="draft-recovery-brand__hero">
          <span className="draft-recovery-brand__logo-plate">
            <img
              src={mspSuccessDigitalLogoDataUrl}
              alt="Kaseya MSP Success"
              className="draft-recovery-brand__logo"
              width="411"
              height="79"
            />
          </span>
          <div>
            <p className="draft-recovery-brand__eyebrow">Admin support workspace</p>
            <h1><span className="draft-recovery-brand__product-label">Pro</span> | Form Draft Recovery</h1>
            <p className="draft-recovery-brand__hero-copy">
              Review questionnaire drafts, recover failed submissions, and manage saved client PDFs.
            </p>
            <AdminWorkspaceNav />
          </div>
        </header>

        <div className="draft-recovery-brand__content">
          <Card className="brand-panel">
            <CardHeader className="brand-section-header">
              <p className="draft-recovery-brand__section-kicker">Find a questionnaire</p>
              <CardTitle className="brand-heading brand-section-title">Draft Filters</CardTitle>
              <p className="draft-recovery-brand__section-copy">Narrow the records by workflow status or client details.</p>
            </CardHeader>
            <CardContent className="brand-filter-controls">
              <Select value={statusFilter} onValueChange={(value) => {
                setStatusFilter(value);
                setPage(1);
                setExpandedId('');
              }}>
                <SelectTrigger aria-label="Draft status filter">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Draft Statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="submit_attempted">Submit Attempted</SelectItem>
                  <SelectItem value="submit_failed">Submit Failed</SelectItem>
                  <SelectItem value="submitted">Submitted</SelectItem>
                </SelectContent>
              </Select>

              <Select value={archiveState} onValueChange={(value) => {
                setArchiveState(value);
                setPage(1);
                setExpandedId('');
              }}>
                <SelectTrigger aria-label="Record set filter">
                  <SelectValue placeholder="Record set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active Records</SelectItem>
                  <SelectItem value="archived">Archived Records</SelectItem>
                  <SelectItem value="deleted">Deleted Records</SelectItem>
                  <SelectItem value="all">All Retained Records</SelectItem>
                </SelectContent>
              </Select>

              <Input
                className="brand-filter-search"
                placeholder="Search by business name, domain, user email, or session ID"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                  setExpandedId('');
                }}
              />

              <Button
                type="button"
                variant="outline"
                className="brand-button-secondary brand-filter-refresh"
                onClick={resetFilters}
              >
                <RefreshCw aria-hidden="true" />
                Refresh
              </Button>

              <p className="brand-filter-last-updated" role="status" aria-live="polite">
                Last updated {formatRefreshTime(lastRefreshedAt)}
              </p>
            </CardContent>
          </Card>

          <QuestionnaireIntakeRecovery recoveryGrant={recoveryGrant} />

          <StandaloneSubmissionRecovery
            recoveryGrant={recoveryGrant}
            archiveState={archiveState}
            search={debouncedSearch}
            refreshKey={refreshKey}
          />

          <section className="space-y-4" aria-labelledby="draft-records-title">
            <div className="draft-recovery-brand__list-heading">
              <h2 id="draft-records-title">Questionnaire Drafts</h2>
              <p>
                {drafts.length > 0
                  ? `Showing ${firstVisibleRecord}–${lastVisibleRecord} · Page ${page}`
                  : `Page ${page}`}
              </p>
            </div>
            {error && (
              <Card className="border-red-200 bg-red-50">
                <CardContent className="p-6 text-red-700">{error}</CardContent>
              </Card>
            )}

            {loading ? (
              <Card className="brand-loading-card">
                <CardContent className="p-6 text-slate-600">Loading drafts...</CardContent>
              </Card>
            ) : drafts.length === 0 ? (
              <Card className="brand-loading-card">
                <CardContent className="p-6 text-slate-600">No matching drafts found.</CardContent>
              </Card>
            ) : (
              <>
                {drafts.map((draft) => (
                  <DraftRow
                    key={draft.id}
                    draft={draft}
                    expanded={expandedId === draft.id}
                    onToggle={() => setExpandedId(expandedId === draft.id ? '' : draft.id)}
                    hasDuplicateSession={duplicateSessionIds.has(draft.session_id)}
                    onRetrySuccess={reloadDrafts}
                    recoveryGrant={recoveryGrant}
                  />
                ))}
                <div className="flex items-center justify-between gap-3 pt-1" aria-label="Draft pagination">
                  <Button
                    type="button"
                    variant="outline"
                    className="brand-button-secondary"
                    disabled={page === 1 || loading}
                    onClick={() => {
                      setPage((current) => Math.max(1, current - 1));
                      setExpandedId('');
                    }}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-white">Page {page}</span>
                  <Button
                    type="button"
                    variant="outline"
                    className="brand-button-secondary"
                    disabled={!hasMore || loading}
                    onClick={() => {
                      setPage((current) => current + 1);
                      setExpandedId('');
                    }}
                  >
                    Next
                  </Button>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
