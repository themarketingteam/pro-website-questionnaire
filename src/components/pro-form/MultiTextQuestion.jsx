import React from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from "@/components/ui/button";

export default function MultiTextQuestion({ 
  value = [''], 
  onChange, 
  min = 1, 
  max = 5,
  placeholder = "Enter a value..."
}) {
  const handleAdd = () => {
    if (value.length < max) {
      onChange([...value, '']);
    }
  };

  const handleRemove = (index) => {
    if (value.length > min) {
      const newValue = value.filter((_, i) => i !== index);
      onChange(newValue);
    }
  };

  const handleChange = (index, text) => {
    const newValue = [...value];
    newValue[index] = text;
    onChange(newValue);
  };

  return (
    <div className="space-y-3">
      <span className="text-sm font-medium text-[#566C75] block">
        {value.length} / {max} entries (minimum {min})
      </span>
      
      {value.map((item, index) => (
        <div key={index} className="flex gap-2">
          <input
            type="text"
            value={item}
            onChange={(e) => handleChange(index, e.target.value)}
            placeholder={`${placeholder} ${index + 1}`}
            className="flex-1 p-3 border border-[#C1C6C8] rounded focus:outline-none focus:ring-2 focus:ring-[#1C82DE] focus:border-transparent transition-all"
          />
          {value.length > min && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => handleRemove(index)}
              className="text-[#566C75] hover:text-red-500 hover:bg-red-50"
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      ))}
      
      {value.length < max && (
        <Button
          type="button"
          variant="outline"
          onClick={handleAdd}
          className="w-full border-dashed border-[#C1C6C8] text-[#566C75] hover:border-[#1C82DE] hover:text-[#1C82DE] hover:bg-[#E8F3FC]"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Another Entry
        </Button>
      )}
    </div>
  );
}