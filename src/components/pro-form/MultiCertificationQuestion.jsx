import React, { useState } from 'react';
import { Plus, X, Upload, FileText, Image, Check, Edit, ChevronDown, ChevronUp } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export default function MultiCertificationQuestion({ value = [], onChange, max = 10 }) {
  const [uploading, setUploading] = useState({});
  const [expandedIndex, setExpandedIndex] = useState(null);

  const addNewItem = () => {
    if (value.length >= max) return;
    const newItem = { name: '', type: '', image: null, files: [], saved: false };
    onChange([...value, newItem]);
    setExpandedIndex(value.length);
  };

  const removeItem = (index) => {
    onChange(value.filter((_, i) => i !== index));
    if (expandedIndex === index) setExpandedIndex(null);
  };

  const updateItem = (index, field, fieldValue) => {
    const updated = [...value];
    updated[index] = { ...updated[index], [field]: fieldValue, saved: false };
    onChange(updated);
  };

  const saveItem = (index) => {
    if (!isItemComplete(value[index])) {
      toast.error('Please complete required fields');
      return;
    }
    const updated = [...value];
    updated[index] = { ...updated[index], saved: true };
    onChange(updated);
    setExpandedIndex(null);
    toast.success('Item saved');
  };

  const handleFileUpload = async (index, field, file) => {
    const uploadKey = `${index}-${field}`;
    setUploading(prev => ({ ...prev, [uploadKey]: true }));

    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      
      if (field === 'image') {
        updateItem(index, 'image', { url: file_url, name: file.name });
      } else {
        // Add to files array
        const currentFiles = value[index].files || [];
        updateItem(index, 'files', [...currentFiles, { url: file_url, name: file.name }]);
      }
      
      toast.success('File uploaded successfully');
    } catch (error) {
      console.error('Upload failed:', error);
      toast.error('Failed to upload file');
    } finally {
      setUploading(prev => ({ ...prev, [uploadKey]: false }));
    }
  };

  const removeFile = (index, fileIndex) => {
    const currentFiles = value[index].files || [];
    updateItem(index, 'files', currentFiles.filter((_, i) => i !== fileIndex));
  };

  const isItemComplete = (item) => {
    return item.name?.trim() && item.type;
  };

  return (
    <div className="space-y-4">
      {value.map((item, index) => {
        const isExpanded = expandedIndex === index || !item.saved;
        
        return (
          <div key={index} className={`border-2 rounded-lg bg-white transition-all ${
           item.saved ? 'border-green-500 bg-green-50/30' : 'border-[#C1C6C8]'
          }`}>
            {/* Collapsed View */}
            {item.saved && !isExpanded && (
              <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                    <Check className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="font-semibold text-[#122947]">{item.name}</p>
                    <p className="text-sm text-[#566C75] capitalize">{item.type}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setExpandedIndex(index)}
                    className="px-4 py-2 bg-white border border-green-300 hover:bg-green-100 rounded-lg flex items-center gap-2 text-green-800 transition-colors"
                  >
                    <Edit className="w-4 h-4" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => removeItem(index)}
                    className="p-2 hover:bg-red-50 rounded-lg transition-colors text-red-600"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}
            
            {/* Expanded View */}
            {isExpanded && (
              <div className="p-6 space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-[#122947]">Item {index + 1}</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => removeItem(index)}
                      className="p-1 hover:bg-red-50 rounded transition-colors text-red-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedIndex(null)}
                      className="p-1 hover:bg-slate-100 rounded transition-colors text-slate-600"
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                  </div>
                </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-[#122947] mb-2">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={item.name || ''}
              onChange={(e) => updateItem(index, 'name', e.target.value)}
              placeholder="e.g., Microsoft Gold Partner"
              className="w-full p-3 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-[#1C82DE] focus:border-transparent"
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-sm font-medium text-[#122947] mb-2">
              Type <span className="text-red-500">*</span>
            </label>
            <select
              value={item.type || ''}
              onChange={(e) => updateItem(index, 'type', e.target.value)}
              className="w-full p-3 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-[#1C82DE] focus:border-transparent"
            >
              <option value="">Select type...</option>
              <option value="certification">Certification</option>
              <option value="accolade">Accolade</option>
              <option value="award">Award</option>
              <option value="partnership">Partnership</option>
              <option value="other">Other</option>
            </select>
          </div>

          {/* Image/Logo */}
          <div>
            <label className="block text-sm font-medium text-[#122947] mb-2">
              Image/Logo <span className="text-slate-500 text-xs font-normal">(Optional)</span>
            </label>
            {item.image ? (
              <div className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded">
                {item.image.url.match(/\.(jpg|jpeg|png|gif|webp)$/i) && (
                  <img src={item.image.url} alt="Preview" className="w-16 h-16 object-cover rounded" />
                )}
                <div className="flex-1">
                  <p className="text-sm text-slate-700 font-medium">{item.image.name}</p>
                </div>
                <button
                  type="button"
                  onClick={() => updateItem(index, 'image', null)}
                  className="text-sm text-red-600 hover:underline"
                >
                  Remove
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center w-full py-4 border-2 border-dashed border-slate-300 rounded cursor-pointer hover:border-slate-400 hover:bg-slate-50 transition-colors">
                <div className="flex flex-col items-center">
                  {uploading[`${index}-image`] ? (
                    <>
                      <div className="w-6 h-6 border-2 border-slate-400 border-t-transparent rounded-full animate-spin mb-2" />
                      <span className="text-sm text-slate-600">Uploading...</span>
                    </>
                  ) : (
                    <>
                      <Image className="w-5 h-5 text-slate-400 mb-1" />
                      <span className="text-sm text-slate-600">Click to upload image</span>
                    </>
                  )}
                </div>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(index, 'image', file);
                  }}
                />
              </label>
            )}
          </div>

          {/* Supporting Files */}
          <div>
            <label className="block text-sm font-medium text-[#122947] mb-2">
              Supporting Files <span className="text-slate-500 text-xs font-normal">(Optional - PDF, DOCX, etc.)</span>
            </label>
            
            {item.files?.length > 0 && (
              <div className="space-y-2 mb-3">
                {item.files.map((file, fileIndex) => (
                  <div key={fileIndex} className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded">
                    <FileText className="w-5 h-5 text-slate-600" />
                    <div className="flex-1">
                      <p className="text-sm text-slate-700 font-medium">{file.name}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFile(index, fileIndex)}
                      className="text-sm text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            <label className="flex flex-col items-center justify-center w-full py-4 border-2 border-dashed border-slate-300 rounded cursor-pointer hover:border-slate-400 hover:bg-slate-50 transition-colors">
              <div className="flex flex-col items-center">
                {uploading[`${index}-files`] ? (
                  <>
                    <div className="w-6 h-6 border-2 border-slate-400 border-t-transparent rounded-full animate-spin mb-2" />
                    <span className="text-sm text-slate-600">Uploading...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-5 h-5 text-slate-400 mb-1" />
                    <span className="text-sm text-slate-600">Click to upload file</span>
                  </>
                )}
              </div>
              <input
                type="file"
                accept=".pdf,.doc,.docx,.txt"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(index, 'files', file);
                }}
              />
            </label>
          </div>

                {!isItemComplete(item) && (
                  <div className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded p-3">
                    Please complete required fields (Name and Type) before saving.
                  </div>
                )}

                {/* Save Item Button */}
                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => saveItem(index)}
                    disabled={!isItemComplete(item)}
                    className={`px-6 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                      isItemComplete(item)
                        ? 'bg-green-600 hover:bg-green-700 text-white'
                        : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    <Check className="w-4 h-4" />
                    Save Item
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {value.length < max && (
        <button
          type="button"
          onClick={addNewItem}
          disabled={value.length > 0 && !value[value.length - 1].saved}
          className={`w-full py-4 border-2 border-dashed rounded-lg flex items-center justify-center gap-2 transition-all ${
            value.length > 0 && !value[value.length - 1].saved
              ? 'border-[#C1C6C8] text-[#A9AAAC] cursor-not-allowed'
              : 'border-[#1C82DE] text-[#1C82DE] hover:bg-blue-50 cursor-pointer'
          }`}
        >
          <Plus className="w-5 h-5" />
          Add {value.length > 0 ? 'Another' : 'New'} Item ({value.length}/{max})
        </button>
      )}

      {value.length === 0 && (
        <div className="text-sm text-[#566C75] text-center py-2">
          Click the button above to add your first certification, award, or partnership.
        </div>
      )}
    </div>
  );
}