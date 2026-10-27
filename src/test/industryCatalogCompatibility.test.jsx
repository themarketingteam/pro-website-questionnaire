import { useState } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PageOrganizerQuestion from '@/components/pro-form/PageOrganizerQuestion';
import { INDUSTRY_OPTIONS, INDUSTRY_OPTIONS_GROUPED, LEGACY_INDUSTRY_OPTIONS, ACCEPTED_INDUSTRY_OPTIONS } from '@/components/pro-form/questionData';
import { createPageStructure, projectPageStructure, countPageSelections } from '@/lib/pageOrganizerModel';
import { normalizePersistedStateV3 } from '@/components/store/normalization';
import { transformResponsesToPayload } from '@/components/pro-form/submissionPayload';
import { serializePageStructure } from '../../base44/shared/pageOrganizerContract.js';

function IndustryOrganizer({ onChange, ...props }) {
  const [structure, setStructure] = useState(undefined);
  return <PageOrganizerQuestion questionId="4" options={INDUSTRY_OPTIONS} optionGroups={INDUSTRY_OPTIONS_GROUPED} legacyOptions={LEGACY_INDUSTRY_OPTIONS} structure={structure} max={10} {...props} onChange={(next) => { onChange(next); setStructure(next); }} />;
}

describe('individual industry choices with historical compatibility', () => {
  it('lets the client select Financial, Accounting, and CPA as independent pages', async () => {
    const onChange = vi.fn();
    render(<IndustryOrganizer onChange={onChange} />);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const financial = within(screen.getByRole('group', { name: 'Financial', exact: true }));
    expect(financial.getAllByRole('checkbox')).toHaveLength(4);
    await act(async () => user.click(financial.getByRole('heading', { name: 'Financial', exact: true })));
    expect(onChange).not.toHaveBeenCalled();
    for (const name of ['Financial', 'Accounting', 'CPA']) {
      await act(async () => user.click(financial.getByRole('checkbox', { name, exact: true })));
    }
    const structure = onChange.mock.lastCall[0];
    expect(projectPageStructure(structure)).toEqual({ selections: ['Financial', 'Accounting', 'CPA'], otherValues: [] });
    expect(new Set(structure.pages.map((page) => page.id)).size).toBe(3);
    expect(countPageSelections(structure, '4')).toBe(3);
    for (const name of ['Professional Services', 'Marketing', 'Design Firms', 'Food Services']) {
      expect(screen.getByRole('checkbox', { name, exact: true })).toBeInTheDocument();
    }
    expect(screen.queryByRole('checkbox', { name: 'Financial / Accounting / CPA', exact: true })).not.toBeInTheDocument();
    const changeCount = onChange.mock.calls.length;
    await act(async () => user.type(screen.getByRole('searchbox', { name: 'Search available pages' }), 'Financial'));
    expect(screen.getAllByRole('checkbox')).toHaveLength(4);
    expect(screen.getByRole('checkbox', { name: 'Accounting', exact: true })).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledTimes(changeCount);
  });

  it('keeps a saved combined choice as one predefined page until explicitly replaced', async () => {
    const onChange = vi.fn();
    const oldChoice = 'Financial / Accounting / CPA';
    const original = createPageStructure('4', [oldChoice], [], {}, [oldChoice]);
    render(<IndustryOrganizer value={[oldChoice]} onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/Previously saved combined selections stay/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: oldChoice, exact: true })).not.toBeInTheDocument();
    await act(async () => userEvent.setup({ pointerEventsCheck: 0 }).click(screen.getByRole('button', { name: 'Organize pages', exact: true })));
    const adopted = onChange.mock.lastCall[0];
    expect(adopted).toEqual(original);
    const restored = normalizePersistedStateV3({ responses: { '4_structure': JSON.parse(JSON.stringify(adopted)) } });
    const payload = transformResponsesToPayload(restored.responses, 'Local test', 'example.test');
    expect(payload.userdata.target_industries).toEqual([oldChoice]);
    expect(payload.userdata.target_industries_other).toBe('');
    expect(payload.userdata.target_industries_structure).toEqual(serializePageStructure(original));
    expect(countPageSelections(adopted, '4')).toBe(1);
  });

  it('preserves every retired catalog identity and keeps combined choices out of the new picker', () => {
    const historical = createPageStructure('4', LEGACY_INDUSTRY_OPTIONS, [], {}, LEGACY_INDUSTRY_OPTIONS);
    const recognized = createPageStructure('4', LEGACY_INDUSTRY_OPTIONS, [], {}, ACCEPTED_INDUSTRY_OPTIONS);
    expect(recognized).toEqual(historical);
    expect(INDUSTRY_OPTIONS.some((label) => /[\/&()]/.test(label))).toBe(false);
    expect(new Set(INDUSTRY_OPTIONS).size).toBe(INDUSTRY_OPTIONS.length);
  });
});
