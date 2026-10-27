import { useMemo, useState } from 'react';
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import { ArrowDown, ArrowUp, ChevronDown, GripVertical, Layers3, Plus, Search, X } from 'lucide-react';
import {
  addPage,
  countPageSelections,
  createPageNode,
  createPageStructure,
  flattenPageStructure,
  getPageCatalogId,
  movePage,
  normalizePageStructure,
  removePage
} from '@/lib/pageOrganizerModel';

const controlClass = 'min-h-[40px] rounded-md border border-[#C1C6C8] bg-white text-sm text-[#1E3950] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1C82DE] disabled:cursor-not-allowed disabled:opacity-40';
const iconButtonClass = `${controlClass} inline-flex h-10 w-10 shrink-0 items-center justify-center hover:border-[#1C82DE] hover:bg-[#E8F3FC]`;
const sameLabel = (left, right) => left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();

export default function PageOrganizerQuestion({
  questionId,
  options = [],
  groupedOptions,
  value = [],
  otherValue = '',
  structure,
  onChange,
  min,
  max,
  externalDisabled = false,
  remainingSelections
}) {
  const [query, setQuery] = useState('');
  const [customLabel, setCustomLabel] = useState('');
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const prepared = useMemo(() => {
    try {
      return { current: structure !== undefined ? normalizePageStructure(structure) : createPageStructure(
        questionId, value, otherValue, groupedOptions || {}, options
      ) };
    } catch (issue) {
      return { error: issue.message };
    }
  }, [structure, questionId, value, otherValue, groupedOptions, options]);
  const current = prepared.current;
  if (!current) return <p role="alert" className="rounded-lg border border-[#F29100] bg-[#FFF4E4] p-4 text-sm text-[#A45B00]">Your existing answers need review before they can be organized. They have been preserved. {prepared.error}</p>;
  const allPages = flattenPageStructure(current);
  const countedSelections = countPageSelections(current, questionId, groupedOptions || {});
  const selectedCatalog = new Map(allPages
    .filter((page) => page.source === 'predefined')
    .map((page) => [page.catalogId, page]));
  const searchText = query.trim().toLocaleLowerCase();
  const grouped = groupedOptions && Object.keys(groupedOptions).length > 0;
  const catalogGroups = grouped
    ? Object.entries(groupedOptions).map(([label, entries]) => ({ label, entries }))
    : [{ label: '', entries: options }];
  const rootDropId = `page-organizer-${questionId}-root`;

  const commit = (next, message) => {
    setError('');
    onChange(next);
    setAnnouncement(message);
  };

  const canAdd = (next) => {
    const added = countPageSelections(next, questionId, groupedOptions || {}) - countedSelections;
    return added <= 0 || (
      !externalDisabled
      && (!Number.isFinite(max) || countedSelections + added <= max)
      && (!Number.isFinite(remainingSelections) || added <= remainingSelections)
    );
  };

  const makeCatalogPage = (label, kind) => createPageNode(questionId, label, {
    source: 'predefined',
    catalogId: getPageCatalogId(questionId, label, kind)
  });

  const toggleCatalog = (label, kind = 'option') => {
    const existing = selectedCatalog.get(getPageCatalogId(questionId, label, kind));
    if (existing) {
      commit(removePage(current, existing.id), `${label} removed. Its child pages stay in the list.`);
      return;
    }
    try {
      const next = addPage(current, makeCatalogPage(label, kind));
      if (canAdd(next)) commit(next, `${label} added as a top-level page.`);
    } catch (issue) {
      setError(issue.message);
    }
  };

  const addCustom = () => {
    const label = customLabel.trim();
    if (!label) return;
    if (allPages.some((page) => sameLabel(page.label, label))) {
      setError('This page is already in your list. Choose its parent or change its priority below.');
      return;
    }
    try {
      const next = addPage(current, createPageNode(questionId, label));
      if (!canAdd(next)) {
        setError('Your selection limit is reached. Remove a selection before adding another page.');
        return;
      }
      commit(next, `${label} added as a top-level page.`);
      setCustomLabel('');
    } catch (issue) {
      setError(issue.message);
    }
  };

  const reparent = (page, parentId) => {
    try {
      const next = parentId && page.children.length > 0
        ? addPage(removePage(current, page.id), { ...page, children: [] }, parentId)
        : movePage(current, page.id, parentId || null);
      const parent = current.pages.find((item) => item.id === parentId);
      commit(next, `${page.label} moved ${parent ? `under ${parent.label}` : 'to the top level'}.`);
    } catch (issue) {
      setError(issue.message);
    }
  };

  const reorder = (page, parentId, index) => {
    commit(movePage(current, page.id, parentId, index), `${page.label} moved to priority ${index + 1}.`);
  };

  const onDragEnd = ({ source, destination, draggableId }) => {
    if (!destination || source.droppableId !== destination.droppableId || source.index === destination.index) return;
    const page = allPages.find((item) => item.id === draggableId);
    if (!page) return;
    const parent = current.pages.find((item) => item.children.some((child) => child.id === page.id));
    reorder(page, parent?.id || null, destination.index);
  };

  const catalogChoice = (label, kind = 'option') => {
    const catalogId = getPageCatalogId(questionId, label, kind);
    const checked = selectedCatalog.has(catalogId);
    let disabled = false;
    try {
      disabled = !checked && !canAdd(addPage(current, makeCatalogPage(label, kind)));
    } catch {
      disabled = !checked;
    }
    return (
      <label key={catalogId} className={`flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors ${
        checked ? 'border-[#1C82DE] bg-[#E8F3FC] text-[#122947]' : 'border-[#E8EBED] bg-white text-[#1E3950] hover:border-[#1C82DE]'
      } ${disabled ? 'cursor-not-allowed opacity-45' : ''}`}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={() => toggleCatalog(label, kind)}
          className="h-4 w-4 shrink-0 accent-[#1C82DE] focus-visible:ring-2 focus-visible:ring-[#1C82DE]"
        />
        <span className="min-w-0 break-words">{label}</span>
        {kind === 'parent' && <span className="ml-auto shrink-0 rounded bg-[#F0F8E8] px-1.5 py-0.5 text-[10px] font-medium text-[#456A1B]">Catalog parent</span>}
      </label>
    );
  };

  const renderPage = (page, index, siblings, parentId = null) => (
    <Draggable key={page.id} draggableId={page.id} index={index}>
      {(provided, snapshot) => (
        <div ref={provided.innerRef} {...provided.draggableProps} className={`rounded-lg border bg-white ${snapshot.isDragging ? 'border-[#1C82DE] shadow-lg' : 'border-[#DCE3E8]'} ${parentId ? 'ml-5 sm:ml-10' : ''}`}>
          <div className="flex flex-wrap items-center gap-2 px-2 py-3 sm:gap-3 sm:px-3">
            <button type="button" {...provided.dragHandleProps} aria-label={`Drag ${page.label} to change priority`} className="flex h-10 w-7 shrink-0 cursor-grab items-center justify-center rounded text-[#778B98] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1C82DE] active:cursor-grabbing">
              <GripVertical className="h-5 w-5" aria-hidden="true" />
            </button>
            <span aria-label={`Priority ${index + 1}`} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sm font-semibold ${parentId ? 'bg-[#EFF3F6] text-[#566C75]' : 'bg-[#122947] text-white'}`}>{index + 1}</span>
            <div className="min-w-0 flex-1 basis-[calc(100%-100px)] sm:basis-0">
              <p className="break-words text-sm font-semibold text-[#122947]">{page.label}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[#566C75]">
                <span>{parentId ? 'Child page' : page.children.length > 0 ? 'Parent page' : 'Top-level page'}</span>
                <span aria-hidden="true">·</span>
                <span>{page.source === 'custom' ? 'Custom' : 'From the list'}</span>
              </div>
            </div>
            <label className="ml-9 flex min-w-0 flex-1 basis-[calc(100%-36px)] flex-col gap-1 sm:ml-0 sm:max-w-[200px] sm:basis-auto">
              <span className="text-[11px] font-medium text-[#566C75]">Parent page<span className="sr-only"> for {page.label}</span></span>
              <select aria-label={`Parent page for ${page.label}`} value={parentId || ''} onChange={(event) => reparent(page, event.target.value)} className={`${controlClass} w-full min-w-0 px-2`}>
                <option value="">Top level (no parent)</option>
                {current.pages.filter((item) => item.id !== page.id).map((parent) => <option key={parent.id} value={parent.id}>{parent.label}</option>)}
              </select>
            </label>
            <div className="ml-auto flex items-center gap-1 pl-9 sm:pl-0">
              <button type="button" aria-label={`Move ${page.label} up`} disabled={index === 0} onClick={() => reorder(page, parentId, index - 1)} className={iconButtonClass}><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
              <button type="button" aria-label={`Move ${page.label} down`} disabled={index === siblings.length - 1} onClick={() => reorder(page, parentId, index + 1)} className={iconButtonClass}><ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
              <button type="button" aria-label={`Remove ${page.label}`} onClick={() => commit(removePage(current, page.id), `${page.label} removed. Its child pages stay in the list.`)} className={`${iconButtonClass} text-[#778B98] hover:border-red-400 hover:bg-red-50 hover:text-red-600`}><X className="h-4 w-4" aria-hidden="true" /></button>
            </div>
          </div>
          {!parentId && page.children.length > 0 && (
            <Droppable droppableId={`page-organizer-${questionId}-children-${page.id}`} type={`children-${questionId}-${page.id}`}>
              {(childrenProvided) => (
                <div ref={childrenProvided.innerRef} {...childrenProvided.droppableProps} className="space-y-2 border-t border-[#E8EBED] bg-[#F7F9FB] p-2 sm:p-3">
                  {page.children.map((child, childIndex) => renderPage(child, childIndex, page.children, page.id))}
                  {childrenProvided.placeholder}
                </div>
              )}
            </Droppable>
          )}
        </div>
      )}
    </Draggable>
  );

  return (
    <div className="space-y-5" data-testid={`page-organizer-${questionId}`}>
      <div className="rounded-xl border border-[#C9DDEC] bg-[#F4F9FD] p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <Layers3 className="mt-0.5 h-5 w-5 shrink-0 text-[#1C82DE]" aria-hidden="true" />
          <div>
            <h4 className="font-semibold text-[#122947]">Choose your pages. Set your priorities.</h4>
            <p className="mt-1 text-sm leading-relaxed text-[#566C75]">Select from the list or add a custom page, then organize everything below. Every item is a website page, including parent pages. A page can stand alone or have child pages.</p>
          </div>
        </div>
      </div>

      <details className="group rounded-xl border border-[#DCE3E8] bg-white" open>
        <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 font-semibold text-[#122947] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1C82DE]">
          Choose from the list<ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="space-y-4 border-t border-[#E8EBED] px-4 pb-4 pt-3">
          <label className="relative block">
            <span className="sr-only">Search available pages</span>
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[#778B98]" aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Search available pages…" className={`${controlClass} w-full py-2 pl-9 pr-3`} />
          </label>
          <div className="max-h-[340px] space-y-5 overflow-y-auto overscroll-contain pr-1">
            {catalogGroups.map(({ label, entries }) => {
              const matchesGroup = label.toLocaleLowerCase().includes(searchText);
              const visible = entries.filter((entry) => matchesGroup || entry.toLocaleLowerCase().includes(searchText));
              if (!matchesGroup && visible.length === 0) return null;
              return <div key={label || 'all'} className="space-y-2">
                {label && <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#566C75]">{label}</p>
                  {catalogChoice(label, 'parent')}
                </div>}
                <div className="grid gap-2 sm:grid-cols-2">{visible.map((entry) => catalogChoice(entry))}</div>
              </div>;
            })}
            {searchText && !catalogGroups.some(({ label, entries }) => label.toLocaleLowerCase().includes(searchText) || entries.some((entry) => entry.toLocaleLowerCase().includes(searchText))) && <p className="py-3 text-sm text-[#566C75]">No listed pages match. Add your own page below.</p>}
          </div>
        </div>
      </details>

      <div className="rounded-xl border border-dashed border-[#B9C9D7] bg-[#F7F9FB] p-4">
        <label htmlFor={`custom-page-${questionId}`} className="text-sm font-semibold text-[#122947]">Add a custom page</label>
        <p className="mt-1 text-xs text-[#566C75]">Enter one page at a time. You can use it as a parent or a child.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input id={`custom-page-${questionId}`} value={customLabel} maxLength={500} onChange={(event) => { setCustomLabel(event.target.value); setError(''); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustom(); } }} placeholder={String(questionId) === '3' ? 'e.g., IT Compliance Consulting' : 'e.g., Real Estate and Property Management'} className={`${controlClass} w-full min-w-0 flex-1 px-3 py-2`} />
          <button type="button" onClick={addCustom} disabled={!customLabel.trim()} className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-2 rounded-md bg-[#1C82DE] px-4 py-2 text-sm font-semibold text-white hover:bg-[#176BB7] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1C82DE] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"><Plus className="h-4 w-4" aria-hidden="true" />Add page</button>
        </div>
        {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      <section aria-label="Selected pages and priorities" className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="font-semibold text-[#122947]">Your pages, in priority order</h4>
            <p className="mt-1 text-xs leading-relaxed text-[#566C75]">Priority starts at 1 for top-level pages and restarts within each parent. Drag or use the arrows to rank siblings; choose a parent to move a page.</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 text-xs font-medium">
            <span className="rounded-full bg-[#EFF3F6] px-3 py-1.5 text-[#122947]">{allPages.length} {allPages.length === 1 ? 'page' : 'pages'}</span>
            <span className={`rounded-full px-3 py-1.5 ${countedSelections < (min || 0) || countedSelections > (max || Infinity) ? 'bg-[#FFF4E4] text-[#A45B00]' : 'bg-[#F0F8E8] text-[#456A1B]'}`}>{countedSelections}{max ? ` / ${max}` : ''} counted selections{min ? ` · min ${min}` : ''}</span>
          </div>
        </div>
        {grouped && <p className="text-xs text-[#566C75]">Original catalog parent pages do not count toward the service limit. All other pages count, wherever you place them.</p>}
        {externalDisabled && <p className="rounded-lg bg-[#FFF4E4] px-3 py-2 text-xs text-[#A45B00]">The combined selection limit is reached. You can still reorder, move, or remove pages.</p>}
        {structure === undefined && allPages.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#C9DDEC] bg-[#F4F9FD] p-3">
          <p className="flex-1 text-xs leading-relaxed text-[#566C75]">This is a suggested layout of your existing answers. Choose “Organize pages” or make a change to save it.</p>
          <button type="button" onClick={() => commit(current, 'Your page layout is ready to organize.')} className={`${controlClass} shrink-0 border-[#1C82DE] px-3 py-2 font-semibold text-[#1C82DE] hover:bg-[#E8F3FC]`}>Organize pages</button>
        </div>}
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId={rootDropId} type={`root-pages-${questionId}`}>
            {(provided) => <div ref={provided.innerRef} {...provided.droppableProps} className="min-h-[72px] space-y-3">
              {current.pages.map((page, index) => renderPage(page, index, current.pages))}
              {provided.placeholder}
              {allPages.length === 0 && <div className="rounded-xl border-2 border-dashed border-[#DCE3E8] px-4 py-8 text-center text-sm text-[#778B98]">Your selected and custom pages will appear here.</div>}
            </div>}
          </Droppable>
        </DragDropContext>
        {allPages.some((page) => page.children.length > 0) && <p className="text-xs leading-relaxed text-[#566C75]">Two levels are supported. If you remove a parent or move it under another page, its children stay as top-level pages.</p>}
      </section>
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</p>
    </div>
  );
}
