import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Save, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

/**
 * DraftEditPanel
 * Lets admins edit key draft fields (business_name, domain, user_email)
 * and the raw mapped_payload_json (the final-style payload that gets submitted).
 *
 * Props:
 *   draft        — the ProFormDraft record
 *   computedPayload — the live-computed payload (used as initial JSON value when mapped_payload_json is absent)
 *   onSaved(updatedDraft) — called after a successful save with the updated draft
 *   onCancel()   — called when the user cancels
 */
export default function DraftEditPanel({ draft, computedPayload, onSaved, onCancel }) {
  const [businessName, setBusinessName] = useState(draft.business_name || '');
  const [domain, setDomain] = useState(draft.domain || '');
  const [userEmail, setUserEmail] = useState(draft.user_email || '');

  // Initialise JSON editor: prefer stored mapped_payload_json, fallback to computed
  const initialJson = (() => {
    if (draft.mapped_payload_json) {
      try {
        const parsed = typeof draft.mapped_payload_json === 'string'
          ? JSON.parse(draft.mapped_payload_json)
          : draft.mapped_payload_json;
        return JSON.stringify(parsed, null, 2);
      } catch { /* fall through */ }
    }
    return JSON.stringify(computedPayload ?? {}, null, 2);
  })();

  const [jsonText, setJsonText] = useState(initialJson);
  const [jsonError, setJsonError] = useState('');
  const [saving, setSaving] = useState(false);

  // Validate JSON as user types
  useEffect(() => {
    if (!jsonText.trim()) {
      setJsonError('');
      return;
    }
    try {
      JSON.parse(jsonText);
      setJsonError('');
    } catch (e) {
      setJsonError(e.message);
    }
  }, [jsonText]);

  const handleSave = async () => {
    // Validate JSON before saving
    let parsedPayload = null;
    try {
      parsedPayload = JSON.parse(jsonText);
    } catch (e) {
      toast.error(`Invalid JSON — fix errors before saving: ${e.message}`);
      return;
    }

    setSaving(true);
    try {
      const updates = {
        business_name: businessName.trim(),
        domain: domain.trim(),
        user_email: userEmail.trim(),
        mapped_payload_json: JSON.stringify(parsedPayload),
      };

      const updated = await base44.entities.ProFormDraft.update(draft.id, updates);
      toast.success('Draft saved successfully');
      onSaved?.(updated);
    } catch (err) {
      toast.error(`Save failed: ${err?.message || 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 rounded-lg border border-blue-200 bg-blue-50/40 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-blue-900">Edit Draft</p>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} className="h-7 px-2">
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Key detail fields */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs font-medium text-slate-700">Business Name</Label>
          <Input
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="Business name"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-medium text-slate-700">Business Domain</Label>
          <Input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="e.g. acme.com"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-medium text-slate-700">User Email</Label>
          <Input
            value={userEmail}
            onChange={(e) => setUserEmail(e.target.value)}
            placeholder="user@example.com"
            className="h-8 text-sm"
          />
        </div>
      </div>

      {/* JSON payload editor */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium text-slate-700">
            Mapped Payload JSON
            <span className="ml-1 font-normal text-slate-500">(used by Retry Submission)</span>
          </Label>
          {jsonError ? (
            <span className="flex items-center gap-1 text-xs text-red-600">
              <AlertTriangle className="w-3 h-3" /> {jsonError}
            </span>
          ) : jsonText.trim() ? (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <CheckCircle2 className="w-3 h-3" /> Valid JSON
            </span>
          ) : null}
        </div>
        <textarea
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          spellCheck={false}
          className={`w-full min-h-[28rem] rounded-md border bg-slate-950 text-slate-100 p-3 text-xs font-mono resize-y focus:outline-none focus:ring-2 ${
            jsonError ? 'border-red-400 focus:ring-red-400' : 'border-slate-700 focus:ring-blue-500'
          }`}
        />
        <p className="text-xs text-slate-500">
          This payload is persisted to <code>mapped_payload_json</code> on the draft record. When present, Retry Submission will use this payload instead of re-computing from raw responses.
        </p>
      </div>

      {/* Save / Cancel */}
      <div className="flex items-center gap-2 justify-end pt-1">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          className="gap-2 bg-blue-700 hover:bg-blue-800 text-white"
          onClick={handleSave}
          disabled={saving || !!jsonError}
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}