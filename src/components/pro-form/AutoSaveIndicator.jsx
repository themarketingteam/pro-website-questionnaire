import React, { useState, useEffect } from 'react';
import { Save } from 'lucide-react';

export default function AutoSaveIndicator({ show }) {
  const [visible, setVisible] = useState(false);
  const [fading, setFading] = useState(false);
  const isTestMode = import.meta.env.MODE === 'test';
  const fadeDelayMs = isTestMode ? 0 : 3000;
  const hideDelayMs = isTestMode ? 0 : 3500;

  useEffect(() => {
    if (!show) return;

    setVisible(true);
    setFading(false);

    const fadeTimer = setTimeout(() => {
      setFading(true);
    }, fadeDelayMs);

    const hideTimer = setTimeout(() => {
      setVisible(false);
    }, hideDelayMs);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, [show, fadeDelayMs, hideDelayMs]);

  if (!visible) return null;

  return (
    <div className={`fixed bottom-6 right-6 bg-white border border-slate-200 shadow-lg rounded-xl px-4 py-3 flex items-center gap-3 z-50 transition-opacity duration-500 ${fading ? 'opacity-0' : 'opacity-100'}`}>
      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
        <Save className="w-4 h-4 text-blue-600" />
      </div>
      <div>
        <p className="font-semibold text-slate-900 text-sm">💾 Auto-Save</p>
        <p className="text-xs text-slate-500">Your responses are automatically saved as a secure cookie.</p>
      </div>
    </div>
  );
}