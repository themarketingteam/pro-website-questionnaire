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
import { transformResponsesToPayload } from '@/components/pro-form/submissionPayload';
import { repairProSubmissionPayload } from '@/lib/proPayloadRepair';
import { SERVICE_OPTIONS_GROUPED } from '@/components/pro-form/questionData';

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
  draft: 'bg-slate-100 text-slate-700',
  submit_attempted: 'bg-amber-100 text-amber-800',
  submit_failed: 'bg-red-100 text-red-700',
  submitted: 'bg-green-100 text-green-700'
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
  } catch { return null; }
};

function DraftAiRepairSection({ draft }) {
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
    <div className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 text-sm">
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
    </div>
  );
}

function DraftRow({ draft, expanded, onToggle, hasDuplicateSession, onRetrySuccess, recoveryGrant }) {
  const [retrying, setRetrying] = useState(false);
  // aiRunning: null | 'diagnose_only' | 'repair_only' | 'repair_and_retry'
  const [aiRunning, setAiRunning] = useState(null);
  const [localDraft, setLocalDraft] = useState(draft);
  const [editing, setEditing] = useState(false);

  const isWorking = retrying || !!aiRunning;

  // Keep localDraft in sync when parent reloads (but not while editing to avoid clobbering)
  React.useEffect(() => { if (!editing) setLocalDraft(draft); }, [draft, editing]);

  const parsedResponses = safeJsonParse(draft.responses_json, {});

  // Build the final submission payload exactly as it would be sent to ProFormSubmission.create()
  // Step 1: transform raw responses → raw payload
  // Step 2: run through repairProSubmissionPayload (same as the real submit path)
  const { finalSubmissionPayload, repairWarnings } = useMemo(() => {
    try {
      const businessName = draft.business_name || '';
      const domain = draft.domain || '';
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
  }, [parsedResponses, draft.business_name, draft.domain]);

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
      diagnose_only: 'AI Diagnose',
      repair_only: 'AI Repair Only',
      repair_and_retry: 'AI Repair + Retry'
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
          toast.success(`AI Repair + Retry succeeded — Submission: ${data.linkedSubmissionId}`);
        } else {
          toast.success(`${modeLabels[mode]} completed`);
        }
        onRetrySuccess?.();
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
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left hover:bg-slate-50 transition-colors"
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

      {expanded && (
        <div className="border-t bg-slate-50/60 p-4 space-y-4">
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
            </div>
          </div>

          {/* Edit panel */}
          {editing ? (
            <DraftEditPanel
              draft={localDraft}
              computedPayload={finalSubmissionPayload}
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

          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</p>
            <div className="flex flex-wrap gap-2">
              {/* Edit Draft — always available */}
              {!editing && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2 border-slate-300 text-slate-700 hover:bg-slate-100"
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
                className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
              >
                {retrying ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                {retrying ? 'Retrying...' : 'Retry Submission'}
              </Button>

              {/* AI Diagnose — runs diagnostics only, no changes, no submission */}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-2 border-blue-300 text-blue-700 hover:bg-blue-50"
                disabled={isWorking}
                onClick={(e) => handleAiAction(e, 'diagnose_only')}
                title="Runs structure validation only. Does not change the draft or create a submission."
              >
                {aiRunning === 'diagnose_only' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Stethoscope className="w-3 h-3" />}
                {aiRunning === 'diagnose_only' ? 'Diagnosing...' : 'AI Diagnose'}
              </Button>

              {/* AI Repair Only — repairs and saves to draft, does NOT create submission */}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-2 border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                disabled={isWorking}
                onClick={(e) => handleAiAction(e, 'repair_only')}
                title="Diagnoses and repairs the draft payload. Does NOT create a final submission."
              >
                {aiRunning === 'repair_only' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wrench className="w-3 h-3" />}
                {aiRunning === 'repair_only' ? 'Repairing...' : 'AI Repair Only'}
              </Button>

              {/* AI Repair + Retry — diagnose, repair, then create submission */}
              <Button
                type="button"
                size="sm"
                className="gap-2 bg-indigo-700 hover:bg-indigo-800 text-white"
                disabled={isWorking}
                onClick={(e) => handleAiAction(e, 'repair_and_retry')}
                title="Diagnoses, repairs, then attempts to create a final ProFormSubmission."
              >
                {aiRunning === 'repair_and_retry' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wrench className="w-3 h-3" />}
                {aiRunning === 'repair_and_retry' ? 'Running...' : 'AI Repair + Retry ⚡'}
              </Button>
            </div>

            <p className="text-xs text-slate-400">⚡ AI Repair + Retry will attempt to create a final ProFormSubmission if repair succeeds.</p>

            {/* Copy utilities */}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="button" variant="outline" size="sm" onClick={copySubmissionPayload} className="gap-2" disabled={isWorking}>
                <Copy className="w-3 h-3" /> Copy Endpoint Payload
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={copyRawResponses} className="gap-2" disabled={isWorking}>
                <Copy className="w-3 h-3" /> Copy Raw Draft Data
              </Button>
              {localDraft.ai_repaired_payload_json && (
                <Button type="button" variant="outline" size="sm" onClick={copyAiRepairedPayload} className="gap-2 border-indigo-200 text-indigo-700">
                  <Copy className="w-3 h-3" /> Copy AI Repaired Payload
                </Button>
              )}
              {localDraft.ai_repair_report_json && (
                <Button type="button" variant="outline" size="sm" onClick={copyAiReport} className="gap-2 border-indigo-200 text-indigo-700">
                  <Copy className="w-3 h-3" /> Copy AI Report
                </Button>
              )}
            </div>
          </div>

          {repairWarnings.length > 0 && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
              <span className="font-semibold">Deterministic repair warnings:</span> {repairWarnings.join(', ')}
            </div>
          )}

          {/* AI Repair status panel */}
          <DraftAiRepairSection draft={localDraft} />

          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-slate-700">Final Submission Payload</p>
              {isMappedPayloadOverride ? (
                <Badge className="bg-blue-100 text-blue-800 text-xs">Manually edited — mapped_payload_json</Badge>
              ) : (
                <Badge className="bg-slate-100 text-slate-600 text-xs">Computed from responses_json</Badge>
              )}
              <span className="text-xs text-slate-500">(used by Retry Submission)</span>
            </div>
            <pre className="bg-slate-950 text-slate-100 rounded-lg p-4 text-xs overflow-auto max-h-[40rem] whitespace-pre-wrap break-words">
              {JSON.stringify(activeFinalPayload, null, 2)}
            </pre>
          </div>
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
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const reloadDrafts = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    let mounted = true;

    const loadDrafts = async () => {
      setLoading(true);
      setError('');

      try {
        const data = await base44.entities.ProFormDraft.list();

        if (!mounted) return;

        const sorted = [...(Array.isArray(data) ? data : [])].sort((a, b) => {
          const aTime = new Date(a.last_saved_at || a.created_date || 0).getTime();
          const bTime = new Date(b.last_saved_at || b.created_date || 0).getTime();
          return bTime - aTime;
        });

        setDrafts(sorted);
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
  }, [refreshKey]);

  const duplicateSessionIds = useMemo(() => {
    const sessionCounts = drafts.reduce((acc, draft) => {
      if (!draft.session_id) return acc;
      acc[draft.session_id] = (acc[draft.session_id] || 0) + 1;
      return acc;
    }, {});

    const duplicates = new Set();
    Object.entries(sessionCounts).forEach(([sessionId, count]) => {
      if (count > 1) duplicates.add(sessionId);
    });

    return duplicates;
  }, [drafts]);

  const filteredDrafts = useMemo(() => {
    const query = search.trim().toLowerCase();

    return drafts.filter((draft) => {
      const matchesStatus = statusFilter === 'all' || draft.status === statusFilter;
      const haystack = [
        draft.business_name,
        draft.domain,
        draft.user_email,
        draft.session_id
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      const matchesSearch = !query || haystack.includes(query);
      return matchesStatus && matchesSearch;
    });
  }, [drafts, search, statusFilter]);

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Pro Form Draft Recovery</h1>
          <p className="text-slate-600 mt-1">Review recent questionnaire drafts and copy recovery data for support.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-[220px_1fr]">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="submit_attempted">Submit Attempted</SelectItem>
                <SelectItem value="submit_failed">Submit Failed</SelectItem>
                <SelectItem value="submitted">Submitted</SelectItem>
              </SelectContent>
            </Select>

            <Input
              placeholder="Search by business name, domain, user email, or session ID"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </CardContent>
        </Card>

        <QuestionnaireIntakeRecovery recoveryGrant={recoveryGrant} />

        <div className="space-y-4">
          {error && (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="p-6 text-red-700">{error}</CardContent>
            </Card>
          )}

          {loading ? (
            <Card>
              <CardContent className="p-6 text-slate-600">Loading drafts...</CardContent>
            </Card>
          ) : filteredDrafts.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-slate-600">No matching drafts found.</CardContent>
            </Card>
          ) : (
            filteredDrafts.map((draft) => (
              <DraftRow
                key={draft.id}
                draft={draft}
                expanded={expandedId === draft.id}
                onToggle={() => setExpandedId(expandedId === draft.id ? '' : draft.id)}
                hasDuplicateSession={duplicateSessionIds.has(draft.session_id)}
                onRetrySuccess={reloadDrafts}
                recoveryGrant={recoveryGrant}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
