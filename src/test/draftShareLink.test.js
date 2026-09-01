import { describe, expect, it, vi } from 'vitest';
import { buildDraftShareUrl, copyTextToClipboard } from '@/lib/draftShareLink';

const CREDENTIAL = 'secure_share_session_1234567890.abcdefghijklmnopqrstuvwxyzABCDEFGH';

describe('secure draft share links', () => {
  it('places the unguessable resume credential in the URL fragment', () => {
    expect(buildDraftShareUrl(CREDENTIAL)).toBe(
      `https://proform.tmtwebsiteresources.xyz/#draft=${CREDENTIAL}`,
    );
  });

  it('rejects malformed credentials and insecure public origins', () => {
    expect(() => buildDraftShareUrl('draft-id-only')).toThrow(/valid draft link credential/i);
    expect(() => buildDraftShareUrl(CREDENTIAL, 'http://public.example')).toThrow(/must use HTTPS/i);
  });

  it('falls back to the legacy copy command when Clipboard API is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });

    await copyTextToClipboard('https://example.test/#draft=secure');

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });
});
