import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { base44 } from '@/api/base44Client';
import ProDraftServiceUnavailable from '@/components/pro-form/ProDraftServiceUnavailable';
import ProQuestionnaire from '@/pages/ProQuestionnaire';

const unavailableConfig = Object.freeze({
  configurationValid: true,
  durableDraftV2Enabled: false,
  environment: 'staging',
  killSwitchEnabled: true,
});

describe('ProDraftServiceUnavailable', () => {
  it('shows the exact recovery message and only copies a provided code', async () => {
    const onRetry = vi.fn();
    const onOpenRecovery = vi.fn();
    const clipboard = { writeText: vi.fn(async () => undefined) };
    render(
      <ProDraftServiceUnavailable
        recoveryCode="synthetic-recovery-code"
        onRetry={onRetry}
        onOpenRecovery={onOpenRecovery}
        clipboard={clipboard}
      />,
    );

    expect(screen.getByRole('heading', {
      name: 'Questionnaire Saving Is Temporarily Unavailable',
    })).toBeInTheDocument();
    expect(screen.getByText(
      'Your information saved in this browser has not been intentionally deleted. Please keep this page open or return using your recovery code after service is restored.',
    )).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Draft Recovery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy Recovery Code' }));

    expect(onRetry).toHaveBeenCalledOnce();
    expect(onOpenRecovery).toHaveBeenCalledOnce();
    expect(clipboard.writeText).toHaveBeenCalledWith('synthetic-recovery-code');
    expect(await screen.findByText('Recovery code copied.')).toBeInTheDocument();
    expect(screen.queryByText('synthetic-recovery-code')).not.toBeInTheDocument();
  });

  it('preserves local cache and makes no Base44 call under the kill switch', () => {
    localStorage.setItem('questionnaire-preservation-proof', 'synthetic-local-state');

    render(<ProQuestionnaire runtimeConfig={unavailableConfig} />);

    expect(screen.getByRole('heading', {
      name: 'Questionnaire Saving Is Temporarily Unavailable',
    })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Draft Recovery' }))
      .toHaveAttribute('href', '/recover-draft');
    expect(localStorage.getItem('questionnaire-preservation-proof'))
      .toBe('synthetic-local-state');
    expect(base44.functions.invoke).not.toHaveBeenCalled();
    for (const entity of Object.values(base44.entities)) {
      expect(entity.create).not.toHaveBeenCalled();
      expect(entity.update).not.toHaveBeenCalled();
      expect(entity.filter).not.toHaveBeenCalled();
      expect(entity.list).not.toHaveBeenCalled();
    }
  });

  it('fails closed when V2 is disabled without a kill-switch fallback', () => {
    render(<ProQuestionnaire runtimeConfig={{
      ...unavailableConfig,
      killSwitchEnabled: false,
    }} />);

    expect(screen.getByRole('heading', {
      name: 'Questionnaire Saving Is Temporarily Unavailable',
    })).toBeInTheDocument();
  });
});
