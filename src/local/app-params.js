// Never accept app/server/token overrides in the isolated preview.
export const appParams = {
  appId: 'local-questionnaire',
  serverUrl: typeof window === 'undefined' ? 'http://localhost:5173' : window.location.origin,
  token: null, functionsVersion: null,
  fromUrl: typeof window === 'undefined' ? '' : window.location.href
};
export const DEFAULT_BASE44_APP_ID = 'local-questionnaire';
export const DEFAULT_BASE44_BACKEND_URL = 'http://localhost:5173';
