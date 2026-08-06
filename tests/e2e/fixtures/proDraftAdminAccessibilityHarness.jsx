import React from 'react';
import { createRoot } from 'react-dom/client';
import { ProDraftAdminRecoveryShellContext } from '@/components/admin/ProDraftAdminRecoveryShell';
import ProFormDraftRecovery from '@/pages/ProFormDraftRecovery';
import '@/index.css';

const draft = {
  id: 'synthetic-a11y-draft', session_id: 'synthetic-a11y-session', status: 'active',
  server_revision: 4, client_revision: 4, business_name: 'Synthetic Accessibility Business',
  domain: 'accessibility.example.invalid', recovery_email: 's***@example.invalid',
  recovery_email_verification_status: 'unverified', last_saved_at: '2033-05-18T12:00:00.000Z',
  retention_hold: false, mapped_payload_json: '{"synthetic":true}', draft_state_json: '{"synthetic":true}',
  responses_json: '{"synthetic":true}', jsonDiagnostics: { mapped_payload_json: { parsed: { synthetic: true } } },
};

const api = {
  listDrafts: async () => ({ items: [draft], nextCursor: null }),
  getDraft: async () => ({ draft }),
  updateDraft: async () => ({ draft }),
  listIntakes: async () => ({ items: [], nextCursor: null }),
  getIntake: async () => ({ intake: null }),
  repairSubmission: async () => ({ success: true }),
  retrySubmission: async () => ({ success: true }),
};

createRoot(document.getElementById('root')).render(
  <ProDraftAdminRecoveryShellContext.Provider value={{ api, editDirty: false, setEditDirty() {}, clearAdminCaches() {} }}>
    <ProFormDraftRecovery />
  </ProDraftAdminRecoveryShellContext.Provider>,
);
