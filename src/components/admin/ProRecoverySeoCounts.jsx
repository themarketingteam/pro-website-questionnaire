export default function ProRecoverySeoCounts({ counts }) {
  return <section aria-label="SEO page counts" className="mt-4 space-y-2 border-t border-slate-200 pt-3 text-sm">
    {[
      ['Services', 'services', 15], ['Industries', 'industries', 10], ['Locations', 'locations', 5], ['Total SEO', 'total', 25]
    ].map(([label, key, limit]) => <p key={key}><span className="font-medium">{label}:</span> <span aria-label={`${label} count`}>{Number.isInteger(counts?.[key]) ? counts[key] : '—'} / {limit}</span></p>)}
  </section>;
}
