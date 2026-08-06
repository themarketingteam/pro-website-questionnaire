import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useProDraftSyncContext } from './ProDraftSyncContext';

const DEFAULT_VALUE = Object.freeze({
  isOpen: false,
  conflicts: Object.freeze([]),
  applyChoices: async () => null,
  cancelAndKeepReviewing: () => {},
  autosavePaused: false,
});

const ProDraftConflictContext = createContext(/** @type {any} */ (DEFAULT_VALUE));

export const ProDraftConflictProvider = ({ children }) => {
  const sync = useProDraftSyncContext();
  const pending = sync.pendingConflict;
  const conflictKey = (pending?.conflicts || []).map((entry) => entry.conflictId).join('|');
  const [dismissedKey, setDismissedKey] = useState(null);

  useEffect(() => {
    if (conflictKey && conflictKey !== dismissedKey) setDismissedKey(null);
  }, [conflictKey, dismissedKey]);

  const value = useMemo(() => Object.freeze({
    isOpen: Boolean(conflictKey) && dismissedKey !== conflictKey,
    conflicts: pending?.conflicts || Object.freeze([]),
    applyChoices: sync.resolveConflictChoices,
    cancelAndKeepReviewing: () => setDismissedKey(conflictKey),
    autosavePaused: sync.hasConflict,
  }), [conflictKey, dismissedKey, pending?.conflicts, sync.hasConflict, sync.resolveConflictChoices]);

  return (
    <ProDraftConflictContext.Provider value={value}>
      {children}
    </ProDraftConflictContext.Provider>
  );
};

export const useProDraftConflict = () => useContext(ProDraftConflictContext);

export default ProDraftConflictContext;
