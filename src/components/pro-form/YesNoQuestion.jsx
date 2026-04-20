export default function YesNoQuestion({ value, onChange, groupName, inputIdBase }) {
  // If value is undefined/null, don't default to 'no' - let user choose
  const hasValue = value === 'yes' || value === 'no';
  
  return (
    <div className="flex gap-4">
      <label className={`flex-1 flex items-center justify-center gap-2 p-4 border rounded-xl cursor-pointer transition-all ${
          value === 'yes' 
            ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500/20' 
            : !hasValue
            ? 'border-slate-300 hover:border-blue-400 hover:bg-blue-50/30'
            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
        }`} htmlFor={`${inputIdBase}_yes`}>
        <input
          type="radio"
          id={`${inputIdBase}_yes`}
          name={groupName}
          checked={value === 'yes'}
          onChange={() => onChange('yes')}
          className="sr-only"
        />
        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
          value === 'yes' ? 'border-blue-500 bg-blue-500' : 'border-slate-300'
        }`}>
          {value === 'yes' && <div className="w-2 h-2 rounded-full bg-white" />}
        </div>
        <span id={`${inputIdBase}_yes_label`} className={`font-medium ${value === 'yes' ? 'text-blue-700' : 'text-slate-700'}`}>
          Yes
        </span>
      </label>
      
      <label className={`flex-1 flex items-center justify-center gap-2 p-4 border rounded-xl cursor-pointer transition-all ${
          value === 'no' 
            ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500/20' 
            : !hasValue
            ? 'border-slate-300 hover:border-blue-400 hover:bg-blue-50/30'
            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
        }`} htmlFor={`${inputIdBase}_no`}>
        <input
          type="radio"
          id={`${inputIdBase}_no`}
          name={groupName}
          checked={value === 'no'}
          onChange={() => onChange('no')}
          className="sr-only"
        />
        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
          value === 'no' ? 'border-blue-500 bg-blue-500' : 'border-slate-300'
        }`}>
          {value === 'no' && <div className="w-2 h-2 rounded-full bg-white" />}
        </div>
        <span id={`${inputIdBase}_no_label`} className={`font-medium ${value === 'no' ? 'text-blue-700' : 'text-slate-700'}`}>
          No
        </span>
      </label>
    </div>
  );
}