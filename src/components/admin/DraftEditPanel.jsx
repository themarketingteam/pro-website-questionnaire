import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useProDraftAdminRecoveryShell } from '@/components/admin/ProDraftAdminRecoveryShell';

let fallbackKeySequence = 0;
const idempotencyKey = () => `admin-edit-${Date.now()}-${globalThis.crypto?.randomUUID?.() || `local-${fallbackKeySequence += 1}`}`;

export default function DraftEditPanel({ draft, computedPayload, onSaved, onCancel }) {
  const { api, setEditDirty } = useProDraftAdminRecoveryShell();
  const initialJson = useMemo(() => {
    const value = draft.mapped_payload_json || JSON.stringify(computedPayload ?? {});
    try { return JSON.stringify(typeof value === 'string' ? JSON.parse(value) : value, null, 2); }
    catch { return String(value || ''); }
  }, [draft.mapped_payload_json, computedPayload]);
  const [values, setValues] = useState({ business_name: draft.business_name || '', domain: draft.domain || '', user_email: draft.user_email || '', recovery_email: draft.recovery_email || '', retention_hold: draft.retention_hold === true, retention_hold_reason: draft.retention_hold_reason || '', mapped_payload_json: initialJson, reason: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState(null);
  const currentServerDraft = conflict?.latest || draft;
  const submitted = currentServerDraft.status === 'submitted';

  useEffect(() => () => setEditDirty(false), [setEditDirty]);
  const change = (name, value) => { setValues((current) => ({ ...current, [name]: value })); setEditDirty(true); setSaved(false); };

  const validate = () => {
    const next = {};
    if (!values.reason.trim()) next.reason = 'An edit reason is required.';
    try { JSON.parse(values.mapped_payload_json); } catch { next.mapped_payload_json = 'Mapped payload must be valid JSON.'; }
    if (values.retention_hold && !values.retention_hold_reason.trim()) next.retention_hold_reason = 'Explain why retention is held.';
    if (submitted && [values.business_name !== (draft.business_name || ''), values.domain !== (draft.domain || ''), values.user_email !== (draft.user_email || ''), values.recovery_email !== (draft.recovery_email || ''), values.mapped_payload_json !== initialJson].some(Boolean)) next.submitted = 'Submitted draft content is read-only.';
    setErrors(next); return Object.keys(next).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true); setConflict(null);
    const changes = { retention_hold: values.retention_hold, retention_hold_reason: values.retention_hold_reason.trim() };
    if (!submitted) {
      const candidates = {
        business_name: values.business_name.trim(), domain: values.domain.trim(), user_email: values.user_email.trim(),
        recovery_email: values.recovery_email.trim(), mapped_payload_json: JSON.stringify(JSON.parse(values.mapped_payload_json)),
      };
      for (const [name, value] of Object.entries(candidates)) {
        const original = name === 'mapped_payload_json'
          ? JSON.stringify(JSON.parse(currentServerDraft.mapped_payload_json || initialJson))
          : (currentServerDraft[name] || '');
        if (value !== original && !(name === 'recovery_email' && !value)) changes[name] = value;
      }
    }
    try {
      const result = await api.updateDraft({ draftId: draft.id, expectedServerRevision: currentServerDraft.server_revision, changes, reason: values.reason.trim(), idempotencyKey: idempotencyKey() });
      setConflict(null); setSaved(true); setEditDirty(false); onSaved?.(result.draft);
    } catch (caught) {
      const status = caught?.response?.status || caught?.response?.data?.errorCode;
      if (status === 409 || status === 'ADMIN_API_CONFLICT') {
        try { const latest = await api.getDraft({ draftId: draft.id, includeCompatibilityJson: true, includeMigrationMetadata: true }); setConflict({ latest: latest.draft, unsaved: { ...values } }); }
        catch { setConflict({ latest: null, unsaved: { ...values } }); }
      } else setErrors({ request: caught?.message || 'Draft could not be saved.' });
    } finally { setSaving(false); }
  };

  return (
    <section className="space-y-5 rounded-lg border border-blue-200 bg-blue-50/40 p-4" aria-label="Edit draft">
      <div className="flex items-center justify-between"><p className="font-semibold text-blue-900">Edit Draft</p><Button type="button" variant="ghost" size="sm" onClick={onCancel}><X className="h-4 w-4" /><span className="sr-only">Close editor</span></Button></div>
      {errors.submitted ? <p role="alert" className="text-sm text-red-700">{errors.submitted}</p> : null}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {[['business_name','Business Name'],['domain','Business Domain'],['user_email','User Email'],['recovery_email','Recovery Email']].map(([name,label]) => <div className="space-y-1" key={name}><Label htmlFor={`edit-${name}`}>{label}</Label><Input id={`edit-${name}`} value={values[name]} disabled={submitted} onChange={(e) => change(name,e.target.value)} /></div>)}
      </div>
      <div className="space-y-1"><Label htmlFor="edit-payload">Mapped Payload JSON</Label><textarea id="edit-payload" value={values.mapped_payload_json} disabled={submitted} onChange={(e) => change('mapped_payload_json',e.target.value)} className="min-h-72 w-full rounded border bg-slate-950 p-3 font-mono text-xs text-slate-100" />{errors.mapped_payload_json ? <p role="alert" className="text-xs text-red-700">{errors.mapped_payload_json}</p> : null}</div>
      <div className="grid gap-3 md:grid-cols-[auto_1fr]"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={values.retention_hold} onChange={(e) => change('retention_hold',e.target.checked)} />Retention hold</label><div><Label htmlFor="retention-reason">Retention hold reason</Label><Input id="retention-reason" value={values.retention_hold_reason} onChange={(e) => change('retention_hold_reason',e.target.value)} />{errors.retention_hold_reason ? <p role="alert" className="text-xs text-red-700">{errors.retention_hold_reason}</p> : null}</div></div>
      <div><Label htmlFor="edit-reason">Edit reason</Label><Input id="edit-reason" value={values.reason} onChange={(e) => change('reason',e.target.value)} required />{errors.reason ? <p role="alert" className="text-xs text-red-700">{errors.reason}</p> : null}</div>
      {draft.source_app_id || draft.source_record_id ? <p className="text-xs text-slate-500">Migration source (read-only): {draft.source_app_id || '—'} / {draft.source_record_id || '—'}</p> : null}
      {conflict ? <div role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mr-2 inline h-4 w-4" />The draft changed on the server. Latest revision: {conflict.latest?.server_revision ?? 'unavailable'}. Your unsaved values remain in this form for comparison.</div> : null}
      {errors.request ? <p role="alert" className="text-sm text-red-700">{errors.request}</p> : null}
      {saved ? <p role="status" className="flex items-center gap-2 text-sm text-green-700"><CheckCircle2 className="h-4 w-4" />Saved and audit event recorded.</p> : null}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button><Button type="button" onClick={save} disabled={saving}><Save className="h-4 w-4" />{saving ? 'Saving…' : 'Save Changes'}</Button></div>
    </section>
  );
}
