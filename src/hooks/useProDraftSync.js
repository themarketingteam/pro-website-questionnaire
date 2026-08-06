import { useProDraftSyncContext } from '@/contexts/ProDraftSyncContext';

/**
 * Safe React facade for draft synchronization. Credentials and manager
 * internals are deliberately absent from the returned value.
 */
export const useProDraftSync = () => useProDraftSyncContext();

export default useProDraftSync;
