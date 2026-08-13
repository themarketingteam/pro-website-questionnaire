import { Check } from 'lucide-react';
import {
  analyzeServiceSelections,
  canonicalizeServiceSelectionState,
  serviceParentSelection
} from '@/lib/serviceSelectionModel';

export default function CheckboxQuestion({ 
  options, 
  groupedOptions,
  value = [], 
  onChange, 
  min, 
  max,
  showOther = false,
  otherValue = '',
  onOtherChange,
  columns = 2,
  allowCategorySelection = false,
  externalDisabled = false
}) {
  // Use multi-other when there's a max limit
  const multiOther = showOther && max;
  const multiOtherMax = max || 10;
  const serviceSelectionState = allowCategorySelection && groupedOptions
    ? analyzeServiceSelections(value, groupedOptions)
    : null;
  const currentValue = serviceSelectionState?.canonicalSelections || value;
  
  const handleToggle = (option) => {
    const newValue = currentValue.includes(option)
      ? currentValue.filter(v => v !== option)
      : [...currentValue, option];
    
    // Enforce max limit
    if (!currentValue.includes(option) && max && totalSelections >= max) return;
    
    onChange(
      allowCategorySelection && groupedOptions
        ? canonicalizeServiceSelectionState(newValue, groupedOptions)
        : newValue
    );
  };

  const handleCategoryToggle = (categoryName) => {
    const categoryPrefix = serviceParentSelection(categoryName);
    const categoryOptions = groupedOptions[categoryName] || [];
    const categoryIsSelected = isCategorySelected(categoryName);
    
    if (categoryIsSelected) {
      onChange(currentValue.filter(
        (selection) => selection !== categoryPrefix && !categoryOptions.includes(selection)
      ));
    } else {
      onChange(canonicalizeServiceSelectionState(
        [...currentValue, categoryPrefix],
        groupedOptions
      ));
    }
  };

  const isCategorySelected = (categoryName) => {
    return serviceSelectionState?.selectedParents.has(categoryName) || false;
  };

  const isIndividualDisabled = (categoryName) => {
    return allowCategorySelection && !isCategorySelected(categoryName);
  };

  // Count other entries for max calculation
  const otherEntriesCount = multiOther 
    ? (Array.isArray(otherValue) ? otherValue.filter(v => v.trim()).length : 0)
    : (otherValue?.trim() ? 1 : 0);

  const mainSelectionsCount = serviceSelectionState
    ? serviceSelectionState.countedChildSelections
    : currentValue.length;
  const totalSelections = mainSelectionsCount + otherEntriesCount;

  const isDisabled = (option) => {
    if (externalDisabled && !currentValue.includes(option)) return true;
    if (!max) return false;
    return totalSelections >= max && !currentValue.includes(option);
  };

  const canAddMoreOther = !externalDisabled && (!max || totalSelections < max);

  return (
    <div className="space-y-4">
      {(min || max) && (
        <span className={`text-sm font-medium block ${
          totalSelections < (min || 0) ? 'text-[#F29100]' : 
          totalSelections > (max || Infinity) ? 'text-red-600' : 'text-[#566C75]'
        }`}>
          {totalSelections} / {max || '∞'} {allowCategorySelection ? 'service selections' : 'selections'}
          {min && ` (minimum ${min})`}
          {allowCategorySelection && ' — parent pages do not count'}
        </span>
      )}
      
      {groupedOptions ? (
        <div className="space-y-6">
          {Object.entries(groupedOptions).map(([groupName, groupOptions]) => {
            const categorySelected = isCategorySelected(groupName);
            const individualOptionsDisabled = isIndividualDisabled(groupName);
            
            return (
              <div key={groupName} className={`border-2 rounded-lg p-4 transition-all ${
                categorySelected ? 'border-[#90C944] bg-[#F0F8E8]' : 'border-[#E8EBED]'
              }`}>
                <h4 className="text-xs font-semibold text-[#566C75] uppercase tracking-wide mb-3">{groupName}</h4>
                
                {allowCategorySelection && (
                  <button
                    type="button"
                    onClick={() => handleCategoryToggle(groupName)}
                    aria-pressed={categorySelected}
                    className={`flex w-full items-center gap-3 p-4 border-2 rounded-lg text-left transition-all mb-3 ${
                      categorySelected
                        ? 'border-[#90C944] bg-[#90C944] ring-2 ring-[#90C944]/30'
                        : 'border-[#C1C6C8] hover:border-[#90C944] hover:bg-[#F0F8E8]'
                    }`}
                  >
                    <div className={`w-6 h-6 flex-shrink-0 rounded border-2 flex items-center justify-center transition-all ${
                      categorySelected 
                        ? 'border-white bg-white' 
                        : 'border-[#A9AAAC]'
                    }`}>
                      {categorySelected && <Check className="w-4 h-4 text-[#90C944]" />}
                    </div>
                    <span className={`select-none font-semibold ${
                      categorySelected ? 'text-white' : 'text-[#122947]'
                    }`}>
                      {groupName}
                    </span>
                  </button>
                )}

                {allowCategorySelection && categorySelected &&
                  !categoryOptionsHaveSelection(groupOptions, currentValue) && (
                    <p className="mb-3 text-xs font-medium text-[#D37E00]">
                      Select at least one service under this parent page.
                    </p>
                  )}
                
                <div className={columns === 3 ? 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2' : 'grid grid-cols-1 sm:grid-cols-2 gap-2'}>
                  {groupOptions.map((option) => {
                    const optionDisabled = isDisabled(option) || individualOptionsDisabled;
                    
                    return (
                      <button
                        type="button"
                        key={option}
                        onClick={() => !optionDisabled && handleToggle(option)}
                        disabled={optionDisabled}
                        aria-pressed={currentValue.includes(option)}
                        className={`flex items-center gap-3 p-3 min-h-[44px] border rounded text-left transition-all ${
                          currentValue.includes(option)
                            ? 'border-[#1C82DE] bg-[#E8F3FC] ring-2 ring-[#1C82DE]/20'
                            : optionDisabled
                            ? 'border-[#E8EBED] bg-[#E8EBED] cursor-not-allowed opacity-50'
                            : 'border-[#C1C6C8] hover:border-[#A9AAAC] hover:bg-gray-50'
                        }`}
                      >
                        <div className={`w-5 h-5 flex-shrink-0 rounded border-2 flex items-center justify-center transition-all ${
                          currentValue.includes(option)
                            ? 'border-[#1C82DE] bg-[#1C82DE]' 
                            : 'border-[#A9AAAC]'
                        }`}>
                          {currentValue.includes(option) && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <span className={`select-none text-sm ${
                          currentValue.includes(option) ? 'text-[#1C82DE] font-medium' : 'text-[#1E3950]'
                        }`}>
                          {option}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={columns === 3 ? 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5' : 'grid grid-cols-1 sm:grid-cols-2 gap-2.5'}>
          {options.map((option) => (
            <button
              type="button"
              key={option}
              onClick={() => !isDisabled(option) && handleToggle(option)}
              disabled={isDisabled(option)}
              aria-pressed={currentValue.includes(option)}
              className={`flex items-center gap-3 p-4 min-h-[44px] border rounded text-left transition-all ${
                currentValue.includes(option)
                  ? 'border-[#1C82DE] bg-[#E8F3FC] ring-2 ring-[#1C82DE]/20'
                  : isDisabled(option)
                  ? 'border-[#E8EBED] bg-[#E8EBED] cursor-not-allowed opacity-50'
                  : 'border-[#C1C6C8] hover:border-[#A9AAAC] hover:bg-gray-50'
              }`}
            >
              <div className={`w-5 h-5 flex-shrink-0 rounded border-2 flex items-center justify-center transition-all ${
                currentValue.includes(option)
                  ? 'border-[#1C82DE] bg-[#1C82DE]' 
                  : 'border-[#A9AAAC]'
              }`}>
                {currentValue.includes(option) && <Check className="w-3 h-3 text-white" />}
              </div>
              <span className={`select-none text-sm ${
                currentValue.includes(option) ? 'text-[#1C82DE] font-medium' : 'text-[#1E3950]'
              }`}>
                {option}
              </span>
            </button>
          ))}
        </div>
      )}
      
      {showOther && !multiOther && (
        <div className="bg-gray-50 border border-[#C1C6C8] rounded p-4 transition-all">
          <label className="block">
            <span className="font-semibold text-[#122947] text-sm">Other (please specify):</span>
            <span className="text-xs text-[#566C75] block mt-1">
              Enter a single option only (no commas or multiple items)
            </span>
            <input
              type="text"
              placeholder="Enter one option only..."
              className="w-full mt-3 p-3 border border-[#C1C6C8] rounded focus:outline-none focus:ring-2 focus:ring-[#1C82DE] focus:border-transparent"
              value={otherValue}
              onChange={(e) => onOtherChange(e.target.value)}
            />
          </label>
        </div>
      )}

      {showOther && multiOther && (
        <div className="bg-gray-50 border border-[#C1C6C8] rounded p-4 transition-all">
          <div className="mb-3">
            <span className="font-semibold text-[#122947] text-sm">Other (please specify):</span>
            <span className="text-xs text-[#566C75] block mt-1">
              Add custom services not listed above (up to {multiOtherMax} entries). Each counts toward your selection limit.
            </span>
          </div>
          <div className="space-y-2">
            {(Array.isArray(otherValue) ? otherValue : ['']).map((entry, idx) => (
              <div key={idx} className="flex gap-2">
                <input
                  type="text"
                  placeholder={`e.g., "Mac Certified Technician"`}
                  className="flex-1 p-3 border border-[#C1C6C8] rounded focus:outline-none focus:ring-2 focus:ring-[#1C82DE] focus:border-transparent text-sm"
                  value={entry}
                  onChange={(e) => {
                    const newOther = [...(Array.isArray(otherValue) ? otherValue : [''])];
                    newOther[idx] = e.target.value;
                    onOtherChange(newOther);
                  }}
                />
                {(Array.isArray(otherValue) ? otherValue : ['']).length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      const newOther = (Array.isArray(otherValue) ? otherValue : ['']).filter((_, i) => i !== idx);
                      onOtherChange(newOther.length ? newOther : ['']);
                    }}
                    className="px-3 py-2 text-red-500 hover:bg-red-50 rounded transition-colors"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {(Array.isArray(otherValue) ? otherValue : ['']).length < multiOtherMax && canAddMoreOther && (
              <button
                type="button"
                onClick={() => {
                  const newOther = [...(Array.isArray(otherValue) ? otherValue : ['']), ''];
                  onOtherChange(newOther);
                }}
                className="text-sm text-[#1C82DE] hover:text-[#075DA7] font-medium mt-2"
              >
                + Add another
              </button>
            )}
          </div>
        </div>
      )}
      
      </div>
      );
      }

function categoryOptionsHaveSelection(groupOptions, value) {
  return groupOptions.some((option) => value.includes(option));
}
