import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useProDraftAdminAuthorization } from '@/hooks/useProDraftAdminAuthorization';
import { createProDraftAdminApiClient } from '@/lib/proDraftAdminApiClient';
import { frontendRuntimeConfig } from '@/lib/proDraftRuntimeConfig';

export const ProDraftAdminRecoveryShellContext = createContext(null);

export function useProDraftAdminRecoveryShell() {
  const value = useContext(ProDraftAdminRecoveryShellContext);
  if (!value) throw new Error('ProDraftAdminRecoveryShell is required.');
  return value;
}

export default function ProDraftAdminRecoveryShell({ children }) {
  const authorization = useProDraftAdminAuthorization();
  const queryClient = useQueryClient();
  const [editDirty, setEditDirty] = useState(false);
  const dirtyRef = useRef(false);
  dirtyRef.current = editDirty;

  const api = useMemo(() => createProDraftAdminApiClient({ authorization: {
    getGrantForAuthorizedRequest: authorization.getAdminGrantForAuthorizedRequest,
    handleAdminGrantRejected: authorization.handleAdminGrantRejected,
  } }), [authorization.getAdminGrantForAuthorizedRequest, authorization.handleAdminGrantRejected]);

  const clearAdminCaches = useCallback(() => {
    queryClient.removeQueries({ queryKey: ['pro-draft-admin'] });
  }, [queryClient]);

  useEffect(() => authorization.registerAuthorizationInvalidationHandler(async () => {
    if (dirtyRef.current) window.confirm('Draft Recovery authorization changed. Your unsaved edit values will be discarded after you acknowledge this warning.');
    clearAdminCaches();
    setEditDirty(false);
  }), [authorization, clearAdminCaches]);

  const forget = async () => {
    clearAdminCaches();
    setEditDirty(false);
    await authorization.forgetThisDevice();
  };

  const value = useMemo(() => Object.freeze({ api, editDirty, setEditDirty, clearAdminCaches }), [api, editDirty, clearAdminCaches]);
  const environment = frontendRuntimeConfig.environment || 'unknown';

  return (
    <ProDraftAdminRecoveryShellContext.Provider value={value}>
      <div className="min-h-screen bg-slate-50">
        <header className="border-b bg-white px-4 py-3 sm:px-6" aria-label="Draft Recovery authorization">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-slate-700">
              <ShieldCheck className="h-4 w-4 text-green-700" aria-hidden="true" />
              <span>Draft Recovery authorized</span>
              <span className="rounded bg-slate-100 px-2 py-1 font-mono text-xs" data-testid="admin-environment">{environment}</span>
              {authorization.authorizationState.storageMode === 'memory_only' ? <span className="text-amber-700">Memory-only authorization</span> : null}
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild><Button type="button" variant="outline" size="sm">Forget this device</Button></AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove Draft Recovery Access from This Device?</AlertDialogTitle>
                  <AlertDialogDescription>
                    You will need to enter the recovery access password the next time you open Draft Recovery on this browser.
                    {editDirty ? ' Unsaved administrative edits will be discarded.' : ''}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={forget}>Forget this device</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </header>
        {children}
      </div>
    </ProDraftAdminRecoveryShellContext.Provider>
  );
}
