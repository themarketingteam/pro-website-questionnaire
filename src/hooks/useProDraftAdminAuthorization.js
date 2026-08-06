import { useContext } from 'react';
import { ProDraftAdminAuthorizationContext } from '@/contexts/ProDraftAdminAuthorizationContext';

export function useProDraftAdminAuthorization() {
  const context = useContext(ProDraftAdminAuthorizationContext);
  if (!context) throw new Error('ProDraftAdminAuthorizationProvider is required.');
  return context;
}

export default useProDraftAdminAuthorization;
