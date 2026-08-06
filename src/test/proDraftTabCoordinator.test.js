import { describe, expect, it, vi } from 'vitest';
import {
  createProDraftTabCoordinator,
  generateSourceTabId,
  getSafeTabCoordinatorDiagnostics,
} from '@/lib/proDraftTabCoordinator';

const NOW = new Date('2026-08-06T12:00:00.000Z').getTime();
const NAMESPACE = `ns_${'a'.repeat(32)}`;

const createBroadcastHarness = () => {
  const channels = new Map();
  class FakeBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.listeners = new Set();
      const group = channels.get(name) || new Set();
      group.add(this);
      channels.set(name, group);
    }
    addEventListener(_type, listener) { this.listeners.add(listener); }
    removeEventListener(_type, listener) { this.listeners.delete(listener); }
    postMessage(data) {
      for (const peer of channels.get(this.name) || []) {
        if (peer !== this) peer.listeners.forEach((listener) => listener({ data }));
      }
    }
    close() { channels.get(this.name)?.delete(this); }
  }
  return { FakeBroadcastChannel, channels };
};

const createWindowAdapter = () => {
  const listeners = new Map();
  return {
    listeners,
    addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
    removeEventListener: vi.fn((type) => listeners.delete(type)),
  };
};

describe('Pro draft tab coordinator', () => {
  it('generates opaque source tab IDs', () => {
    expect(generateSourceTabId()).toMatch(/^tab_[A-Za-z0-9_]+$/u);
  });

  it('uses a versioned hashed namespace and BroadcastChannel first', () => {
    const { FakeBroadcastChannel, channels } = createBroadcastHarness();
    const coordinator = createProDraftTabCoordinator({
      namespace: NAMESPACE, BroadcastChannel: FakeBroadcastChannel, clock: () => NOW,
    });
    coordinator.start();
    expect(coordinator.getMode()).toBe('broadcast_channel');
    const channelName = [...channels.keys()][0];
    expect(channelName).toMatch(/^pro-draft-tabs-v1-[a-f0-9]{16}$/u);
    expect(channelName).not.toContain(NAMESPACE);
  });

  it('delivers only allowed accepted-revision metadata', () => {
    const { FakeBroadcastChannel } = createBroadcastHarness();
    const first = createProDraftTabCoordinator({
      namespace: NAMESPACE, sourceTabId: 'tab_first', BroadcastChannel: FakeBroadcastChannel,
      clock: () => NOW,
    });
    const second = createProDraftTabCoordinator({
      namespace: NAMESPACE, sourceTabId: 'tab_second', BroadcastChannel: FakeBroadcastChannel,
      clock: () => NOW,
    });
    const received = [];
    first.start();
    second.start();
    second.subscribe((message) => received.push(message));
    first.broadcast({
      type: 'server_revision_accepted', clientRevision: 4, serverRevision: 7,
      stateHash: 'a'.repeat(64), answers: { q1: 'must not escape' },
      resumeToken: 'must-not-escape', status: 'saved',
    });
    expect(received.at(-1)).toMatchObject({
      type: 'server_revision_accepted', clientRevision: 4, serverRevision: 7,
      stateHashPrefix: 'a'.repeat(12), status: 'saved',
    });
    expect(JSON.stringify(received.at(-1))).not.toMatch(/answer|token|must.not.escape/iu);
  });

  it('rejects unsupported message types', () => {
    const { FakeBroadcastChannel } = createBroadcastHarness();
    const coordinator = createProDraftTabCoordinator({
      namespace: NAMESPACE, BroadcastChannel: FakeBroadcastChannel, clock: () => NOW,
    });
    coordinator.start();
    expect(coordinator.broadcast({ type: 'full_draft', responses: {} })).toBe(false);
  });

  it('uses the storage-event fallback when BroadcastChannel is absent', () => {
    const windowAdapter = createWindowAdapter();
    const writes = [];
    const storage = {
      setItem: vi.fn((key, value) => writes.push([key, value])),
      removeItem: vi.fn(),
    };
    const coordinator = createProDraftTabCoordinator({
      namespace: NAMESPACE, BroadcastChannel: undefined, storage, windowAdapter,
      clock: () => NOW,
    });
    coordinator.start();
    expect(coordinator.getMode()).toBe('storage_event');
    expect(windowAdapter.listeners.has('storage')).toBe(true);
    expect(writes.some(([, value]) => value.includes('tab_hello'))).toBe(true);
  });

  it('receives valid storage events and ignores other namespaces', () => {
    const windowAdapter = createWindowAdapter();
    const writes = [];
    const storage = {
      setItem: vi.fn((key, value) => writes.push([key, value])), removeItem: vi.fn(),
    };
    const sender = createProDraftTabCoordinator({
      namespace: NAMESPACE, sourceTabId: 'tab_sender', BroadcastChannel: undefined,
      storage, windowAdapter: createWindowAdapter(), clock: () => NOW,
    });
    const receiver = createProDraftTabCoordinator({
      namespace: NAMESPACE, sourceTabId: 'tab_receiver', BroadcastChannel: undefined,
      storage, windowAdapter, clock: () => NOW,
    });
    const received = vi.fn();
    sender.start();
    receiver.start();
    receiver.subscribe(received);
    sender.broadcast({ type: 'conflict_detected', serverRevision: 3, status: 'conflict' });
    const [key, newValue] = writes.filter(([, value]) => value.includes('conflict_detected')).at(-1);
    windowAdapter.listeners.get('storage')({ key, newValue });
    expect(received).toHaveBeenCalledWith(expect.objectContaining({ type: 'conflict_detected' }));
    windowAdapter.listeners.get('storage')({ key: `${key}-other`, newValue });
    expect(received).toHaveBeenCalledOnce();
  });

  it('fails closed without crashing when all storage is blocked', () => {
    const storage = {
      setItem: vi.fn(() => { throw new Error('blocked'); }), removeItem: vi.fn(),
    };
    const coordinator = createProDraftTabCoordinator({
      namespace: NAMESPACE, BroadcastChannel: undefined, storage,
      windowAdapter: createWindowAdapter(), clock: () => NOW,
    });
    expect(() => coordinator.start()).not.toThrow();
    expect(coordinator.getMode()).toBe('unavailable');
    expect(coordinator.broadcast({ type: 'tab_active' })).toBe(false);
  });

  it('reports that no answer, credential, or token data is broadcast', () => {
    const coordinator = createProDraftTabCoordinator({
      namespace: NAMESPACE, BroadcastChannel: undefined,
      storage: { setItem() { throw new Error('blocked'); }, removeItem() {} },
      windowAdapter: createWindowAdapter(), clock: () => NOW,
    });
    coordinator.start();
    expect(getSafeTabCoordinatorDiagnostics(coordinator)).toMatchObject({
      coordinationAvailable: false,
      broadcastsAnswers: false,
      broadcastsCredentials: false,
      broadcastsTokens: false,
      serverConcurrencyAuthoritative: true,
    });
  });
});
