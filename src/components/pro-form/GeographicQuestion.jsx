import React, { useState, useEffect, useRef } from 'react';
import { MapPin, X } from 'lucide-react';

export default function GeographicQuestion({ value = [], onChange, onMetaChange, metaValue = [], min = 1, max = 5 }) {
  const [input, setInput] = useState('');
  const [isLoaded, setIsLoaded] = useState(false);
  const [predictions, setPredictions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef(null);
  const autocompleteServiceRef = useRef(null);
  const placesServiceRef = useRef(null);
  const dropdownRef = useRef(null);

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

  // Initialize services
  useEffect(() => {
    if (!isLoaded) return;
    
    autocompleteServiceRef.current = new window.google.maps.places.AutocompleteService();
    placesServiceRef.current = new window.google.maps.places.PlacesService(document.createElement('div'));
  }, [isLoaded]);

  // Handle input changes and fetch predictions
  useEffect(() => {
    if (!isLoaded || !input.trim() || !autocompleteServiceRef.current) {
      setPredictions([]);
      setShowDropdown(false);
      return;
    }

    const timer = setTimeout(() => {
      autocompleteServiceRef.current.getPlacePredictions(
        {
          input: input,
          types: ['(regions)']
        },
        (results, status) => {
          if (status === window.google.maps.places.PlacesServiceStatus.OK && results) {
            setPredictions(results);
            setShowDropdown(true);
          } else {
            setPredictions([]);
            setShowDropdown(false);
          }
        }
      );
    }, 300);

    return () => clearTimeout(timer);
  }, [input, isLoaded]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target) && 
          inputRef.current && !inputRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectPrediction = (prediction) => {
    if (value.length >= max) return;

    // Get place details
    placesServiceRef.current.getDetails(
      { placeId: prediction.place_id },
      (place, status) => {
        if (status === window.google.maps.places.PlacesServiceStatus.OK) {
          const newValues = [...value, prediction.description];
          const newMeta = [...metaValue, {
            label: prediction.description,
            lat: place.geometry?.location?.lat() || null,
            lon: place.geometry?.location?.lng() || null,
            place_id: prediction.place_id,
            source: 'google_places'
          }];

          onChange(newValues);
          if (onMetaChange) onMetaChange(newMeta);
          setInput('');
          setPredictions([]);
          setShowDropdown(false);
        }
      }
    );
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

      <div className="text-sm text-slate-500 italic">
        Start typing to see location suggestions
      </div>

      {/* Input field with dropdown */}
      <div className="relative">
        <div className="relative">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={canAddMore ? "" : "Maximum locations reached"}
            disabled={!canAddMore}
            className={`w-full pl-10 pr-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
              canAddMore ? 'border-slate-300' : 'border-slate-200 bg-slate-50 cursor-not-allowed'
            }`}
          />
          {!isLoaded && (
            <div className="absolute top-1/2 right-3 -translate-y-1/2">
              <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
            </div>
          )}
        </div>

        {/* Dropdown */}
        {showDropdown && predictions.length > 0 && (
          <div
            ref={dropdownRef}
            className="absolute z-10 w-full mt-1 bg-white border border-slate-300 rounded-lg shadow-lg max-h-64 overflow-y-auto"
          >
            {predictions.map((prediction) => (
              <button
                key={prediction.place_id}
                type="button"
                onClick={() => handleSelectPrediction(prediction)}
                className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-b-0 flex items-start gap-3"
              >
                <MapPin className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                <span className="text-sm text-slate-700">{prediction.description}</span>
              </button>
            ))}
            <div className="px-3 py-2 text-xs text-slate-400 bg-slate-50 flex items-center justify-end gap-1">
              <span>powered by</span>
              <img src="https://www.gstatic.com/images/branding/googlelogo/1x/googlelogo_color_74x24dp.png" alt="Google" className="h-3" />
            </div>
          </div>
        )}
      </div>

      {/* Help text */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <p className="text-sm text-blue-700">
          💡 Type to see location suggestions. Select one from the dropdown for validated location data.
        </p>
      </div>

      {/* Validated locations */}
      {value.length > 0 && (
        <div className="space-y-2">
          {value.map((location, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg"
            >
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                <div>
                  <div className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-0.5">
                    Validated:
                  </div>
                  <span className="text-sm text-slate-700">{location}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleRemove(index)}
                className="px-3 py-1 text-sm text-slate-600 hover:text-slate-800 border border-slate-300 hover:border-slate-400 rounded transition-colors"
              >
                × Clear
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}