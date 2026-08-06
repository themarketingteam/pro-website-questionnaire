import React from 'react';
import { createRoot } from 'react-dom/client';
import ProDraftServiceUnavailable from '@/components/pro-form/ProDraftServiceUnavailable';
import '@/index.css';

createRoot(document.getElementById('root')).render(
  <ProDraftServiceUnavailable policy={{ outcome: 'continue_local_only', recoveryRouteAvailable: true }} onRetry={() => {}} />,
);
