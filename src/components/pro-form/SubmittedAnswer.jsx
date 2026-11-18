/** Saved answers are rendered as text, so review never mounts editing or upload controls. */
const title = (key) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, value => value.toUpperCase());
const empty = value => value == null || value === '' || (Array.isArray(value) && value.length === 0);
function AnswerValue({ value }) {
  if (empty(value)) return <span className="text-slate-500">No answer provided.</span>;
  if (Array.isArray(value)) return <ul className="list-disc space-y-2 pl-5">{value.map((item, index) => <li key={index}><AnswerValue value={item} /></li>)}</ul>;
  if (typeof value === 'object') return <dl className="space-y-2">{Object.entries(value).filter(([key, item]) => !['id', 'catalogId'].includes(key) && !empty(item)).map(([key, item]) => <div key={key}><dt className="font-semibold">{title(key)}</dt><dd className="ml-3"><AnswerValue value={item} /></dd></div>)}</dl>;
  const text = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
  if (/^https?:\/\/[^\s]+$/i.test(text)) return <a href={text} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-blue-800 underline">{text}</a>;
  return <span className="whitespace-pre-wrap break-words">{text}</span>;
}
export default function SubmittedAnswer({ question, responses }) {
  const tree = responses[`${question.id}_structure`];
  const other = responses[`${question.id}_other`];
  return <div aria-label={`Submitted answer to question ${question.id}`} className="rounded-lg border border-slate-200 bg-white p-4 text-slate-800 select-text">
    {tree?.pages ? <ol className="list-decimal space-y-4 pl-6">{tree.pages.map((page, index) => <li key={page.id || index}><span className="font-semibold">{page.label}</span>{page.children?.length > 0 && <ol className="mt-2 list-decimal space-y-2 pl-6">{page.children.map((child, childIndex) => <li key={child.id || childIndex}>{child.label}</li>)}</ol>}</li>)}</ol> : <><AnswerValue value={responses[question.id]} />{!empty(other) && <div className="mt-3"><p className="font-semibold">Additional answers</p><AnswerValue value={other} /></div>}</>}
    {question.id === '5' && responses['5_primary'] != null && <p className="mt-3 text-sm text-slate-600">Primary location: {Number(responses['5_primary']) + 1}</p>}
  </div>;
}
