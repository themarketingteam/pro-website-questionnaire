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
      <span className="text-sm font-medium text-slate-600 block">
        {value.length} / {max} entries (minimum {min})
      </span>
      
      {value.map((item, index) => (
        <div key={index} className="flex gap-2">
          <input
            type="text"
            value={item}
            onChange={(e) => handleChange(index, e.target.value)}
            placeholder={`${placeholder} ${index + 1}`}
            className="flex-1 p-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
          />
          {value.length > min && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => handleRemove(index)}
              className="text-slate-400 hover:text-red-500 hover:bg-red-50"
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
          className="w-full border-dashed border-slate-300 text-slate-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Another Entry
        </Button>
      )}
    </div>
  );
}