function slugify(text = '') {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export default function RadioQuestion({
  options,
  value,
  onChange,
  showOther = false,
  otherValue = '',
  onOtherChange,
  otherPlaceholder = 'Please specify...',
  groupName,
  inputIdBase,
}) {
  // Legacy handling: if value is a custom string not in options and showOther is enabled, treat as "Other"
  const inOptions = Array.isArray(options) && options.includes(value);
  const isLegacyOtherSelected = showOther && !!value && !inOptions && value !== 'Other';
  const isOtherSelected = showOther && (value === 'Other' || isLegacyOtherSelected);
  const effectiveOtherValue = otherValue || (isLegacyOtherSelected ? String(value) : '');

  return (
    <div className="space-y-2.5">
      {options.map((option) => {
        const optionId = `${inputIdBase || 'radio'}_${slugify(option)}`;
        const checked = value === option;
        return (
          <label
            key={option}
            htmlFor={optionId}
            className={`flex items-center gap-3 p-4 border rounded cursor-pointer transition-all ${
              checked
                ? 'border-[#1C82DE] bg-[#E8F3FC] ring-2 ring-[#1C82DE]/20'
                : 'border-[#C1C6C8] hover:border-[#A9AAAC] hover:bg-gray-50'
            }`}
          >
            <input
              id={optionId}
              type="radio"
              name={groupName || inputIdBase || 'radio'}
              checked={checked}
              onChange={() => {
                onChange(option);

                const shouldClearOther =
                  showOther &&
                  onOtherChange &&
                  (value === 'Other' || isLegacyOtherSelected || !!otherValue);

                if (shouldClearOther) {
                  onOtherChange('');
                }
              }}
              className="sr-only"
            />
            <div
              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                checked ? 'border-[#1C82DE] bg-[#1C82DE]' : 'border-[#A9AAAC]'
              }`}
            >
              {checked && <div className="w-2 h-2 rounded-full bg-white" />}
            </div>
            <span
              className={`select-none ${
                checked ? 'text-[#1C82DE] font-medium' : 'text-[#1E3950]'
              }`}
            >
              {option}
            </span>
          </label>
        );
      })}

      {showOther && (
        <div className="bg-gray-50 border border-[#C1C6C8] rounded p-4 transition-all">
          {(() => {
            const otherId = `${inputIdBase || 'radio'}_other`;
            return (
              <>
                <label
                  htmlFor={otherId}
                  className={`flex items-center gap-3 p-0 cursor-pointer`}
                >
                  <input
                    id={otherId}
                    type="radio"
                    name={groupName || inputIdBase || 'radio'}
                    checked={!!isOtherSelected}
                    onChange={() => {
                      onChange('Other');
                    }}
                    className="sr-only"
                  />
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                      isOtherSelected ? 'border-[#1C82DE] bg-[#1C82DE]' : 'border-[#A9AAAC]'
                    }`}
                  >
                    {isOtherSelected && <div className="w-2 h-2 rounded-full bg-white" />}
                  </div>
                  <span
                    className={`select-none ${
                      isOtherSelected ? 'text-[#1C82DE] font-medium' : 'text-[#1E3950]'
                    }`}
                  >
                    Other
                  </span>
                </label>

                {(isOtherSelected || isLegacyOtherSelected) && (
                  <div className="mt-3">
                    <label className="block">
                      <span className="font-semibold text-[#122947] text-sm">Other (please specify):</span>
                      <input
                        type="text"
                        placeholder={otherPlaceholder}
                        className="w-full mt-2 p-3 border border-[#C1C6C8] rounded focus:outline-none focus:ring-2 focus:ring-[#1C82DE] focus:border-transparent"
                        value={effectiveOtherValue}
                        onChange={(e) => {
                          if (onOtherChange) onOtherChange(e.target.value);
                        }}
                      />
                    </label>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}