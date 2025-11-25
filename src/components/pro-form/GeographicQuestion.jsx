import React, { useState, useEffect, useRef } from 'react';
import { MapPin, X, Plus } from 'lucide-react';

export default function GeographicQuestion({ value = [], onChange, onMetaChange, metaValue = [], min = 1, max = 5 }) {
  const [input, setInput] = useState('');
  const [isLoaded, setIsLoaded] = useState(false);
  const inputRef = useRef(null);
  const autocompleteRef = useRef(null);

  const geoGCPToken = import.meta.env.VITE_GCP_TOKEN || 'AIzaSyDyQuexeP2lIif4UEYVe845bIYrytVp6O0';

  // Load Google Places API
  useEffect(() => {
    if (window.google?.maps?.places) {
      setIsLoaded(true);
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${geoGCPToken}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => setIsLoaded(true);
    document.head.appendChild(script);
  }, []);

  // Initialize autocomplete
  useEffect(() => {
    if (!isLoaded || !inputRef.current || autocompleteRef.current) return;

    autocompleteRef.current = new window.google.maps.places.Autocomplete(inputRef.current, {
      types: ['(regions)']
    });

    autocompleteRef.current.addListener('place_changed', () => {
      const place = autocompleteRef.current.getPlace();
      if (place.geometry) {
        handleAddLocation(
          place.formatted_address || place.name,
          place.geometry.location.lat(),
          place.geometry.location.lng(),
          place.place_id
        );
        setInput('');
      }
    });
  }, [isLoaded]);

  const handleAddLocation = (label, lat = null, lon = null, place_id = null) => {
    if (value.length >= max || !label.trim()) return;
    
    const newValues = [...value, label];
    const newMeta = [...metaValue, { 
      label, 
      lat, 
      lon, 
      place_id, 
      source: place_id ? 'google_places' : 'manual' 
    }];
    
    onChange(newValues);
    if (onMetaChange) onMetaChange(newMeta);
  };

  const handleManualAdd = () => {
    if (input.trim()) {
      handleAddLocation(input.trim());
      setInput('');
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleManualAdd();
    }
  };

  const handleRemove = (index) => {
    const newValues = value.filter((_, i) => i !== index);
    const newMeta = metaValue.filter((_, i) => i !== index);
    
    onChange(newValues);
    if (onMetaChange) onMetaChange(newMeta);
  };

  const canAddMore = value.length < max;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className={`font-medium ${
          value.length < min ? 'text-amber-600' : 
          value.length > max ? 'text-red-600' : 'text-slate-600'
        }`}>
          {value.length} / {max} locations selected
          {min > 0 && ` (minimum ${min})`}
        </span>
      </div>

      {/* Input field */}
      <div className="relative">
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={canAddMore ? "Search for a city, region, or area (or type and press Enter)" : "Maximum locations reached"}
              disabled={!canAddMore}
              className={`w-full pl-10 pr-24 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                canAddMore ? 'border-slate-300' : 'border-slate-200 bg-slate-50 cursor-not-allowed'
              }`}
            />
            {canAddMore && input.trim() && (
              <button
                type="button"
                onClick={handleManualAdd}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors"
              >
                Add
              </button>
            )}
          </div>
        </div>
        {!isLoaded && (
          <div className="absolute top-1/2 right-3 -translate-y-1/2 text-xs text-slate-400">
            Loading maps...
          </div>
        )}
      </div>

      {/* Selected locations */}
      {value.length > 0 && (
        <div className="space-y-2">
          {value.map((location, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg"
            >
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-blue-600 flex-shrink-0" />
                <span className="text-sm text-slate-700">{location}</span>
              </div>
              <button
                type="button"
                onClick={() => handleRemove(index)}
                className="p-1 hover:bg-blue-100 rounded transition-colors"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}