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
import { Copy, ChevronDown, ChevronUp, AlertTriangle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import QuestionnaireIntakeRecovery from '@/components/admin/QuestionnaireIntakeRecovery';
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

function DraftRow({ draft, expanded, onToggle, hasDuplicateSession, onRetrySuccess }) {
  const [retrying, setRetrying] = useState(false);
  const parsedResponses = safeJsonParse(draft.responses_json, {});
  const parsedValidation = safeJsonParse(draft.validation_status_json, {});

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
      const result = await base44.functions.invoke('retryProQuestionnaireIntakeSubmission', {
        session_id: draft.session_id
      });
      if (result.data?.success) {
        toast.success(`Submission succeeded for ${draft.business_name || draft.session_id}`);
        onRetrySuccess?.();
      } else {
        toast.error(`Retry failed: ${result.data?.error || 'Unknown error'}`);
      }
    } catch (err) {
      toast.error(`Retry failed: ${err?.message || 'Unknown error'}`);
    } finally {
      setRetrying(false);
    }
  };

  const copySubmissionPayload = async () => {
    await navigator.clipboard.writeText(JSON.stringify(finalSubmissionPayload, null, 2));
    toast.success('Submission payload copied');
  };

  const copyRawResponses = async () => {
    await navigator.clipboard.writeText(JSON.stringify(parsedResponses, null, 2));
    toast.success('Raw responses copied');
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
              <p className="font-medium text-slate-900">{draft.business_name || 'Unnamed business'}</p>
              <p className="text-sm text-slate-500 break-all">{draft.domain || '—'}</p>
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
              <p><span className="font-medium">User Name:</span> {draft.user_name || '—'}</p>
              <p><span className="font-medium">User ID:</span> {draft.user_id || '—'}</p>
              <p><span className="font-medium">Submit Attempted:</span> {formatDate(draft.submit_attempted_at)}</p>
              <p><span className="font-medium">Submitted At:</span> {formatDate(draft.submitted_at)}</p>
              <p><span className="font-medium">Final Submission ID:</span> {draft.final_submission_id || '—'}</p>
            </div>
            <div className="space-y-2 text-sm">
              <p><span className="font-medium">Current Question:</span> {draft.current_question_id || '—'}</p>
              <p><span className="font-medium">Last Changed At:</span> {formatDate(draft.last_changed_at)}</p>
              <p><span className="font-medium">Save Error:</span> {draft.save_error || '—'}</p>
              <p><span className="font-medium">Submit Error:</span> {draft.submit_error || '—'}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={handleRetry}
              disabled={retrying}
              className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
            >
              <RefreshCw className={`w-4 h-4 ${retrying ? 'animate-spin' : ''}`} />
              {retrying ? 'Retrying...' : 'Retry Submission'}
            </Button>
            <Button type="button" variant="outline" onClick={copySubmissionPayload} className="gap-2">
              <Copy className="w-4 h-4" /> Copy Submission Payload
            </Button>
            <Button type="button" variant="outline" onClick={copyRawResponses} className="gap-2">
              <Copy className="w-4 h-4" /> Copy Raw Responses
            </Button>
          </div>

          {repairWarnings.length > 0 && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
              <span className="font-semibold">Repair warnings:</span> {repairWarnings.join(', ')}
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-700">
              Final Submission Payload{' '}
              <span className="font-normal text-slate-500">(metadata + userdata — exactly as sent to the submission endpoint)</span>
            </p>
            <pre className="bg-slate-950 text-slate-100 rounded-lg p-4 text-xs overflow-auto max-h-[40rem] whitespace-pre-wrap break-words">
              {JSON.stringify(finalSubmissionPayload, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function ProFormDraftRecovery() {
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

        <QuestionnaireIntakeRecovery />

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
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}