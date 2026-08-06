export const PRO_DRAFT_TAB_COORDINATOR_VERSION = 1;

const MESSAGE_TYPES = new Set([
  'tab_hello',
  'tab_active',
  'local_revision_changed',
  'server_revision_accepted',
  'save_in_progress',
  'conflict_detected',
  'draft_submitted',
  'draft_superseded',
  'tab_closing',
]);
const STATUS_VALUES = new Set([
  'active', 'saving', 'saved', 'conflict', 'submitted', 'superseded', 'closing',
]);
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,160}$/u;
const HASH = /^[a-f0-9]{8,64}$/u;
const FALLBACK_TTL_MS = 10_000;

const fingerprintNamespace = (namespace) => {
  const text = String(namespace || '');
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    first ^= text.charCodeAt(index);
    first = Math.imul(first, 0x01000193);
    second ^= text.charCodeAt(text.length - index - 1);
    second = Math.imul(second, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
};

export const generateSourceTabId = (cryptoProvider = globalThis.crypto) => {
  try {
    const bytes = new Uint8Array(12);
    cryptoProvider?.getRandomValues?.(bytes);
    const encoded = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (encoded && !/^0+$/u.test(encoded)) return `tab_${encoded}`;
  } catch {}
  return `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
};

const finiteRevision = (value) => (
  Number.isSafeInteger(value) && value >= 0 ? value : undefined
);

const sanitizeMessage = (input, namespaceFingerprint, sourceTabId, now) => {
  if (!input || typeof input !== 'object' || !MESSAGE_TYPES.has(input.type)) return null;
  const message = {
    version: PRO_DRAFT_TAB_COORDINATOR_VERSION,
    type: input.type,
    namespaceFingerprint,
    sourceTabId,
    timestamp: new Date(now).toISOString(),
  };
  const clientRevision = finiteRevision(input.clientRevision);
  const serverRevision = finiteRevision(input.serverRevision);
  if (clientRevision !== undefined) message.clientRevision = clientRevision;
  if (serverRevision !== undefined) message.serverRevision = serverRevision;
  const prefix = typeof input.stateHashPrefix === 'string'
    ? input.stateHashPrefix
    : (typeof input.stateHash === 'string' ? input.stateHash.slice(0, 12) : null);
  if (prefix && HASH.test(prefix) && prefix.length <= 12) message.stateHashPrefix = prefix;
  if (typeof input.status === 'string' && STATUS_VALUES.has(input.status)) {
    message.status = input.status;
  }
  if (typeof input.mutationId === 'string' && SAFE_ID.test(input.mutationId)) {
    message.mutationId = input.mutationId;
  }
  return Object.freeze(message);
};

const validateIncoming = (value, namespaceFingerprint, now) => {
  if (!value || typeof value !== 'object'
    || value.version !== PRO_DRAFT_TAB_COORDINATOR_VERSION
    || !MESSAGE_TYPES.has(value.type)
    || value.namespaceFingerprint !== namespaceFingerprint
    || typeof value.sourceTabId !== 'string'
    || !SAFE_ID.test(value.sourceTabId)
    || typeof value.timestamp !== 'string') return null;
  const sentAt = Date.parse(value.timestamp);
  if (!Number.isFinite(sentAt) || Math.abs(now - sentAt) > FALLBACK_TTL_MS) return null;
  return sanitizeMessage(value, namespaceFingerprint, value.sourceTabId, sentAt);
};

const defaultWindowAdapter = {
  addEventListener(type, listener) {
    try { globalThis.window?.addEventListener?.(type, listener); } catch {}
  },
  removeEventListener(type, listener) {
    try { globalThis.window?.removeEventListener?.(type, listener); } catch {}
  },
};

const safeLocalStorage = () => {
  try { return globalThis.localStorage; } catch { return null; }
};

export const createProDraftTabCoordinator = (options = {}) => {
  const namespace = typeof options.namespace === 'string' ? options.namespace : '';
  if (!namespace) throw new TypeError('PRO_DRAFT_TAB_NAMESPACE_REQUIRED');
  const namespaceFingerprint = fingerprintNamespace(namespace);
  const sourceTabId = typeof options.sourceTabId === 'string' && SAFE_ID.test(options.sourceTabId)
    ? options.sourceTabId : generateSourceTabId(options.crypto);
  const channelName = `pro-draft-tabs-v${PRO_DRAFT_TAB_COORDINATOR_VERSION}-${namespaceFingerprint}`;
  const storageKey = `__pro_draft_coord_v${PRO_DRAFT_TAB_COORDINATOR_VERSION}_${namespaceFingerprint}`;
  const BroadcastChannelConstructor = Object.hasOwn(options, 'BroadcastChannel')
    ? options.BroadcastChannel : globalThis.BroadcastChannel;
  const storage = Object.hasOwn(options, 'storage') ? options.storage : safeLocalStorage();
  const windowAdapter = options.windowAdapter || defaultWindowAdapter;
  const clock = options.clock || Date.now;
  const listeners = new Set();
  let channel = null;
  let mode = 'unavailable';
  let active = false;
  let sentCount = 0;
  let receivedCount = 0;
  let rejectedCount = 0;

  const emit = (message) => {
    if (!message || message.sourceTabId === sourceTabId) return;
    receivedCount += 1;
    for (const listener of listeners) {
      try { listener(message); } catch {}
    }
  };

  const onChannelMessage = (event) => {
    const message = validateIncoming(event?.data, namespaceFingerprint, Number(clock()));
    if (!message) rejectedCount += 1;
    else emit(message);
  };

  const onStorage = (event) => {
    if (event?.key !== storageKey || typeof event.newValue !== 'string') return;
    try {
      const message = validateIncoming(
        JSON.parse(event.newValue), namespaceFingerprint, Number(clock()),
      );
      if (!message) rejectedCount += 1;
      else emit(message);
    } catch {
      rejectedCount += 1;
    }
  };

  const start = () => {
    if (active) return getSafeTabCoordinatorDiagnostics(api);
    active = true;
    if (typeof BroadcastChannelConstructor === 'function') {
      try {
        channel = new BroadcastChannelConstructor(channelName);
        channel.addEventListener?.('message', onChannelMessage);
        if (!channel.addEventListener) channel.onmessage = onChannelMessage;
        mode = 'broadcast_channel';
      } catch {
        channel = null;
      }
    }
    if (!channel) {
      try {
        const probe = `${storageKey}_probe`;
        storage?.setItem?.(probe, '1');
        storage?.removeItem?.(probe);
        if (typeof storage?.setItem === 'function') {
          windowAdapter.addEventListener?.('storage', onStorage);
          mode = 'storage_event';
        }
      } catch {
        mode = 'unavailable';
      }
    }
    broadcast({ type: 'tab_hello', status: 'active' });
    return getSafeTabCoordinatorDiagnostics(api);
  };

  const broadcast = (input) => {
    if (!active) return false;
    const message = sanitizeMessage(input, namespaceFingerprint, sourceTabId, Number(clock()));
    if (!message) {
      rejectedCount += 1;
      return false;
    }
    try {
      if (mode === 'broadcast_channel' && channel) channel.postMessage(message);
      else if (mode === 'storage_event') {
        storage.setItem(storageKey, JSON.stringify(message));
        storage.removeItem(storageKey);
      } else return false;
      sentCount += 1;
      return true;
    } catch {
      mode = 'unavailable';
      return false;
    }
  };

  const stop = () => {
    if (!active) return getSafeTabCoordinatorDiagnostics(api);
    broadcast({ type: 'tab_closing', status: 'closing' });
    active = false;
    try {
      channel?.removeEventListener?.('message', onChannelMessage);
      if (channel) channel.onmessage = null;
      channel?.close?.();
    } catch {}
    channel = null;
    windowAdapter.removeEventListener?.('storage', onStorage);
    return getSafeTabCoordinatorDiagnostics(api);
  };

  const api = Object.freeze({
    start,
    stop,
    dispose: stop,
    broadcast,
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSourceTabId: () => sourceTabId,
    getNamespaceFingerprint: () => namespaceFingerprint,
    getMode: () => mode,
    getDiagnostics: () => getSafeTabCoordinatorDiagnostics(api),
    _getCounts: () => ({ active, sentCount, receivedCount, rejectedCount }),
  });
  return api;
};

export const getSafeTabCoordinatorDiagnostics = (coordinator) => {
  const counts = coordinator?._getCounts?.() || {};
  const mode = coordinator?.getMode?.() || 'unavailable';
  return Object.freeze({
    version: PRO_DRAFT_TAB_COORDINATOR_VERSION,
    active: counts.active === true,
    mode: ['broadcast_channel', 'storage_event'].includes(mode) ? mode : 'unavailable',
    coordinationAvailable: ['broadcast_channel', 'storage_event'].includes(mode),
    sentCount: Number.isSafeInteger(counts.sentCount) ? counts.sentCount : 0,
    receivedCount: Number.isSafeInteger(counts.receivedCount) ? counts.receivedCount : 0,
    rejectedCount: Number.isSafeInteger(counts.rejectedCount) ? counts.rejectedCount : 0,
    broadcastsAnswers: false,
    broadcastsCredentials: false,
    broadcastsTokens: false,
    serverConcurrencyAuthoritative: true,
  });
};
