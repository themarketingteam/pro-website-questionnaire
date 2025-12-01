import React, { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Upload, X, Plus, User, Check } from 'lucide-react';
import { toast } from 'sonner';

export default function ImageTaggingQuestion({ value, onChange }) {
  const [isUploading, setIsUploading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [tags, setTags] = useState(value?.tags || []);
  const [editingTag, setEditingTag] = useState(null);
  const [tempPerson, setTempPerson] = useState({ name: '', position: '', bio: '' });
  const imageRef = useRef(null);
  const fileInputRef = useRef(null);

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    if (!validTypes.includes(file.type)) {
      toast.error('Please upload a JPG or PNG image');
      return;
    }

    setIsUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      onChange({
        url: file_url,
        name: file.name,
        type: file.type,
        tags: []
      });
      setTags([]);
      setShowModal(true);
      toast.success('Image uploaded');
    } catch (error) {
      toast.error('Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const handleImageClick = (e) => {
    if (!imageRef.current || editingTag !== null) return;

    const rect = imageRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    const newTag = { x, y, person: null };
    const newTags = [...tags, newTag];
    setTags(newTags);
    setEditingTag(newTags.length - 1);
    setTempPerson({ name: '', position: '', bio: '' });
  };

  const handleSavePerson = () => {
    if (!tempPerson.name.trim()) {
      toast.error('Name is required');
      return;
    }

    const updatedTags = [...tags];
    updatedTags[editingTag] = {
      ...updatedTags[editingTag],
      person: { ...tempPerson }
    };

    // Sort tags by y (top to bottom), then x (left to right)
    updatedTags.sort((a, b) => {
      if (Math.abs(a.y - b.y) < 5) return a.x - b.x;
      return a.y - b.y;
    });

    setTags(updatedTags);
    onChange({ ...value, tags: updatedTags });
    setEditingTag(null);
    setTempPerson({ name: '', position: '', bio: '' });
  };

  const handleDeleteTag = (index) => {
    const updatedTags = tags.filter((_, i) => i !== index);
    setTags(updatedTags);
    onChange({ ...value, tags: updatedTags });
    if (editingTag === index) {
      setEditingTag(null);
      setTempPerson({ name: '', position: '', bio: '' });
    }
  };

  const handleRemoveImage = () => {
    onChange(null);
    setTags([]);
    setShowModal(false);
    setEditingTag(null);
  };

  const handleDoneTagging = () => {
    if (editingTag !== null) {
      toast.error('Please save or cancel the current tag first');
      return;
    }
    setShowModal(false);
  };

  if (!value?.url) {
    return (
      <div className="space-y-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png"
          onChange={handleFileSelect}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="w-full p-8 border-2 border-dashed border-slate-300 rounded-xl hover:border-blue-400 hover:bg-blue-50 transition-all"
        >
          <div className="flex flex-col items-center gap-3">
            {isUploading ? (
              <>
                <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-slate-600">Uploading...</p>
              </>
            ) : (
              <>
                <Upload className="w-12 h-12 text-slate-400" />
                <p className="text-slate-600">Click to upload team photo</p>
                <p className="text-sm text-slate-500">JPG or PNG</p>
              </>
            )}
          </div>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-green-50 border border-green-200 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 bg-green-500 rounded-full" />
            <span className="text-green-800 font-medium">{value.name}</span>
            <span className="text-sm text-green-600">
              {tags.length} {tags.length === 1 ? 'person' : 'people'} tagged
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {tags.length === 0 ? 'Tag People' : 'Edit Tags'}
            </button>
            <button
              type="button"
              onClick={handleRemoveImage}
              className="px-4 py-2 bg-white border border-green-300 hover:border-red-400 hover:bg-red-50 rounded-lg flex items-center gap-2 transition-colors text-green-800 font-medium"
            >
              <X className="w-4 h-4" />
              Remove
            </button>
          </div>
        </div>
      </div>

      {showModal && (
        <div 
          className="fixed bg-black/50 z-[9999] flex items-center justify-center p-4"
          style={{ top: 0, left: 0, right: 0, bottom: 0, position: 'fixed', margin: 0 }}
        >
          <div className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-slate-200">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">Tag Team Members</h3>
                  <p className="text-sm text-slate-600 mt-1">Click on each person in the photo to add their information</p>
                </div>
                <button
                  onClick={handleDoneTagging}
                  className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
                >
                  Done
                </button>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Image Name
                </label>
                <input
                  type="text"
                  value={value.name}
                  onChange={(e) => onChange({ ...value, name: e.target.value })}
                  placeholder="team-photo"
                  className="w-full p-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex-1 overflow-auto p-6">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                  <div className="relative inline-block">
                    <img
                      ref={imageRef}
                      src={value.url}
                      alt="Team"
                      onClick={handleImageClick}
                      className="max-w-full rounded-lg shadow-lg cursor-crosshair"
                      style={{ minHeight: '300px', maxHeight: '600px', height: 'auto' }}
                    />
                    {tags.map((tag, index) => (
                      <div
                        key={index}
                        style={{ left: `${tag.x}%`, top: `${tag.y}%` }}
                        className="absolute transform -translate-x-1/2 -translate-y-1/2"
                      >
                        <div className={`relative ${editingTag === index ? 'z-10' : ''}`}>
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-all ${
                            tag.person 
                              ? 'bg-green-500 hover:bg-green-600' 
                              : 'bg-blue-500 hover:bg-blue-600 animate-pulse'
                          }`}>
                            {tag.person ? (
                              <Check className="w-5 h-5 text-white" />
                            ) : (
                              <Plus className="w-5 h-5 text-white" />
                            )}
                          </div>
                          {tag.person && (
                            <div className="absolute top-12 left-1/2 transform -translate-x-1/2 bg-slate-900 text-white px-3 py-1 rounded text-xs whitespace-nowrap">
                              {tag.person.name}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  {editingTag !== null ? (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-4">
                      <div className="flex items-center gap-2 text-blue-900 font-semibold">
                        <User className="w-5 h-5" />
                        <span>Who is this?</span>
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Name <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={tempPerson.name}
                          onChange={(e) => setTempPerson({ ...tempPerson, name: e.target.value })}
                          placeholder="John Smith"
                          className="w-full p-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Position/Role
                        </label>
                        <input
                          type="text"
                          value={tempPerson.position}
                          onChange={(e) => setTempPerson({ ...tempPerson, position: e.target.value })}
                          placeholder="CEO / Lead Engineer"
                          className="w-full p-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Bio
                        </label>
                        <textarea
                          value={tempPerson.bio}
                          onChange={(e) => setTempPerson({ ...tempPerson, bio: e.target.value })}
                          placeholder="Brief description..."
                          rows={3}
                          className="w-full p-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                        />
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleSavePerson}
                          className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            handleDeleteTag(editingTag);
                          }}
                          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                      <h4 className="font-semibold text-slate-900 mb-3">Tagged People ({tags.length})</h4>
                      {tags.length === 0 ? (
                        <p className="text-sm text-slate-600">Click on the image to tag people</p>
                      ) : (
                        <div className="space-y-2">
                          {tags.map((tag, index) => (
                            tag.person && (
                              <div key={index} className="flex items-center justify-between bg-white p-3 rounded border border-slate-200">
                                <div className="flex-1">
                                  <p className="font-medium text-slate-900">{tag.person.name}</p>
                                  {tag.person.position && (
                                    <p className="text-sm text-slate-600">{tag.person.position}</p>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTag(index)}
                                  className="p-2 hover:bg-red-50 rounded-lg transition-colors"
                                >
                                  <X className="w-4 h-4 text-red-600" />
                                </button>
                              </div>
                            )
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}