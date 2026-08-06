import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';

const params = new URLSearchParams(location.search);
const key = `e2e-draft-mutations:${params.get('draft') || 'default'}`;
const empty = {
  responses: {}, validation: {}, touched: {}, expanded: {}, ui: {}, status: 'server_saved',
};
const load = () => {
  try { return JSON.parse(localStorage.getItem(key)) || empty; } catch { return empty; }
};

function Harness() {
  const [draft, setDraft] = useState(load);
  const [offline, setOffline] = useState(false);
  const commit = (recipe) => setDraft((current) => {
    const next = recipe(structuredClone(current));
    next.status = offline ? 'offline_local_only' : 'server_saved';
    localStorage.setItem(key, JSON.stringify(next));
    return next;
  });
  const setUi = (scope, data) => commit((next) => {
    next.ui[scope] = data;
    return next;
  });
  const numeric = draft.ui['question:17:numeric-range'] || {};
  const manual = draft.ui['question:5:manual-geographic'] || {};
  const person = draft.ui['question:20:person-editor'] || {};
  const confirmation = draft.ui.confirmationDraft || {};

  return (
    <main>
      <p data-testid="sync-status">{draft.status}</p>
      <button type="button" data-testid="offline" onClick={() => setOffline(true)}>Offline</button>
      <button type="button" data-testid="online" onClick={() => {
        setOffline(false);
        setDraft((current) => {
          const next = { ...current, status: 'server_saved' };
          localStorage.setItem(key, JSON.stringify(next));
          return next;
        });
      }}>Online</button>

      <input data-testid="numeric-small" value={numeric.smallestInput || ''} onChange={(e) => (
        setUi('question:17:numeric-range', { ...numeric, smallestInput: e.target.value, editing: true })
      )} />
      <input data-testid="numeric-large" value={numeric.largestInput || ''} onChange={(e) => (
        setUi('question:17:numeric-range', { ...numeric, largestInput: e.target.value, editing: true })
      )} />

      <input data-testid="manual-location" value={manual.manualInput || ''} onChange={(e) => (
        setUi('question:5:manual-geographic', { manualInput: e.target.value, showManualEntry: true })
      )} />
      <button type="button" data-testid="add-location" onClick={() => commit((next) => {
        const locations = next.responses['5'] || [];
        next.responses['5'] = [...locations, { name: manual.manualInput, label: manual.manualInput }];
        next.responses['5_primary'] = next.responses['5_primary'] || 0;
        delete next.ui['question:5:manual-geographic'];
        return next;
      })}>Add location</button>
      <button type="button" data-testid="update-location" onClick={() => commit((next) => {
        next.responses['5'][0] = { ...next.responses['5'][0], isGreaterArea: true };
        return next;
      })}>Update location</button>
      <button type="button" data-testid="set-primary" onClick={() => commit((next) => {
        next.responses['5_primary'] = Math.max(0, (next.responses['5'] || []).length - 1);
        return next;
      })}>Set primary</button>
      <button type="button" data-testid="remove-location" onClick={() => commit((next) => {
        next.responses['5'] = (next.responses['5'] || []).slice(1);
        next.responses['5_primary'] = 0;
        return next;
      })}>Remove location</button>

      <input data-testid="person-name" value={person.tempPerson?.name || ''} onChange={(e) => (
        setUi('question:20:person-editor', {
          tempPerson: { ...(person.tempPerson || {}), name: e.target.value }, editorStep: 'person_details',
        })
      )} />
      <button type="button" data-testid="save-person" onClick={() => commit((next) => {
        next.responses['20'] = { url: 'https://files.invalid/team.png', tags: [{ person: person.tempPerson }] };
        delete next.ui['question:20:person-editor'];
        return next;
      })}>Save person</button>

      <input data-testid="business-name" value={confirmation.businessName || ''} onChange={(e) => (
        setUi('confirmationDraft', { ...confirmation, businessName: e.target.value })
      )} />
      <input data-testid="domain" value={confirmation.domain || ''} onChange={(e) => (
        setUi('confirmationDraft', { ...confirmation, domain: e.target.value })
      )} />

      <input data-testid="file" type="file" onChange={(e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUi('question:1:file-upload', {
          originalFileName: file.name, mimeType: file.type, sizeBytes: file.size,
          uploadStatus: 'uploaded', uploadedUrl: 'https://files.invalid/upload',
          base44FileId: null, errorCode: null,
        });
      }} />

      <button type="button" data-testid="seed-child" onClick={() => commit((next) => {
        next.responses['12'] = 'yes'; next.responses['12.1'] = [{ name: 'Draft cert' }];
        next.ui['question:12.1:certification-editor'] = { editingIndex: 0 };
        return next;
      })}>Seed child</button>
      <button type="button" data-testid="hide-child" onClick={() => commit((next) => {
        next.responses['12'] = 'no'; delete next.responses['12.1'];
        delete next.ui['question:12.1:certification-editor'];
        return next;
      })}>Hide child</button>
      <button type="button" data-testid="metadata-only" onClick={() => commit((next) => {
        next.validation['6'] = 'complete'; next.touched['6'] = true; next.expanded['6'] = true;
        return next;
      })}>Metadata only</button>
      <button type="button" data-testid="reset-q5" onClick={() => commit((next) => {
        delete next.responses['5']; delete next.responses['5_primary'];
        for (const scope of Object.keys(next.ui)) if (scope.startsWith('question:5:')) delete next.ui[scope];
        return next;
      })}>Reset Q5</button>

      <pre data-testid="draft-json">{JSON.stringify(draft)}</pre>
      <p data-testid="raw-file-present">{/["']?(file|blob|path)["']?\s*:/iu.test(JSON.stringify(draft)) ? 'yes' : 'no'}</p>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<Harness />);
