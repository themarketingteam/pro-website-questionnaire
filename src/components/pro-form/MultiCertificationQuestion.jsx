import React, { useState } from 'react';
import { Plus, X, Upload, FileText, Image, Check, Edit2 } from 'lucide-react';
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
            item.saved ? 'border-green-500 bg-green-50' : 'border-[#C1C6C8]'
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
                    <Edit2 className="w-4 h-4" />
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
                  <span className="font-semibold text-[#122947]">Item {index + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeItem(index)}
                    className="p-2 hover:bg-red-50 rounded-lg transition-colors text-red-600"
                  >
                    <X className="w-5 h-5" />
                  </button>
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
              className="w-full p-3 border border-[#C1C6C8] rounded focus:outline-none focus:ring-2 focus:ring-[#1C82DE] focus:border-transparent"
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
              className="w-full p-3 border border-[#C1C6C8] rounded focus:outline-none focus:ring-2 focus:ring-[#1C82DE] focus:border-transparent"
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
              Image/Logo <span className="text-[#566C75] text-xs">(Optional)</span>
            </label>
            {item.image ? (
              <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded">
                {item.image.url.match(/\.(jpg|jpeg|png|gif|webp)$/i) && (
                  <img src={item.image.url} alt="Preview" className="w-16 h-16 object-cover rounded" />
                )}
                <div className="flex-1">
                  <p className="text-sm text-green-800 font-medium">{item.image.name}</p>
                </div>
                <button
                  type="button"
                  onClick={() => updateItem(index, 'image', null)}
                  className="px-3 py-1 text-sm bg-white border border-green-300 hover:bg-red-50 hover:border-red-300 rounded text-green-800 hover:text-red-600 transition-colors"
                >
                  Remove
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-[#C1C6C8] rounded cursor-pointer hover:border-[#1C82DE] hover:bg-blue-50 transition-colors">
                <div className="flex flex-col items-center">
                  {uploading[`${index}-image`] ? (
                    <>
                      <div className="w-6 h-6 border-2 border-[#1C82DE] border-t-transparent rounded-full animate-spin mb-2" />
                      <span className="text-sm text-[#566C75]">Uploading...</span>
                    </>
                  ) : (
                    <>
                      <Image className="w-6 h-6 text-[#566C75] mb-2" />
                      <span className="text-sm text-[#566C75]">Click to upload image</span>
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
              Supporting Files <span className="text-[#566C75] text-xs">(Optional - PDF, DOCX, etc.)</span>
            </label>
            
            {item.files?.length > 0 && (
              <div className="space-y-2 mb-3">
                {item.files.map((file, fileIndex) => (
                  <div key={fileIndex} className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded">
                    <FileText className="w-5 h-5 text-blue-600" />
                    <div className="flex-1">
                      <p className="text-sm text-blue-800 font-medium">{file.name}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFile(index, fileIndex)}
                      className="px-3 py-1 text-sm bg-white border border-blue-300 hover:bg-red-50 hover:border-red-300 rounded text-blue-800 hover:text-red-600 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            <label className="flex flex-col items-center justify-center w-full h-20 border-2 border-dashed border-[#C1C6C8] rounded cursor-pointer hover:border-[#1C82DE] hover:bg-blue-50 transition-colors">
              <div className="flex flex-col items-center">
                {uploading[`${index}-files`] ? (
                  <>
                    <div className="w-6 h-6 border-2 border-[#1C82DE] border-t-transparent rounded-full animate-spin mb-2" />
                    <span className="text-sm text-[#566C75]">Uploading...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-6 h-6 text-[#566C75] mb-2" />
                    <span className="text-sm text-[#566C75]">Click to upload file</span>
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
                  <div className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded p-2">
                    Please complete required fields (Name and Type) before saving.
                  </div>
                )}

                {/* Save Item Button */}
                <button
                  type="button"
                  onClick={() => saveItem(index)}
                  disabled={!isItemComplete(item)}
                  className={`w-full py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                    isItemComplete(item)
                      ? 'bg-green-600 hover:bg-green-700 text-white'
                      : 'bg-[#C1C6C8] text-[#566C75] cursor-not-allowed'
                  }`}
                >
                  <Check className="w-5 h-5" />
                  Save Item
                </button>
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