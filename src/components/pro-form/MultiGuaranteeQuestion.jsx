import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { base44 } from '@/api/base44Client';
import { Plus, X, Check, Upload, Loader2, ChevronDown, ChevronUp, File, Edit } from 'lucide-react';
import { toast } from 'sonner';

export default function MultiGuaranteeQuestion({ value, onChange, max = 10 }) {
  const items = Array.isArray(value) ? value : [];
  const [expandedIndex, setExpandedIndex] = useState(null);

  const handleAddItem = () => {
    if (items.length >= max) {
      toast.error(`Maximum ${max} items allowed`);
      return;
    }
    const newItem = {
      name: '',
      type: '',
      file: null,
      description: '',
      saved: false
    };
    onChange([...items, newItem]);
    setExpandedIndex(items.length);
  };

  const handleRemoveItem = (index) => {
    const updated = items.filter((_, i) => i !== index);
    onChange(updated);
    if (expandedIndex === index) {
      setExpandedIndex(null);
    }
  };

  const handleUpdateItem = (index, field, newValue) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: newValue, saved: false };
    onChange(updated);
  };

  const handleSaveItem = (index) => {
    const item = items[index];
    
    // Validation
    if (!item.name?.trim()) {
      toast.error('Name is required');
      return;
    }
    if (!item.type) {
      toast.error('Type is required');
      return;
    }
    if (!item.file && !item.description?.trim()) {
      toast.error('Please provide either a supporting file or a description');
      return;
    }

    const updated = [...items];
    updated[index] = { ...updated[index], saved: true };
    onChange(updated);
    setExpandedIndex(null);
    toast.success('Item saved');
  };

  const handleFileUpload = async (index, file) => {
    if (!file) return;

    // Validate file type
    const validTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!validTypes.includes(file.type)) {
      toast.error('Please upload a PDF, image, or Word document');
      return;
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File size must be less than 10MB');
      return;
    }

    const updated = [...items];
    updated[index] = { ...updated[index], uploadingFile: true };
    onChange(updated);

    try {
      const result = await base44.integrations.Core.UploadFile({ file });
      const updated = [...items];
      updated[index] = {
        ...updated[index],
        file: {
          url: result.file_url,
          name: file.name,
          type: file.type
        },
        uploadingFile: false,
        saved: false
      };
      onChange(updated);
      toast.success('File uploaded');
    } catch (error) {
      console.error('Upload error:', error);
      const updated = [...items];
      updated[index] = { ...updated[index], uploadingFile: false };
      onChange(updated);
      toast.error('Failed to upload file');
    }
  };

  const toggleExpand = (index) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  const isItemComplete = (item) => {
    return item.name?.trim() && item.type && (item.file || item.description?.trim());
  };

  return (
    <div className="space-y-4">
      {items.map((item, index) => {
        const isExpanded = expandedIndex === index;
        const isComplete = isItemComplete(item);
        const isSaved = item.saved === true || (isComplete && item.saved !== false);

        return (
          <div
            key={index}
            className={`border-2 rounded-lg transition-all ${
              isSaved ? 'border-green-500 bg-white' : 'border-slate-300 bg-white'
            }`}
          >
            {/* Header */}
            {isSaved ? (
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3 flex-1">
                  <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                    <Check className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-900 truncate">
                      {item.name || `Item ${index + 1}`}
                    </div>
                    {item.type && (
                      <div className="text-sm text-slate-600">
                        {item.type}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleExpand(index)}
                    className="px-4 py-2 text-sm bg-white border border-slate-300 hover:border-slate-400 hover:bg-slate-50 rounded-lg flex items-center gap-2 transition-colors text-slate-700 font-medium"
                  >
                    <Edit className="w-4 h-4" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveItem(index);
                    }}
                    className="p-2 hover:bg-red-100 rounded transition-colors"
                  >
                    <X className="w-5 h-5 text-red-600" />
                  </button>
                </div>
              </div>
            ) : (
              <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50/50 transition-colors"
                onClick={() => toggleExpand(index)}
              >
                <div className="flex items-center gap-3 flex-1">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-900 truncate">
                      {item.name || `Item ${index + 1}`}
                    </div>
                    {item.type && (
                      <div className="text-sm text-slate-600">
                        {item.type}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveItem(index);
                    }}
                    className="p-1 hover:bg-red-100 rounded transition-colors"
                  >
                    <X className="w-4 h-4 text-red-600" />
                  </button>
                  {isExpanded ? (
                    <ChevronUp className="w-5 h-5 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                  )}
                </div>
              </div>
            )}

            {/* Expanded Content */}
            {isExpanded && (
              <div className="border-t border-slate-200 p-4 space-y-4">
                {/* Name */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Name <span className="text-red-500">*</span>
                  </label>
                  <Input
                    value={item.name || ''}
                    onChange={(e) => handleUpdateItem(index, 'name', e.target.value)}
                    placeholder="e.g., 10-Minute Response Guarantee"
                  />
                </div>

                {/* Type */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Type <span className="text-red-500">*</span>
                  </label>
                  <Select
                    value={item.type || ''}
                    onValueChange={(val) => handleUpdateItem(index, 'type', val)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Guarantee">Guarantee</SelectItem>
                      <SelectItem value="Service Standard">Service Standard</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Supporting File */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Supporting File
                  </label>
                  {item.file ? (
                    <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded">
                      <File className="w-4 h-4 text-slate-600" />
                      <span className="text-sm text-slate-700 flex-1 truncate">
                        {item.file.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleUpdateItem(index, 'file', null)}
                        className="p-1 hover:bg-red-100 rounded transition-colors"
                      >
                        <X className="w-4 h-4 text-red-600" />
                      </button>
                    </div>
                  ) : (
                    <div>
                      <input
                        type="file"
                        id={`file-${index}`}
                        className="hidden"
                        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleFileUpload(index, file);
                        }}
                        disabled={item.uploadingFile}
                      />
                      <label
                        htmlFor={`file-${index}`}
                        className={`flex flex-col items-center justify-center py-4 border-2 border-dashed rounded cursor-pointer transition-colors ${
                          item.uploadingFile
                            ? 'border-slate-300 bg-slate-50 cursor-not-allowed'
                            : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50'
                        }`}
                      >
                        {item.uploadingFile ? (
                          <>
                            <Loader2 className="w-6 h-6 text-slate-600 animate-spin mb-2" />
                            <span className="text-sm text-slate-600">Uploading...</span>
                          </>
                        ) : (
                          <>
                            <Upload className="w-5 h-5 text-slate-400 mb-1" />
                            <span className="text-sm text-slate-600">Click to upload file</span>
                          </>
                        )}
                      </label>
                      <p className="text-xs text-slate-500 mt-1">
                        PDF, Image, or Word document (max 10MB)
                      </p>
                    </div>
                  )}
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Description
                  </label>
                  <Textarea
                    value={item.description || ''}
                    onChange={(e) => handleUpdateItem(index, 'description', e.target.value)}
                    placeholder="Describe your guarantee or service standard..."
                    rows={4}
                  />
                  {!item.file && !item.description?.trim() && (
                    <p className="text-xs text-amber-600 mt-1">
                      * Please provide either a supporting file or a description
                    </p>
                  )}
                </div>

                {/* Save Button */}
                <div className="flex justify-end pt-2">
                  <Button
                    type="button"
                    onClick={() => handleSaveItem(index)}
                    disabled={!isComplete}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <Check className="w-4 h-4 mr-2" />
                    Save Item
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Add New Button */}
      {items.length < max && (
        <button
          type="button"
          onClick={handleAddItem}
          disabled={items.length > 0 && !items[items.length - 1].saved}
          className={`w-full py-4 border-2 border-dashed rounded-lg flex items-center justify-center gap-2 transition-all ${
            items.length > 0 && !items[items.length - 1].saved
              ? 'border-[#C1C6C8] text-[#A9AAAC] cursor-not-allowed'
              : 'border-[#1C82DE] text-[#1C82DE] hover:bg-blue-50 cursor-pointer'
          }`}
        >
          <Plus className="w-5 h-5" />
          Add {items.length > 0 ? 'Another' : 'New'} Item ({items.length}/{max})
        </button>
      )}

      {items.length === 0 && (
        <div className="text-sm text-[#566C75] text-center py-2">
          Click the button above to add your first guarantee or service standard.
        </div>
      )}
    </div>
  );
}