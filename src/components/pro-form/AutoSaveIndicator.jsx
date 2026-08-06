import { useState, useEffect } from 'react';
import { Save } from 'lucide-react';

export const AUTO_SAVE_STATUS_WORDING = Object.freeze({
  local_saving: 'Saving in this browser…',
  local_saved: 'Saved in this browser',
  server_saving: 'Saving securely…',
  server_saved: 'Saved securely',
  offline_local_only: 'Offline — saved in this browser and will sync when reconnected',
  retrying: 'We could not sync yet — retrying',
  error: 'We could not save securely yet',
  conflict: 'This draft changed elsewhere — review before continuing',
  superseded: 'This draft was replaced and is now read-only',
  restored: 'Your previous draft was restored',
  submitted: 'Submitted — read-only',
});

/**
 * @param {{
 *   state?: string | null,
 *   confirmedServerRevision?: number | null,
 *   lastServerSavedAt?: string | null,
 * }} [options]
 */
export const resolveAutoSaveStatus = ({
  state,
  confirmedServerRevision,
  lastServerSavedAt,
} = {}) => {
  if (!Object.hasOwn(AUTO_SAVE_STATUS_WORDING, state)) return null;
  if (state === 'server_saved') {
    const serverAcknowledged = Number.isSafeInteger(confirmedServerRevision)
      && confirmedServerRevision > 0
      && typeof lastServerSavedAt === 'string'
      && Number.isFinite(Date.parse(lastServerSavedAt));
    if (!serverAcknowledged) return 'server_saving';
  }
  return state;
};

export default function AutoSaveIndicator({
  show,
  storageMode = 'unknown',
  getStorageDiagnostics,
  getLocalPersistenceStatus,
  serverConfirmed = false,
  syncState = null,
  confirmedServerRevision = null,
  lastServerSavedAt = null,
}) {
  const [visible, setVisible] = useState(false);
  const [fading, setFading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [localSaveFailed, setLocalSaveFailed] = useState(false);
  const [resolvedStorageMode, setResolvedStorageMode] = useState(storageMode);
  const savedDelayMs = 200;
  const fadeDelayMs = 3000;
  const hideDelayMs = 3500;
  const explicitStatus = resolveAutoSaveStatus({
    state: syncState,
    confirmedServerRevision,
    lastServerSavedAt,
  });

  useEffect(() => {
    if (!show) return;

    setVisible(true);
    setFading(false);
    setSaved(false);
    setLocalSaveFailed(false);
    setResolvedStorageMode(storageMode);

    let savedTimer;
    if (explicitStatus) setSaved(true);
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
    if (!explicitStatus) savedTimer = setTimeout(resolveSavedState, savedDelayMs);

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
    explicitStatus,
  ]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`fixed bottom-6 right-6 bg-white border border-slate-200 shadow-lg rounded-xl px-4 py-3 flex items-center gap-3 z-50 transition-opacity duration-500 ${fading ? 'opacity-0' : 'opacity-100'}`}
    >
      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
        <Save className="w-4 h-4 text-blue-600" />
      </div>
      <div>
        <p className="font-semibold text-slate-900 text-sm">💾 Auto-Save</p>
        <p className="text-xs text-slate-500">
          {explicitStatus
            ? AUTO_SAVE_STATUS_WORDING[explicitStatus]
            : !saved
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
