import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PageOrganizerQuestion from '@/components/pro-form/PageOrganizerQuestion';
import {
  countPageSelections,
  createPageNode,
  createPageStructure,
  flattenPageStructure,
  getPageCatalogId,
  projectPageStructure
} from '@/lib/pageOrganizerModel';

const services = {
  'Managed IT Services': ['Managed IT', 'On-Site Support'],
  'Cloud Services': ['Cloud Migrations']
};
const options = Object.values(services).flat();
const user = () => {
  const input = userEvent.setup({ pointerEventsCheck: 0 });
  return Object.fromEntries(['click', 'type', 'selectOptions', 'keyboard'].map((method) => [
    method, (...args) => act(async () => { await input[method](...args); })
  ]));
};
const predefined = (label, kind = 'option', id = label) => createPageNode('3', label, {
  source: 'predefined', catalogId: getPageCatalogId('3', label, kind), id
});
const custom = (label, id = label) => createPageNode('3', label, { id });
const tree = (pages) => ({ format: 'page-tree-v1', pages });

function Controlled({ onChange, ...props }) {
  const [structure, setStructure] = useState(props.structure);
  return <PageOrganizerQuestion {...props} structure={structure} onChange={(next) => {
    onChange(next);
    setStructure(next);
  }} />;
}

describe('PageOrganizerQuestion', () => {
  it('previews existing selections and custom answers without writing until explicitly adopted', async () => {
    const onChange = vi.fn();
    const value = ['PARENT:Managed IT Services', 'Managed IT'];
    const otherValue = ['IT Compliance Consulting'];
    render(<PageOrganizerQuestion questionId="3" options={options} groupedOptions={services} value={value} otherValue={otherValue} min={1} max={15} onChange={onChange} />);

    expect(screen.getByText('3 pages')).toBeInTheDocument();
    expect(screen.getByText('2 / 15 counted selections · min 1')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /^Managed IT Services/ })).toBeChecked();
    expect(onChange).not.toHaveBeenCalled();
    await user().click(screen.getByRole('button', { name: 'Organize pages' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(projectPageStructure(onChange.mock.calls[0][0])).toEqual({
      selections: ['Managed IT Services', 'Managed IT'], otherValues: otherValue
    });
    expect(value).toEqual(['PARENT:Managed IT Services', 'Managed IT']);
    expect(otherValue).toEqual(['IT Compliance Consulting']);
  });

  it('adds catalog and custom pages to the same organizer and moves a custom page under a selected parent', async () => {
    const onChange = vi.fn();
    const input = user();
    render(<Controlled questionId="4" options={['Healthcare', 'Legal']} onChange={onChange} max={10} />);

    await input.click(screen.getByRole('checkbox', { name: 'Healthcare' }));
    await input.type(screen.getByRole('textbox', { name: 'Add a custom page' }), 'Independent Clinics');
    await input.click(screen.getByRole('button', { name: 'Add page' }));
    const selected = onChange.mock.lastCall[0];
    const parentId = selected.pages.find((page) => page.label === 'Healthcare').id;
    await input.selectOptions(screen.getByRole('combobox', { name: 'Parent page for Independent Clinics' }), parentId);

    const result = onChange.mock.lastCall[0];
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].children[0]).toMatchObject({ label: 'Independent Clinics', source: 'custom', catalogId: null, children: [] });
    expect(projectPageStructure(result)).toEqual({ selections: ['Healthcare'], otherValues: ['Independent Clinics'] });
    expect(screen.getByText('2 pages')).toBeInTheDocument();
    expect(screen.getByText('2 / 10 counted selections')).toBeInTheDocument();
  });

  it('keeps child pages and their identities when their parent is removed', async () => {
    const onChange = vi.fn();
    const child = predefined('Managed IT');
    const otherChild = custom('IT Compliance');
    const original = tree([{ ...predefined('Managed IT Services', 'parent'), children: [child, otherChild] }, predefined('Cloud Services', 'parent')]);
    const snapshot = JSON.stringify(original);
    render(<Controlled questionId="3" options={options} groupedOptions={services} structure={original} onChange={onChange} />);

    await user().click(screen.getByRole('button', { name: 'Remove Managed IT Services' }));

    expect(onChange.mock.lastCall[0].pages).toEqual([child, otherChild, predefined('Cloud Services', 'parent')]);
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(screen.getByRole('combobox', { name: 'Parent page for Managed IT' })).toHaveValue('');
  });

  it('preserves all children as top-level pages when moving their parent under another page', async () => {
    const onChange = vi.fn();
    const child = predefined('Managed IT');
    const parent = { ...predefined('Managed IT Services', 'parent'), children: [child] };
    const destination = custom('Business Solutions');
    const original = tree([parent, destination]);
    render(<Controlled questionId="3" options={options} groupedOptions={services} structure={original} onChange={onChange} max={15} />);

    await user().selectOptions(screen.getByRole('combobox', { name: 'Parent page for Managed IT Services' }), destination.id);

    const result = onChange.mock.lastCall[0];
    expect(result.pages[0]).toEqual(child);
    expect(result.pages[1]).toEqual({ ...destination, children: [{ ...parent, children: [] }] });
    expect(flattenPageStructure(result).map((page) => page.id).sort()).toEqual(flattenPageStructure(original).map((page) => page.id).sort());
    expect(countPageSelections(result, '3', services)).toBe(2);
    expect(screen.getByText('2 / 15 counted selections')).toBeInTheDocument();
  });

  it('ranks siblings independently and carries the entire child list when a parent moves', async () => {
    const input = user();
    const onChange = vi.fn();
    const managed = { ...predefined('Managed IT Services', 'parent'), children: [predefined('Managed IT'), predefined('On-Site Support')] };
    const cloud = predefined('Cloud Services', 'parent');
    render(<Controlled questionId="3" options={options} groupedOptions={services} structure={tree([managed, cloud])} onChange={onChange} />);

    expect(screen.getByRole('button', { name: 'Move Managed IT Services up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move On-Site Support down' })).toBeDisabled();
    await input.click(screen.getByRole('button', { name: 'Move On-Site Support up' }));
    expect(onChange.mock.lastCall[0].pages[0].children.map((page) => page.label)).toEqual(['On-Site Support', 'Managed IT']);
    await input.click(screen.getByRole('button', { name: 'Move Cloud Services up' }));

    const result = onChange.mock.lastCall[0];
    expect(result.pages.map((page) => page.label)).toEqual(['Cloud Services', 'Managed IT Services']);
    expect(result.pages[1].children.map((page) => page.label)).toEqual(['On-Site Support', 'Managed IT']);
    expect(screen.getByRole('button', { name: 'Move Cloud Services up' })).toBeDisabled();
  });

  it('enforces selection caps by original catalog identity and still allows organization and removal', async () => {
    const input = user();
    const onChange = vi.fn();
    const selected = custom('Custom Service');
    render(<Controlled questionId="3" options={options} groupedOptions={services} structure={tree([selected])} onChange={onChange} max={1} externalDisabled remainingSelections={0} />);

    expect(screen.getByRole('checkbox', { name: 'Managed IT' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /^Managed IT Services/ })).toBeEnabled();
    await input.click(screen.getByRole('checkbox', { name: /^Managed IT Services/ }));
    const parentId = onChange.mock.lastCall[0].pages.find((page) => page.label === 'Managed IT Services').id;
    await input.selectOptions(screen.getByRole('combobox', { name: 'Parent page for Custom Service' }), parentId);
    expect(screen.getByText('1 / 1 counted selections')).toBeInTheDocument();
    expect(screen.getByText('2 pages')).toBeInTheDocument();
    await input.click(screen.getByRole('button', { name: 'Remove Custom Service' }));
    expect(countPageSelections(onChange.mock.lastCall[0], '3', services)).toBe(0);
  });

  it('uses remaining combined capacity to prevent additions without losing the entered custom label', async () => {
    const input = user();
    const onChange = vi.fn();
    render(<PageOrganizerQuestion questionId="4" options={['Healthcare']} value={[]} onChange={onChange} max={10} remainingSelections={0} />);
    expect(screen.getByRole('checkbox', { name: 'Healthcare' })).toBeDisabled();
    await input.type(screen.getByRole('textbox', { name: 'Add a custom page' }), 'Education');
    await input.keyboard('{Enter}');

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('selection limit is reached');
    expect(screen.getByRole('textbox', { name: 'Add a custom page' })).toHaveValue('Education');
  });

  it('filters catalog choices and blocks duplicate custom pages', async () => {
    const input = user();
    const onChange = vi.fn();
    render(<Controlled questionId="4" options={['Healthcare', 'Legal']} value={['Healthcare']} onChange={onChange} />);
    await input.type(screen.getByRole('searchbox', { name: 'Search available pages' }), 'Legal');
    expect(screen.queryByRole('checkbox', { name: 'Healthcare' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Legal' })).toBeInTheDocument();
    await input.type(screen.getByRole('textbox', { name: 'Add a custom page' }), ' healthcare ');
    await input.click(screen.getByRole('button', { name: 'Add page' }));

    expect(screen.getByRole('alert')).toHaveTextContent('already in your list');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows unsupported data for review without overwriting existing answers', () => {
    const onChange = vi.fn();
    const structure = { format: 'future-format', pages: [] };
    render(<PageOrganizerQuestion questionId="4" options={['Healthcare']} structure={structure} onChange={onChange} />);

    expect(screen.getByRole('alert')).toHaveTextContent('They have been preserved');
    expect(screen.queryByRole('button', { name: 'Organize pages' })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(structure.format).toBe('future-format');
  });

  it('preserves an explicitly null structure for review instead of treating it as a legacy answer', () => {
    const onChange = vi.fn();
    render(<PageOrganizerQuestion questionId="4" options={['Healthcare']} value={['Healthcare']} structure={null} onChange={onChange} />);

    expect(screen.getByRole('alert')).toHaveTextContent('They have been preserved');
    expect(screen.queryByRole('checkbox', { name: 'Healthcare' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Organize pages' })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('has stable initial layout IDs without automatically adopting a legacy draft', () => {
    const onChange = vi.fn();
    const value = ['Managed IT'];
    const initial = createPageStructure('3', value, '', services, options);
    const { rerender } = render(<PageOrganizerQuestion questionId="3" options={options} groupedOptions={services} value={value} onChange={onChange} />);
    rerender(<PageOrganizerQuestion questionId="3" options={options} groupedOptions={services} value={[...value]} onChange={onChange} />);

    const handles = screen.getAllByRole('button', { name: /^Drag / });
    expect(handles.map((handle) => handle.getAttribute('data-rfd-drag-handle-draggable-id'))).toEqual(flattenPageStructure(initial).map((page) => page.id));
    expect(onChange).not.toHaveBeenCalled();
  });
});
