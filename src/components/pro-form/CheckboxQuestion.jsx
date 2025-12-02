import React from 'react';
import { Check } from 'lucide-react';

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
  allowCategorySelection = false
}) {
  // Use multi-other when there's a max limit
  const multiOther = showOther && max;
  const multiOtherMax = max || 10;
  
  const handleToggle = (option) => {
    const newValue = value.includes(option)
      ? value.filter(v => v !== option)
      : [...value, option];
    
    // Enforce max limit
    if (max && newValue.length > max) return;
    
    onChange(newValue);
  };

  const handleCategoryToggle = (categoryName) => {
    const categoryPrefix = `CATEGORY:${categoryName}`;
    const categoryOptions = groupedOptions[categoryName];
    
    // Check if category is currently selected
    const isCategorySelected = value.includes(categoryPrefix);
    
    if (isCategorySelected) {
      // Deselect category
      onChange(value.filter(v => v !== categoryPrefix));
    } else {
      // Select category and remove any individual selections from that category
      const newValue = value.filter(v => !categoryOptions.includes(v));
      newValue.push(categoryPrefix);
      
      // Enforce max limit
      if (max && newValue.length > max) return;
      
      onChange(newValue);
    }
  };

  const isCategorySelected = (categoryName) => {
    return value.includes(`CATEGORY:${categoryName}`);
  };

  const isIndividualDisabled = (categoryName) => {
    return isCategorySelected(categoryName);
  };

  // Count other entries for max calculation
  const otherEntriesCount = multiOther 
    ? (Array.isArray(otherValue) ? otherValue.filter(v => v.trim()).length : 0)
    : (otherValue?.trim() ? 1 : 0);

  const totalSelections = value.length + otherEntriesCount;

  const isDisabled = (option) => {
    if (!max) return false;
    return totalSelections >= max && !value.includes(option);
  };

  const canAddMoreOther = !max || totalSelections < max;

  return (
    <div className="space-y-4">
      {(min || max) && (
        <span className={`text-sm font-medium block ${
          totalSelections < (min || 0) ? 'text-[#F29100]' : 
          totalSelections > (max || Infinity) ? 'text-red-600' : 'text-[#566C75]'
        }`}>
          {totalSelections} / {max || '∞'} selections
          {min && ` (minimum ${min})`}
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
                {allowCategorySelection && (
                  <div 
                    onClick={() => handleCategoryToggle(groupName)}
                    className={`flex items-center gap-3 p-4 border-2 rounded-lg cursor-pointer transition-all mb-3 ${
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
                      {groupName} (All Services)
                    </span>
                  </div>
                )}
                
                {!allowCategorySelection && (
                  <h4 className="text-xs font-semibold text-[#566C75] uppercase tracking-wide mb-3">{groupName}</h4>
                )}
                
                <div className={columns === 3 ? 'grid grid-cols-1 md:grid-cols-3 gap-2' : 'grid grid-cols-1 md:grid-cols-2 gap-2'}>
                  {groupOptions.map((option) => {
                    const optionDisabled = isDisabled(option) || individualOptionsDisabled;
                    
                    return (
                      <div 
                        key={option}
                        onClick={() => !optionDisabled && handleToggle(option)}
                        className={`flex items-center gap-3 p-3 border rounded cursor-pointer transition-all ${
                          value.includes(option)
                            ? 'border-[#1C82DE] bg-[#E8F3FC] ring-2 ring-[#1C82DE]/20'
                            : optionDisabled
                            ? 'border-[#E8EBED] bg-[#E8EBED] cursor-not-allowed opacity-50'
                            : 'border-[#C1C6C8] hover:border-[#A9AAAC] hover:bg-gray-50'
                        }`}
                      >
                        <div className={`w-5 h-5 flex-shrink-0 rounded border-2 flex items-center justify-center transition-all ${
                          value.includes(option) 
                            ? 'border-[#1C82DE] bg-[#1C82DE]' 
                            : 'border-[#A9AAAC]'
                        }`}>
                          {value.includes(option) && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <span className={`select-none text-sm ${
                          value.includes(option) ? 'text-[#1C82DE] font-medium' : 'text-[#1E3950]'
                        }`}>
                          {option}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={columns === 3 ? 'grid grid-cols-1 md:grid-cols-3 gap-2.5' : 'grid grid-cols-1 md:grid-cols-2 gap-2.5'}>
          {options.map((option) => (
            <div 
              key={option}
              onClick={() => !isDisabled(option) && handleToggle(option)}
              className={`flex items-center gap-3 p-4 border rounded cursor-pointer transition-all ${
                value.includes(option)
                  ? 'border-[#1C82DE] bg-[#E8F3FC] ring-2 ring-[#1C82DE]/20'
                  : isDisabled(option)
                  ? 'border-[#E8EBED] bg-[#E8EBED] cursor-not-allowed opacity-50'
                  : 'border-[#C1C6C8] hover:border-[#A9AAAC] hover:bg-gray-50'
              }`}
            >
              <div className={`w-5 h-5 flex-shrink-0 rounded border-2 flex items-center justify-center transition-all ${
                value.includes(option) 
                  ? 'border-[#1C82DE] bg-[#1C82DE]' 
                  : 'border-[#A9AAAC]'
              }`}>
                {value.includes(option) && <Check className="w-3 h-3 text-white" />}
              </div>
              <span className={`select-none text-sm ${
                value.includes(option) ? 'text-[#1C82DE] font-medium' : 'text-[#1E3950]'
              }`}>
                {option}
              </span>
            </div>
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