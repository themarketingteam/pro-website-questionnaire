import { describe, expect, it, vi } from 'vitest';
import {
  buildNewClientLaunchUrl,
  readNewClientLaunch,
  removeIncomingIdentityParams,
  removeNewClientLaunchParams
} from '@/lib/clientIdentityLaunch';

const createWindow = (url) => {
  let current = new URL(url);
  const windowObject = {
    location: {
      get pathname() { return current.pathname; },
      get search() { return current.search; },
      get hash() { return current.hash; }
    },
    history: {
      state: {},
      replaceState: vi.fn((_state, _title, next) => {
        current = new URL(next, current.origin);
      })
    }
  };
  return { windowObject, getUrl: () => current };
};

describe('explicit new-client launch parameters', () => {
  it('generates a stable request identifier before bootstrap when none is supplied', () => {
    const { windowObject, getUrl } = createWindow('https://example.test/?newClient=true&businessName=Northwind#section');
    const first = readNewClientLaunch(windowObject);
    const second = readNewClientLaunch(windowObject);

    expect(first.active).toBe(true);
    expect(first.generatedRequestId).toBe(true);
    expect(first.requestId).toMatch(/^pro_client_/);
    expect(second.requestId).toBe(first.requestId);
    expect(getUrl().searchParams.get('newClientRequestId')).toBe(first.requestId);
    expect(getUrl().hash).toBe('#section');
  });

  it('removes one-time launch parameters only after confirmation while preserving identity', () => {
    const { windowObject, getUrl } = createWindow(
      'https://example.test/?newClient=true&newClientRequestId=req_123456789012&businessName=Northwind&domainName=northwind.example'
    );
    removeNewClientLaunchParams(windowObject);

    expect(getUrl().searchParams.has('newClient')).toBe(false);
    expect(getUrl().searchParams.has('newClientRequestId')).toBe(false);
    expect(getUrl().searchParams.get('businessName')).toBe('Northwind');
    expect(getUrl().searchParams.get('domainName')).toBe('northwind.example');
  });

  it('can discard only the conflicting incoming identity without removing a secure fragment', () => {
    const { windowObject, getUrl } = createWindow(
      'https://example.test/?businessName=Wrong&domainName=wrong.example&campaign=client#draft=secure.capability'
    );
    removeIncomingIdentityParams(windowObject);

    expect(getUrl().searchParams.has('businessName')).toBe(false);
    expect(getUrl().searchParams.has('domainName')).toBe(false);
    expect(getUrl().searchParams.get('campaign')).toBe('client');
    expect(getUrl().hash).toBe('#draft=secure.capability');
  });

  it('builds a separate-client URL without carrying an existing draft credential', () => {
    const { windowObject } = createWindow('https://example.test/questionnaire#draft=old.secret');
    const url = buildNewClientLaunchUrl({
      windowObject,
      requestId: 'req_manual_reset_123456',
      businessName: 'New Client',
      domain: 'https://www.new-client.example/path'
    });

    expect(url).toBe('/questionnaire?newClient=true&newClientRequestId=req_manual_reset_123456&businessName=New+Client&domainName=new-client.example');
    expect(url).not.toContain('draft=');
  });
});
