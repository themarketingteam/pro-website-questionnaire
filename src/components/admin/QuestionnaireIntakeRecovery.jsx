import { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { ChevronDown, ChevronUp, Loader2, Stethoscope, Wrench, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import AdminQuestionnairePdfSection from '@/components/admin/AdminQuestionnairePdfSection';
import { getIntakePdfPayload } from '@/lib/questionnairePdfVersions';
import { getRecoveryRecord, listRecoveryRecords } from '@/lib/draftRecoveryApi';
import IdentityResolutionPanel from '@/components/admin/IdentityResolutionPanel';

const RECOVERY_PAGE_SIZE = 25;

const statusStyles = {
  received_intake: 'brand-status-badge brand-status-badge--warning',
  retry_failed: 'brand-status-badge brand-status-badge--danger',
  retry_success: 'brand-status-badge brand-status-badge--success',
  submitted: 'brand-status-badge brand-status-badge--neutral'
};

const aiStatusStyles = {
  diagnosed: 'brand-status-badge brand-status-badge--info',
  repair_ready: 'brand-status-badge brand-status-badge--info',
  retry_success: 'brand-status-badge brand-status-badge--success',
  retry_failed: 'brand-status-badge brand-status-badge--danger',
  needs_human_review: 'brand-status-badge brand-status-badge--warning',
  running: 'brand-status-badge brand-status-badge--neutral'
};

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
};

const parseJson = (value) => {
  try {
    if (!value) return null;
    if (typeof value === 'object') return value;
    return JSON.parse(value);
  } catch {
    return null;
  }
};

function AiRepairSection({ intake, recoveryGrant, disabled, onReviewed }) {
  const report = parseJson(intake.ai_repair_report_json);
  const repairError = parseJson(intake.ai_repair_error_json);
  const retryResult = parseJson(intake.ai_repair_retry_result_json);

  if (!intake.ai_repair_status && !report) return null;

  return (
    <div className="brand-ai-panel space-y-3 rounded-lg border p-3">
      <p className="text-sm font-semibold text-indigo-900">AI Repair Status</p>

      <div className="grid gap-2 md:grid-cols-2 text-sm">
        {intake.ai_repair_status && (
          <p><span className="font-medium">Status:</span>{' '}
            <Badge className={aiStatusStyles[intake.ai_repair_status] || 'brand-status-badge brand-status-badge--neutral'}>
              {intake.ai_repair_status}
            </Badge>
          </p>
        )}
        {intake.last_ai_repair_at && (
          <p><span className="font-medium">Last Repair:</span> {formatDate(intake.last_ai_repair_at)}</p>
        )}
        {intake.ai_repair_attempt_count != null && (
          <p><span className="font-medium">Attempt Count:</span> {intake.ai_repair_attempt_count}</p>
        )}
        <p><span className="font-medium">Repair Applied:</span> {intake.ai_repair_applied ? '✓ Yes' : 'No'}</p>
        <p><span className="font-medium">Retry Attempted:</span> {intake.ai_repair_retry_attempted ? '✓ Yes' : 'No'}</p>
      </div>

      {report && (
        <div className="space-y-2 text-sm">
          <p><span className="font-medium">Decision:</span> <code className="bg-white px-1 rounded">{report.decision}</code></p>
          <p><span className="font-medium">Confidence:</span> {typeof report.confidence === 'number' ? `${Math.round(report.confidence * 100)}%` : '—'}</p>
          {report.diagnosis && <p><span className="font-medium">Diagnosis:</span> {report.diagnosis}</p>}
          {Array.isArray(report.repair_summary) && report.repair_summary.length > 0 && (
            <div>
              <p className="font-medium">Repair Summary:</p>
              <ul className="ml-3 list-disc text-slate-700">
                {report.repair_summary.slice(0, 10).map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {Array.isArray(report.changed_paths) && report.changed_paths.length > 0 && (
            <div>
              <p className="font-medium">Changed Paths ({report.changed_paths.length}):</p>
              <ul className="ml-3 list-disc text-slate-700 text-xs">
                {report.changed_paths.slice(0, 15).map((cp, i) => (
                  <li key={i}><code>{cp.path}</code>: {cp.before_type} → {cp.after_type} ({cp.reason})</li>
                ))}
              </ul>
            </div>
          )}
          {Array.isArray(report.warnings) && report.warnings.length > 0 && (
            <div>
              <p className="font-medium text-amber-700">Warnings ({report.warnings.length}):</p>
              <ul className="ml-3 list-disc text-amber-700 text-xs">
                {report.warnings.slice(0, 10).map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {repairError && (
        <div className="text-xs text-red-700 bg-red-50 rounded p-2">
          <span className="font-semibold">Repair Error:</span> {repairError.message || JSON.stringify(repairError)}
        </div>
      )}

      {retryResult && (
        <div className="text-xs rounded p-2 bg-white border">
          <span className="font-semibold">Retry Result:</span> {retryResult.linkedSubmissionId ? `Submission: ${retryResult.linkedSubmissionId}` : (retryResult.message || JSON.stringify(retryResult))}
        </div>
      )}

      <IdentityResolutionPanel
        resolution={report?.identity_resolution}
        recoveryGrant={recoveryGrant}
        currentBusinessName={intake.business_name}
        disabled={disabled}
        onReviewed={onReviewed}
      />

      {intake.ai_repair_report_json && (
        <details className="text-xs">
          <summary className="cursor-pointer text-indigo-700 font-medium">Raw AI report JSON</summary>
          <pre className="mt-2 bg-white rounded p-2 overflow-auto max-h-60 whitespace-pre-wrap break-words text-slate-700">
            {JSON.stringify(report, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function IntakeRow({ intake, expanded, onToggle, onRetry, retrying, onAiAction, aiRunning, recoveryGrant }) {
  const [detailedIntake, setDetailedIntake] = useState(null);
  const [transientReport, setTransientReport] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailVersion, setDetailVersion] = useState(0);
  const persistedIntake = detailedIntake ? { ...intake, ...detailedIntake } : intake;
  const activeIntake = transientReport ? {
    ...persistedIntake,
    ai_repair_status: 'diagnosed',
    ai_repair_report_json: JSON.stringify(transientReport),
    ai_repair_error_json: ''
  } : persistedIntake;
  const diagnostics = parseJson(activeIntake.diagnostics_json);
  const retryError = parseJson(activeIntake.retry_error_json);
  const pdfPayload = getIntakePdfPayload(activeIntake);
  const rawResponses = parseJson(activeIntake.raw_responses_json);

  useEffect(() => {
    if (!expanded) return undefined;
    let active = true;

    const loadDetails = async () => {
      setDetailLoading(true);
      setDetailError('');
      try {
        const data = await getRecoveryRecord({
          recoveryGrant,
          recordType: 'intake',
          recordId: intake.id
        });
        if (active) setDetailedIntake(data.record);
      } catch (error) {
        if (active) setDetailError(error?.message || 'Unable to load this intake.');
      } finally {
        if (active) setDetailLoading(false);
      }
    };

    loadDetails();
    return () => {
      active = false;
    };
  }, [expanded, intake.id, recoveryGrant, detailVersion]);

  return (
    <Card className={`brand-record-card ${expanded ? 'brand-record-card--expanded' : ''}`}>
      <button type="button" onClick={onToggle} className="brand-record-trigger w-full text-left transition-colors">
        <CardContent className="p-4">
          <div className="grid gap-3 md:grid-cols-[1.1fr_1fr_1.1fr_auto_1fr_1fr] items-start">
            <div>
              <p className="font-medium text-slate-900">{intake.business_name || 'Unnamed business'}</p>
              <p className="text-sm text-slate-500 break-all">{intake.business_domain || '—'}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">Session</p>
              <p className="text-xs text-slate-900 break-all">{intake.questionnaire_session_id || '—'}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">Created</p>
              <p className="text-sm text-slate-900">{formatDate(intake.created_at_server || intake.created_date)}</p>
            </div>
            <div className="space-y-1">
              <Badge className={statusStyles[intake.status] || 'brand-status-badge brand-status-badge--neutral'}>{intake.status || '—'}</Badge>
              {intake.ai_repair_status && (
                <Badge className={aiStatusStyles[intake.ai_repair_status] || 'brand-status-badge brand-status-badge--neutral'}>
                  AI: {intake.ai_repair_status}
                </Badge>
              )}
            </div>
            <div>
              <p className="text-sm text-slate-500">Primary Failure</p>
              <p className="text-sm text-slate-900">{intake.primary_failure_kind || '—'}</p>
            </div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-slate-500">Linked Submission</p>
                <p className="text-xs text-slate-900 break-all">{intake.linked_submission_id || '—'}</p>
              </div>
              {expanded ? <ChevronUp className="w-4 h-4 text-slate-500 mt-1" /> : <ChevronDown className="w-4 h-4 text-slate-500 mt-1" />}
            </div>
          </div>
        </CardContent>
      </button>

      {expanded && detailLoading && (
        <div className="brand-expanded-panel flex items-center gap-2 p-4 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading the selected intake details…
        </div>
      )}

      {expanded && !detailLoading && detailError && (
        <div className="brand-expanded-panel p-4 text-sm text-red-700" role="alert">{detailError}</div>
      )}

      {expanded && !detailLoading && !detailError && (
        <div className="brand-expanded-panel p-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-2 text-sm">
            <p><span className="font-medium">Retry Count:</span> {activeIntake.retry_count ?? 0}</p>
            <p><span className="font-medium">Last Retry:</span> {formatDate(activeIntake.last_retry_at)}</p>
            <p><span className="font-medium">Intake Reason:</span> {activeIntake.intake_reason || '—'}</p>
            <p><span className="font-medium">Fallback Failure:</span> {activeIntake.fallback_failure_kind || '—'}</p>
          </div>

          <div className="rounded-lg border bg-white p-3 text-sm space-y-1">
            <p className="font-medium text-slate-900">Diagnostics Summary</p>
            <p className="text-slate-600">Browser online: {String(diagnostics?.browserOnline ?? 'unknown')}</p>
            <p className="text-slate-600">Payload size: {diagnostics?.payloadSizeChars ?? '—'}</p>
            <p className="text-slate-600">Fallback attempted: {String(diagnostics?.fallbackAttempted ?? 'unknown')}</p>
            {retryError?.message ? <p className="text-red-700">Last retry error: {retryError.message}</p> : null}
          </div>

          {/* AI Repair status panel */}
          <AiRepairSection
            intake={activeIntake}
            recoveryGrant={recoveryGrant}
            disabled={retrying || Boolean(aiRunning)}
            onReviewed={() => {
              setTransientReport(null);
              setDetailVersion((version) => version + 1);
            }}
          />

          <AdminQuestionnairePdfSection
            sourceType="intake"
            sourceId={activeIntake.id}
            sessionId={activeIntake.questionnaire_session_id}
            payload={pdfPayload}
            fallbackResponses={rawResponses}
            businessName={activeIntake.business_name}
            domain={activeIntake.business_domain}
            submissionDate={activeIntake.created_at_server || activeIntake.created_at_client || activeIntake.created_date}
            recoveryGrant={recoveryGrant}
            disabled={retrying || Boolean(aiRunning)}
          />

          {/* Action buttons */}
          <div className="space-y-2">
            <p className="brand-action-label text-xs uppercase">Actions</p>
            <div className="flex flex-wrap gap-2">
              {/* Existing retry */}
              <Button
                size="sm"
                onClick={async () => {
                  await onRetry(activeIntake);
                  setDetailVersion((version) => version + 1);
                }}
                disabled={retrying || aiRunning}
                className="brand-button-primary gap-2"
              >
                {retrying ? <><Loader2 className="w-3 h-3 animate-spin" /> Retrying...</> : <><RefreshCw className="w-3 h-3" /> Retry Submission</>}
              </Button>

              {/* Diagnose identity and structure without changing the source record or submitting */}
              <Button
                size="sm"
                variant="outline"
                className="brand-button-secondary gap-2"
                disabled={retrying || aiRunning}
                onClick={async () => {
                  const data = await onAiAction(activeIntake, 'diagnose_only');
                  if (data?.report) setTransientReport(data.report);
                }}
                title="Analyzes structure and missing identity fields without changing the record or creating a submission."
              >
                {aiRunning === 'diagnose_only' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Stethoscope className="w-3 h-3" />}
                Diagnose
              </Button>

              {/* AI Repair Only */}
              <Button
                size="sm"
                variant="outline"
                className="brand-button-secondary gap-2"
                disabled={retrying || aiRunning}
                onClick={async () => {
                  setTransientReport(null);
                  await onAiAction(activeIntake, 'repair_only');
                  setDetailVersion((version) => version + 1);
                }}
              >
                {aiRunning === 'repair_only' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wrench className="w-3 h-3" />}
                Repair Only
              </Button>

              {/* AI Repair + Retry — clearly labeled as creates submission */}
              <Button
                size="sm"
                className="brand-button-dark gap-2"
                disabled={retrying || aiRunning}
                onClick={async () => {
                  setTransientReport(null);
                  await onAiAction(activeIntake, 'repair_and_retry');
                  setDetailVersion((version) => version + 1);
                }}
                title="This will attempt to create a final ProFormSubmission if repair succeeds"
              >
                {aiRunning === 'repair_and_retry' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wrench className="w-3 h-3" />}
                Repair + Retry ⚡
              </Button>
            </div>
            <p className="text-xs text-slate-400">⚡ Repair + Retry will create a final ProFormSubmission only if repair and validation succeed.</p>
          </div>

          <details className="rounded-lg border bg-white p-3 text-xs">
            <summary className="cursor-pointer font-medium text-slate-800">Admin raw JSON</summary>
            <pre className="mt-3 overflow-auto max-h-80 whitespace-pre-wrap break-words text-slate-700">{JSON.stringify({
              id: activeIntake.id,
              questionnaire_session_id: activeIntake.questionnaire_session_id,
              status: activeIntake.status,
              linked_submission_id: activeIntake.linked_submission_id,
              diagnostics,
              retry_error: retryError
            }, null, 2)}</pre>
          </details>
        </div>
      )}
    </Card>
  );
}

export default function QuestionnaireIntakeRecovery({ recoveryGrant = '' }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('received_intake');
  const [archiveState, setArchiveState] = useState('active');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [hasAnyRecords, setHasAnyRecords] = useState(false);
  const [expandedId, setExpandedId] = useState('');
  const [retryingId, setRetryingId] = useState('');
  // aiRunningId: { id: string, mode: string } | null
  const [aiRunning, setAiRunning] = useState(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => window.clearTimeout(timeoutId);
  }, [search]);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listRecoveryRecords({
        recoveryGrant,
        recordType: 'intake',
        page,
        pageSize: RECOVERY_PAGE_SIZE,
        status: statusFilter,
        archiveState,
        search: debouncedSearch
      });
      setRecords(Array.isArray(data.records) ? data.records : []);
      setHasMore(Boolean(data.hasMore));
      setHasAnyRecords(Boolean(data.hasAnyRecords));
    } finally {
      setLoading(false);
    }
  }, [archiveState, debouncedSearch, page, recoveryGrant, statusFilter]);

  useEffect(() => { loadRecords(); }, [loadRecords]);

  const handleRetry = async (intake) => {
    try {
      setRetryingId(intake.id);
      const response = await base44.functions.invoke('retryProQuestionnaireIntakeSubmission', {
        intakeId: intake.id,
        questionnaireSessionId: intake.questionnaire_session_id,
        forceRetry: false,
        ...(recoveryGrant ? { recoveryGrant } : {})
      });
      const data = response?.data;
      if (data?.success) {
        toast.success(data?.alreadySubmitted ? 'Already linked to a submission' : 'Submission retry completed');
      } else {
        toast.error(data?.error?.message || 'Retry failed');
      }
      await loadRecords();
    } catch (error) {
      toast.error(error?.response?.data?.error?.message || error?.response?.data?.error || error?.message || 'Retry failed');
    } finally {
      setRetryingId('');
    }
  };

  const handleAiAction = async (intake, mode) => {
    setAiRunning({ id: intake.id, mode });
    // Keep row expanded while running
    setExpandedId(intake.id);
    try {
      const modeLabels = { diagnose_only: 'Diagnose', repair_only: 'Repair Only', repair_and_retry: 'Repair + Retry' };
      const response = await base44.functions.invoke('repairProQuestionnaireIntakeSubmission', {
        intakeId: intake.id,
        questionnaireSessionId: intake.questionnaire_session_id,
        mode,
        autoRetry: mode === 'repair_and_retry',
        forceRetry: false,
        ...(recoveryGrant ? { recoveryGrant } : {})
      });
      const data = response?.data;
      if (data?.success) {
        if (data?.linkedSubmissionId) {
          toast.success(`Repair + Retry succeeded — Submission: ${data.linkedSubmissionId}`);
        } else {
          toast.success(`${modeLabels[mode]} completed`);
        }
      } else {
        toast.error(data?.error?.message || data?.errors?.[0] || `${modeLabels[mode]} failed`);
      }
      await loadRecords();
      return data;
    } catch (err) {
      toast.error(err?.response?.data?.error?.message || err?.response?.data?.error || err?.message || 'AI action failed');
      return null;
    } finally {
      setAiRunning(null);
    }
  };

  // Keep the fallback recovery tools available when intake records exist,
  // without showing an empty administrative section during normal operation.
  if ((loading && records.length === 0) || !hasAnyRecords) return null;

  return (
    <div className="space-y-4">
      <Card className="brand-panel">
        <CardHeader className="brand-section-header">
          <p className="draft-recovery-brand__section-kicker">Failed submission intake</p>
          <CardTitle className="brand-heading brand-section-title">Questionnaire Intake Recovery</CardTitle>
          <p className="draft-recovery-brand__section-copy">Review captured fallbacks and retry submissions that did not complete normally.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[220px_220px_1fr]">
            <Select value={statusFilter} onValueChange={(value) => {
              setStatusFilter(value);
              setPage(1);
              setExpandedId('');
            }}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="received_intake">received_intake</SelectItem>
                <SelectItem value="retry_failed">retry_failed</SelectItem>
                <SelectItem value="retry_success">retry_success</SelectItem>
              </SelectContent>
            </Select>

            <Select value={archiveState} onValueChange={(value) => {
              setArchiveState(value);
              setPage(1);
              setExpandedId('');
            }}>
              <SelectTrigger>
                <SelectValue placeholder="Record set" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active Records</SelectItem>
                <SelectItem value="archived">Archived Records</SelectItem>
                <SelectItem value="all">All Records</SelectItem>
              </SelectContent>
            </Select>

            <input
              type="search"
              className="h-10 rounded-md border bg-white px-3 text-sm"
              placeholder="Search intake business, domain, email, or session ID"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
                setExpandedId('');
              }}
            />
          </div>

          {records.length === 0 ? (
            <div className="text-sm text-slate-600">No intake records found for this status.</div>
          ) : (
            <div className="space-y-4">
              {records.map((intake) => (
                <IntakeRow
                  key={intake.id}
                  intake={intake}
                  expanded={expandedId === intake.id}
                  onToggle={() => setExpandedId(expandedId === intake.id ? '' : intake.id)}
                  onRetry={handleRetry}
                  retrying={retryingId === intake.id}
                  onAiAction={handleAiAction}
                  aiRunning={aiRunning?.id === intake.id ? aiRunning.mode : null}
                  recoveryGrant={recoveryGrant}
                />
              ))}
              <div className="flex items-center justify-between gap-3 pt-1" aria-label="Intake pagination">
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
                <span className="text-sm text-slate-600">Page {page}</span>
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
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
