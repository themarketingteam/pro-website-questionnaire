const request = async (path, body, method = 'POST') => {
  if (!path.startsWith('/_local/')) throw new Error('Only local preview requests are permitted.');
  const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(body || {}) }) });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'Local request failed.');
    Object.assign(error, { status: response.status, code: data.code, response: { status: response.status, data } });
    throw error;
  }
  return data;
};
const entities = new Proxy({}, { get: (_, name) => ({
  create: (data) => request(`/_local/api/entities/${name}/create`, { data }),
  update: (id, data) => request(`/_local/api/entities/${name}/update`, { id, data }),
  get: (id) => request(`/_local/api/entities/${name}/get`, { id }),
  filter: (query, sort, limit, skip) => request(`/_local/api/entities/${name}/filter`, { query, sort, limit, skip }),
  list: (sort, limit, skip) => request(`/_local/api/entities/${name}/filter`, { sort, limit, skip }),
  subscribe: () => () => {}
}) });
const disabled = async () => { throw new Error('External AI and integrations are disabled in this local preview.'); };
export const base44 = {
  entities,
  functions: { invoke: async (name, body) => ({ data: await request(`/_local/api/functions/${encodeURIComponent(name)}`, body) }) },
  auth: { me: async () => ({ id: 'local-user', email: 'preview@localhost', role: 'admin' }), logout: () => {}, isAuthenticated: async () => true },
  integrations: { Core: { UploadFile: async ({ file }) => {
    const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    return request('/_local/api/upload', { name: file.name, data });
  }, InvokeLLM: disabled, SendEmail: disabled } },
  agents: { createConversation: disabled, addMessage: disabled, subscribeToConversation: () => () => {} },
  appLogs: { logUserInApp: async () => {} }, analytics: { track: () => {} }
};
