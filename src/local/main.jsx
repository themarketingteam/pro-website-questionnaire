import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { Toaster } from 'sonner';
import { Download, FileJson, FlaskConical, History, RotateCcw, ShieldCheck, X } from 'lucide-react';
import ReduxProvider from '@/components/ReduxProvider';
import ProQuestionnaire from '@/pages/ProQuestionnaire';
import { store, persistor } from '@/components/store/store';
import { resetForm } from '@/components/store/formSlice';
import { transformResponsesToPayload, validateSubmissionPayload } from '@/components/pro-form/submissionPayload';
import { SERVICE_OPTIONS_GROUPED } from '@/components/pro-form/questionData';
import { getStoredResumeCredential, persistResumeCredential } from '@/lib/sessionId';
import { installLocalNetworkGuard } from './networkGuard';
import '@/index.css';
import './preview.css';
installLocalNetworkGuard();
const post = async (path, body) => {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error); return data;
};
const download = (value, name) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
function PreviewTools() {
  const { responses, credentials } = useSelector((state) => state.form);
  const [panel, setPanel] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const [captures, setCaptures] = useState([]);
  let payload;
  let payloadError = '';
  try { payload = transformResponsesToPayload(responses, credentials.businessName || 'Local test', credentials.domain || 'localhost', SERVICE_OPTIONS_GROUPED); }
  catch (issue) { payloadError = issue.message; }
  const adoptCredential = async (credential) => {
    await persistor.purge(); store.dispatch(resetForm()); persistResumeCredential(credential);
    window.location.assign('/#' + new URLSearchParams({ draft: credential }).toString()); window.location.reload();
  };
  const fixture = async (type) => {
    try { setError(''); const result = await post('/_local/api/fixture', { fixture: type }); await adoptCredential(result.resumeCredential); }
    catch (issue) { setError(issue.message); }
  };
  const showHistory = async () => {
    try { const result = await post('/_local/api/history', { resumeCredential: getStoredResumeCredential() }); setHistory(result.revisions); setPanel('history'); }
    catch (issue) { setError(issue.message); }
  };
  const showCaptures = async () => {
    try { const result = await fetch('/_local/api/state').then((response) => response.json()); setCaptures(result.captures); setPanel('captures'); }
    catch (issue) { setError(issue.message); }
  };
  return <>
    <aside className="local-toolbar" aria-label="Local testing tools">
      <div className="local-toolbar-title"><FlaskConical size={22} /><div><strong>Local testing workspace</strong><span>Base44 and Zapier disconnected · drafts saved on this computer</span></div><ShieldCheck className="local-shield" size={20} /></div>
      <div className="local-tool-actions">
        <button onClick={() => fixture('scout')}><RotateCcw size={15} />Load Scout sample</button>
        <button onClick={() => fixture('blank')}>Start blank draft</button>
        <button onClick={() => setPanel('json')}><FileJson size={15} />Inspect JSON</button>
        <button disabled={!payload} onClick={() => download(payload, 'questionnaire-local-preview.json')}><Download size={15} />Export JSON</button>
        <button onClick={showHistory}><History size={15} />Saved versions</button>
        <button onClick={showCaptures}>Submission captures</button>
      </div>
      {error && <p role="alert" className="local-error">{error}</p>}
    </aside>
    {panel && <div className="local-panel-backdrop" onClick={() => setPanel('')}><section role="dialog" aria-modal="true" aria-label={panel === 'json' ? 'Payload preview' : panel === 'history' ? 'Saved local versions' : 'Local submission captures'} className="local-panel" onClick={(event) => event.stopPropagation()}>
      <header><div><h2>{panel === 'json' ? 'Payload preview' : panel === 'history' ? 'Saved local versions' : 'Local submission captures'}</h2><p>{panel === 'json' ? 'This is the JSON produced by your current answers. Nothing is sent externally.' : 'These records exist only on this computer.'}</p></div><button aria-label="Close local panel" onClick={() => setPanel('')}><X /></button></header>
      {panel === 'json' && <><p className="local-json-status">{payloadError || (validateSubmissionPayload(payload).ok ? `Valid payload · ${payload.metadata.questionnaire_payload_version === 2 ? 'Version 2 — organized pages' : 'Legacy format — organizer not adopted'}` : validateSubmissionPayload(payload).errors.join(' '))}</p><pre>{JSON.stringify(payload || { error: payloadError }, null, 2)}</pre></>}
      {panel === 'history' && <><p className="local-notice">Restoring creates a separate local draft. The current draft and its history are kept.</p>{!history.length && <p>No previous saves yet. Edit a question to create a saved version.</p>}{history.map((revision) => <div className="local-record" key={revision.revision}><span>Revision {revision.revision}<small>{new Date(revision.savedAt).toLocaleString()}</small></span><button onClick={async () => { try { const result = await post('/_local/api/restore', { resumeCredential: getStoredResumeCredential(), revision: revision.revision }); await adoptCredential(result.resumeCredential); } catch (issue) { setError(issue.message); } }}>Restore as new draft</button></div>)}</>}
      {panel === 'captures' && <>{!captures.length && <p>No submissions captured yet. Use the questionnaire’s Submit button after reviewing your answers.</p>}{[...captures].reverse().map((capture) => <div className="local-record" key={capture.id}><span>{capture.payload.metadata?.business_name || 'Test capture'}<small>{capture.route} · {new Date(capture.capturedAt).toLocaleString()}</small><small>{capture.destination}</small></span><button onClick={() => download(capture.payload, `${capture.id}.json`)}>Download JSON</button></div>)}</>}
    </section></div>}
  </>;
}
ReactDOM.createRoot(document.getElementById('root')).render(<BrowserRouter><ReduxProvider><PreviewTools /><ProQuestionnaire /><Toaster richColors /></ReduxProvider></BrowserRouter>);
