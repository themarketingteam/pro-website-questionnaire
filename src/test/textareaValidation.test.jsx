import React from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TextareaQuestion from '@/components/pro-form/TextareaQuestion';

let base44;

beforeAll(async () => {
  ({ base44 } = await import('@/api/base44Client'));
});

describe('TextareaQuestion manual validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('directly invokes the production validation function and renders its result', async () => {
    base44.functions.invoke.mockResolvedValueOnce({
      status: 200,
      data: {
        status: 'complete',
        message: 'Looking good!',
        characterCount: 48,
        expectedRange: 'Character Count: 48 • Ideal Range: 20-1200'
      }
    });

    render(
      <TextareaQuestion
        value="We provide proactive managed technology support."
        onChange={vi.fn()}
        questionId="6"
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Validate Now' }));

    expect(base44.functions.invoke).toHaveBeenCalledWith('validateQuestionText', {
      text: 'We provide proactive managed technology support.',
      questionContext: 'question_6'
    });
    expect(await screen.findByText('Looking good!')).toBeInTheDocument();
  });

  it('shows a retryable error instead of silently returning to neutral', async () => {
    base44.functions.invoke.mockRejectedValue(new Error('temporary network failure'));

    render(
      <TextareaQuestion
        value="We provide proactive managed technology support."
        onChange={vi.fn()}
        questionId="6"
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Validate Now' }));

    expect(await screen.findByText(/couldn't validate this answer right now/i)).toBeInTheDocument();
    expect(base44.functions.invoke).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Validate Now' })).toBeEnabled();
    });
  });

  it('automatically retries one transient live invocation failure', async () => {
    base44.functions.invoke
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce({
        status: 200,
        data: { status: 'complete', message: 'Looking good!', characterCount: 48 }
      });

    render(
      <TextareaQuestion
        value="We provide proactive managed technology support."
        onChange={vi.fn()}
        questionId="6"
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Validate Now' }));

    expect(await screen.findByText('Looking good!')).toBeInTheDocument();
    expect(base44.functions.invoke).toHaveBeenCalledTimes(2);
  });

  it('prevents duplicate requests while validation is in progress', async () => {
    let resolveValidation;
    base44.functions.invoke.mockReturnValueOnce(new Promise((resolve) => {
      resolveValidation = resolve;
    }));

    render(
      <TextareaQuestion
        value="We provide proactive managed technology support."
        onChange={vi.fn()}
        questionId="6"
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Validate Now' }));

    expect(await screen.findByRole('button', { name: 'Validating...' })).toBeDisabled();
    expect(base44.functions.invoke).toHaveBeenCalledTimes(1);

    resolveValidation({
      status: 200,
      data: { status: 'complete', message: 'Looking good!', characterCount: 48 }
    });

    expect(await screen.findByText('Looking good!')).toBeInTheDocument();
  });
});
