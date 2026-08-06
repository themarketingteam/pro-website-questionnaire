import React, { useState } from 'react';
import { Upload, X, Image, FileText, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import useScopedUiDraftState, { buildQuestionUiDraftScope } from './useScopedUiDraftState';

export default function FileUploadQuestion({
  value,
  onChange,
  accept = ".jpg,.jpeg,.png",
  questionId,
  draftCaptureEnabled = false,
}) {
  const uploadDraft = useScopedUiDraftState({
    scopeKey: buildQuestionUiDraftScope(questionId, 'file-upload'),
    kind: 'file-upload',
    enabled: draftCaptureEnabled,
  });
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setError(null);
    const uploadEntry = {
      originalFileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      uploadStatus: 'uploading',
      uploadedUrl: null,
      base44FileId: null,
      errorCode: null,
    };
    uploadDraft.setData(uploadEntry);

    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      onChange({
        url: file_url,
        name: file.name,
        type: file.type,
        ...uploadEntry,
        uploadStatus: 'uploaded',
        uploadedUrl: file_url,
      });
      uploadDraft.clear();
    } catch (err) {
      setError('Failed to upload file. Please try again.');
      uploadDraft.setData({
        ...uploadEntry,
        uploadStatus: 'failed',
        errorCode: 'UPLOAD_FAILED',
      });
      console.error('Upload error:', err);
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemove = () => {
    onChange(null);
    uploadDraft.clear();
  };

  if (value?.url) {
    return (
      <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
        <div className="flex items-center gap-4">
          {value.type?.startsWith('image/') ? (
            <div className="w-20 h-20 rounded-lg overflow-hidden bg-white border border-slate-200">
              <img 
                src={value.url} 
                alt={value.name}
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className="w-20 h-20 rounded-lg bg-white border border-slate-200 flex items-center justify-center">
              <FileText className="w-8 h-8 text-slate-400" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-slate-900 truncate">{value.name}</p>
            <p className="text-sm text-green-600 mt-1">✓ Uploaded successfully</p>
          </div>
          <button
            type="button"
            onClick={handleRemove}
            className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <label className={`flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-xl cursor-pointer transition-all ${
        isUploading 
          ? 'border-blue-300 bg-blue-50' 
          : 'border-slate-300 hover:border-blue-400 hover:bg-blue-50/50'
      }`}>
        <input
          type="file"
          accept={accept}
          onChange={handleFileChange}
          disabled={isUploading}
          className="sr-only"
        />
        
        {isUploading ? (
          <>
            <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-3" />
            <span className="text-blue-600 font-medium">Uploading...</span>
          </>
        ) : (
          <>
            <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center mb-4">
              <Upload className="w-6 h-6 text-blue-600" />
            </div>
            <span className="text-slate-700 font-medium mb-1">Click to upload</span>
            <span className="text-sm text-slate-500">or drag and drop</span>
            <span className="text-xs text-slate-400 mt-2">JPG, JPEG, or PNG</span>
          </>
        )}
      </label>
      {isUploading && (
        <p className="mt-2 text-sm text-amber-700" role="status">
          This upload must finish before you close the browser.
        </p>
      )}
      
      {error && (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      )}
    </div>
  );
}
