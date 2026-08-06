import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AutoSaveIndicator, {
  AUTO_SAVE_STATUS_WORDING,
} from '@/components/pro-form/AutoSaveIndicator';

afterEach(() => vi.useRealTimers());

describe('truthful autosave status', () => {
  it.each(Object.entries(AUTO_SAVE_STATUS_WORDING).filter(([state]) => (
    state !== 'server_saved'
  )))('renders the exact %s wording', (syncState, expected) => {
    vi.useFakeTimers();
    render(<AutoSaveIndicator show={1} syncState={syncState} />);
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-atomic', 'true');
  });

  it('does not claim a secure save until a server revision and time are acknowledged', () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <AutoSaveIndicator show={1} syncState="server_saved" />,
    );
    expect(screen.getByText('Saving securely…')).toBeInTheDocument();
    expect(screen.queryByText('Saved securely')).not.toBeInTheDocument();

    rerender(
      <AutoSaveIndicator
        show={2}
        syncState="server_saved"
        confirmedServerRevision={2}
        lastServerSavedAt="2033-05-18T12:00:00.000Z"
      />,
    );
    expect(screen.getByText('Saved securely')).toBeInTheDocument();
  });

  it.each([
    ['indexeddb', 'Progress saved in this browser.'],
    ['localstorage', 'Progress saved in this browser.'],
    ['memory_only', 'Progress is available for this page only.'],
  ])('reports %s without a secure-cookie claim', async (storageMode, expected) => {
    vi.useFakeTimers();
    render(<AutoSaveIndicator show={1} storageMode={storageMode} />);

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Saving your progress in this browser…')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(201); });
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/secure cookie/i);
  });

  it('does not claim a browser save after the local cache reports an error', async () => {
    vi.useFakeTimers();
    render(
      <AutoSaveIndicator
        show={1}
        storageMode="localstorage"
        getLocalPersistenceStatus={() => ({
          dirty: false,
          inFlight: false,
          lastSavedAt: null,
          lastErrorCode: 'CANONICAL_CACHE_WRITE_FAILED',
          storageMode: 'localstorage',
        })}
      />,
    );

    await act(async () => { await vi.advanceTimersByTimeAsync(201); });
    expect(screen.getByText('Browser save could not be confirmed.')).toBeInTheDocument();
    expect(screen.queryByText('Progress saved in this browser.')).not.toBeInTheDocument();
  });
});
