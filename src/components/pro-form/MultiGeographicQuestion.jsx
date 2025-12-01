import React, { useEffect, useRef, useState } from "react";
import { MapPin, X, Info, Plus, Star } from "lucide-react";

const TEMP_API_KEY = "AIzaSyDyQuexeP2lIif4UEYVe845bIYrytVp6O0";

export default function MultiGeographicQuestion({
  selectedLocations = [],
  primaryIndex = 0,
  onAdd,
  onRemove,
  onSetPrimary,
  maxLocations = 5
}) {
  const inputRef = useRef(null);
  const autocompleteRef = useRef(null);
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [currentInput, setCurrentInput] = useState("");

  useEffect(() => {
    if (window.google && window.google.maps && window.google.maps.places) {
      setIsScriptLoaded(true);
      return;
    }

    const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existingScript) {
      existingScript.addEventListener('load', () => setIsScriptLoaded(true));
      existingScript.addEventListener('error', () => setLoadError(true));
      return;
    }

    const apiKey = TEMP_API_KEY || window.ENV?.GOOGLE_PLACES_API_KEY || import.meta.env.VITE_GOOGLE_PLACES_API_KEY;
    
    if (!apiKey) {
      console.warn("Google Places API key not configured");
      setLoadError(true);
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google && window.google.maps && window.google.maps.places) {
        setIsScriptLoaded(true);
      } else {
        setLoadError(true);
      }
    };
    script.onerror = () => {
      setLoadError(true);
      console.warn("Failed to load Google Maps - users can still type manually");
    };
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (!isScriptLoaded || !inputRef.current || autocompleteRef.current || loadError) return;

    try {
      const autocomplete = new window.google.maps.places.Autocomplete(inputRef.current, {
        types: ["(regions)"],
        fields: ["place_id", "formatted_address", "geometry", "name"]
      });

      autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();

        if (!place.geometry) {
          console.warn("No geometry for selected place");
          return;
        }

        const addressComponents = place.address_components || [];
        const isContinent = addressComponents.length === 1 && 
                           addressComponents[0].types.includes('continent');
        
        if (isContinent) {
          alert("Please select a more specific location such as a city, county, or region. Continents are not allowed.");
          setCurrentInput("");
          return;
        }

        const meta = {
          name: place.formatted_address || place.name,
          label: place.formatted_address || place.name,
          lat: place.geometry.location.lat(),
          lon: place.geometry.location.lng(),
          place_id: place.place_id,
          source: "google",
          originalName: place.formatted_address || place.name,
          originalLabel: place.formatted_address || place.name,
          isGreaterArea: false
        };

        // Check if already added
        if (selectedLocations.some(loc => loc.place_id === meta.place_id)) {
          alert("This location has already been added.");
          setCurrentInput("");
          return;
        }

        onAdd(meta);
        setCurrentInput("");
      });

      autocompleteRef.current = autocomplete;
    } catch (error) {
      console.warn("Error initializing Google Places:", error);
      setLoadError(true);
    }
  }, [isScriptLoaded, onAdd, selectedLocations, loadError]);

  const canAddMore = selectedLocations.length < maxLocations;

  return (
    <div className="space-y-4">
      <style>{`
        .pac-container {
          z-index: 9999 !important;
          border-radius: 12px !important;
          margin-top: 4px !important;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15) !important;
          border: 1px solid #e2e8f0 !important;
          font-family: inherit !important;
        }
        .pac-item {
          padding: 12px 16px !important;
          cursor: pointer !important;
          font-size: 14px !important;
          border-top: 1px solid #f1f5f9 !important;
        }
        .pac-item:first-child {
          border-top: none !important;
        }
        .pac-item:hover {
          background-color: #f8fafc !important;
        }
        .pac-item-selected {
          background-color: #eff6ff !important;
        }
        .pac-matched {
          font-weight: 600 !important;
          color: #2563eb !important;
        }
        .pac-icon {
          margin-right: 12px !important;
        }
      `}</style>

      {selectedLocations.length > 0 && (
        <div className="space-y-2">
          <span className="text-sm font-medium text-slate-600">
            {selectedLocations.length} / {maxLocations} validated location{selectedLocations.length !== 1 ? 's' : ''}
          </span>
          {selectedLocations.map((location, index) => (
            <div key={location.place_id || index} className="bg-green-50 border border-green-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3 flex-1">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <div>
                    <span className="font-medium text-green-900">Validated: </span>
                    <span className="text-green-800">{location.label || location.name}</span>
                    {index === primaryIndex && (
                      <span className="ml-2 text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                        Primary
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onSetPrimary && onSetPrimary(index)}
                    className="p-2 hover:bg-green-100 rounded-lg transition-colors"
                    title={index === primaryIndex ? "Primary location" : "Set as primary"}
                  >
                    <Star 
                      className={`w-5 h-5 transition-colors ${
                        index === primaryIndex 
                          ? 'fill-amber-400 text-amber-400' 
                          : 'text-green-400 hover:text-amber-400'
                      }`}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(index)}
                    className="px-4 py-2 text-sm bg-white border border-green-300 hover:border-green-400 hover:bg-green-50 rounded-lg flex items-center gap-2 transition-colors text-green-800 font-medium"
                  >
                    <X className="w-4 h-4" />
                    Remove
                  </button>
                </div>
              </div>
              
              <label className="flex items-center gap-2 ml-5 text-sm text-green-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={location.isGreaterArea || false}
                  onChange={(e) => {
                    const baseName = location.originalName || location.name || location.label || '';
                    const cityName = baseName.split(',')[0].trim();
                    
                    const updatedLocation = {
                      ...location,
                      isGreaterArea: e.target.checked,
                      name: e.target.checked ? `Greater ${cityName} Area` : (location.originalName || baseName),
                      label: e.target.checked ? `Greater ${cityName} Area` : (location.originalLabel || baseName),
                      originalName: location.originalName || baseName,
                      originalLabel: location.originalLabel || baseName
                    };
                    
                    // Replace the location at this index
                    const newLocations = [...selectedLocations];
                    newLocations[index] = updatedLocation;
                    
                    // Clear and re-add all
                    selectedLocations.forEach((_, i) => onRemove(0));
                    newLocations.forEach(loc => onAdd(loc));
                  }}
                  className="w-4 h-4 rounded border-green-400 text-green-600 focus:ring-green-500"
                />
                <span className="font-medium">Greater Area (expands beyond city limits)</span>
              </label>
            </div>
          ))}
        </div>
      )}

      {canAddMore && (
        <>
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              placeholder="e.g., Nashville, TN or Davidson County, TN"
              value={currentInput}
              onChange={(e) => setCurrentInput(e.target.value)}
              autoComplete="off"
              className="w-full p-4 pr-12 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <MapPin className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
          </div>

          {isScriptLoaded && !loadError && (
            <div className="text-sm text-slate-600 bg-blue-50 border border-blue-200 rounded-lg p-3">
              💡 Start typing a city or region name, then select from the dropdown. Each validated location counts toward your selection balance.
            </div>
          )}

          {loadError && (
            <div className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-3">
              ⚠️ Location search unavailable. Please contact support to add locations manually.
            </div>
          )}
        </>
      )}

      {!canAddMore && (
        <div className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
          Maximum of {maxLocations} locations reached. Remove a location to add another.
        </div>
      )}
    </div>
  );
}