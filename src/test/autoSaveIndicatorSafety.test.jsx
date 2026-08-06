import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AutoSaveIndicator from '@/components/pro-form/AutoSaveIndicator';

afterEach(() => vi.useRealTimers());

describe('truthful autosave status', () => {
  it.each([
    ['indexeddb', 'Progress saved in this browser.'],
    ['localstorage', 'Progress saved in this browser.'],
    ['memory_only', 'Progress is available for this page only.'],
  ])('reports %s without a secure-cookie claim', async (storageMode, expected) => {
    vi.useFakeTimers();
    render(<AutoSaveIndicator show={1} storageMode={storageMode} />);

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Saving your progress in this browser…')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/secure cookie/i);
  });
});
