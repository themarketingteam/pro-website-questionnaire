import { useProDraftSyncContext } from '@/contexts/ProDraftSyncContext';

/**
 * Safe React facade for draft synchronization. Credentials and manager
 * internals stay outside this context; a narrow lifecycle adapter supports
 * draft replacement without exposing authorization state.
 */
export const useProDraftSync = () => useProDraftSyncContext();

export default useProDraftSync;
