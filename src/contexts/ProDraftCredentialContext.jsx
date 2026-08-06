import { createContext, useContext, useMemo } from 'react';

const ProDraftCredentialContext = createContext(null);

export const ProDraftCredentialProvider = ({ coordinator, children }) => {
  const value = useMemo(() => Object.freeze({
    getRecoveryCodeForDisplay: () => coordinator?.getRecoveryCodeForDisplay?.() ?? null,
    hasFullRecoveryCode: () => Boolean(coordinator?.getRecoveryCodeForDisplay?.()),
    getRecoveryCodeHint: () => coordinator?.getRecoveryCodeHint?.() ?? null,
    getCredentialStorageMode: () => coordinator?.getCredentialStorageMode?.() ?? 'unknown',
    clearCurrentDraftCredentials: () => coordinator?.clearCurrentDraftCredentials?.(),
    replaceCurrentDraftCredentials: (bundle, options) => (
      coordinator?.replaceCurrentDraftCredentials?.(bundle, options)
    ),
  }), [coordinator]);

  return (
    <ProDraftCredentialContext.Provider value={value}>
      {children}
    </ProDraftCredentialContext.Provider>
  );
};

export const useProDraftCredentials = () => {
  const context = useContext(ProDraftCredentialContext);
  if (!context) throw new Error('ProDraftCredentialProvider is required.');
  return context;
};

export default ProDraftCredentialProvider;
