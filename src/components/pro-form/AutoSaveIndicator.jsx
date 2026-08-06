import { useState, useEffect } from 'react';
import { Save } from 'lucide-react';

export default function AutoSaveIndicator({
  show,
  storageMode = 'unknown',
  getStorageDiagnostics,
  getLocalPersistenceStatus,
  serverConfirmed = false,
}) {
  const [visible, setVisible] = useState(false);
  const [fading, setFading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [localSaveFailed, setLocalSaveFailed] = useState(false);
  const [resolvedStorageMode, setResolvedStorageMode] = useState(storageMode);
  const savedDelayMs = 200;
  const fadeDelayMs = 3000;
  const hideDelayMs = 3500;

  useEffect(() => {
    if (!show) return;

    setVisible(true);
    setFading(false);
    setSaved(false);
    setLocalSaveFailed(false);
    setResolvedStorageMode(storageMode);

    let savedTimer;
    let attempts = 0;
    const resolveSavedState = () => {
      let nextMode = storageMode;
      let localStatus = null;
      try { localStatus = getLocalPersistenceStatus?.() || null; } catch {}
      if (
        localStatus
        && !localStatus.lastErrorCode
        && (localStatus.dirty || localStatus.inFlight || !localStatus.lastSavedAt)
        && attempts < 20
      ) {
        attempts += 1;
        savedTimer = setTimeout(resolveSavedState, 50);
        return;
      }
      if (localStatus?.storageMode) nextMode = localStatus.storageMode;
      setLocalSaveFailed(Boolean(localStatus?.lastErrorCode));
      try { nextMode = getStorageDiagnostics?.().storageMode || nextMode; } catch {}
      setResolvedStorageMode(nextMode);
      setSaved(true);
    };
    savedTimer = setTimeout(resolveSavedState, savedDelayMs);

    const fadeTimer = setTimeout(() => {
      setFading(true);
    }, fadeDelayMs);

    const hideTimer = setTimeout(() => {
      setVisible(false);
    }, hideDelayMs);

    return () => {
      clearTimeout(savedTimer);
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, [
    show,
    storageMode,
    getStorageDiagnostics,
    getLocalPersistenceStatus,
    savedDelayMs,
    fadeDelayMs,
    hideDelayMs,
  ]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-6 right-6 bg-white border border-slate-200 shadow-lg rounded-xl px-4 py-3 flex items-center gap-3 z-50 transition-opacity duration-500 ${fading ? 'opacity-0' : 'opacity-100'}`}
    >
      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
        <Save className="w-4 h-4 text-blue-600" />
      </div>
      <div>
        <p className="font-semibold text-slate-900 text-sm">💾 Auto-Save</p>
        <p className="text-xs text-slate-500">
          {!saved
            ? 'Saving your progress in this browser…'
            : localSaveFailed
              ? 'Browser save could not be confirmed.'
              : serverConfirmed
                ? 'Progress confirmed by the server.'
                : resolvedStorageMode === 'indexeddb' || resolvedStorageMode === 'localstorage'
                  ? 'Progress saved in this browser.'
                  : 'Progress is available for this page only.'}
        </p>
      </div>
    </div>
  );
}
