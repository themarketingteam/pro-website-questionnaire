import React, { useState } from 'react';
export default function LocalGeographicQuestion({ selectedLocations: value = [], onAdd, onRemove, onSetPrimary, primaryIndex = 0, maxLocations = 5, externalDisabled }) {
  const [name, setName] = useState('');
  return <div className="space-y-3">
    <p className="text-sm text-slate-500">Local preview: enter a location manually. Google Places is disconnected.</p>
    {value.map((item, index) => <div key={index} className="flex items-center justify-between rounded-lg border bg-white p-3"><span>{item.label || item.name || String(item)} {index === primaryIndex && <small className="ml-2 text-blue-600">Primary</small>}</span><div className="flex gap-3"><button type="button" className="text-sm text-blue-600" onClick={() => onSetPrimary(index)}>Set primary</button><button type="button" className="text-sm text-red-600" onClick={() => onRemove(index)}>Remove</button></div></div>)}
    <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (!name.trim()) return; onAdd({ name: name.trim(), label: name.trim(), source: 'manual', place_id: `local-${Date.now()}`, lat: null, lon: null }); setName(''); }}>
      <input aria-label="Local location" className="min-w-0 flex-1 rounded-lg border p-3" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Louisville, KY" />
      <button className="rounded-lg bg-[#1C82DE] px-4 text-white disabled:opacity-40" disabled={!name.trim() || value.length >= maxLocations || externalDisabled}>Add location</button>
    </form>
  </div>;
}
