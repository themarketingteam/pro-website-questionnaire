import React, { useEffect, useRef, useState } from "react";
import { MapPin, X, Info, Plus, Star } from "lucide-react";


export default function MultiGeographicQuestion({
  selectedLocations = [],
  primaryIndex = 0,
  onAdd,
  onUpdate,
  onRemove,
  onSetPrimary,
  maxLocations = 5,
  externalDisabled = false
}) {
  const inputRef = useRef(null);
  const autocompleteRef = useRef(null);
  const selectedLocationsRef = useRef(selectedLocations);
  const retryCountRef = useRef(0);
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [currentInput, setCurrentInput] = useState("");
  const [manualInput, setManualInput] = useState("");
  const [showManualEntry, setShowManualEntry] = useState(false);

  // Keep selectedLocationsRef in sync
  useEffect(() => {
    selectedLocationsRef.current = selectedLocations;
  }, [selectedLocations]);

  const loadGoogleMapsScript = (retryCount = 0) => {
    const maxRetries = 3;
    const apiKey =
      window.ENV?.GOOGLE_PLACES_API_KEY ||
      import.meta.env.VITE_GOOGLE_PLACES_API_KEY ||
      "AIzaSyDyQuexeP2lIif4UEYVe845bIYrytVp6O0";

    if (!apiKey) {
      setLoadError(true);
      setErrorMessage('Location search is temporarily unavailable.');
      setIsLoading(false);
      return;
    }

    // Remove any existing failed scripts
    const existingScripts = document.querySelectorAll('script[src*="maps.googleapis.com"]');
    existingScripts.forEach(script => {
      if (script.dataset.failed === 'true') {
        script.remove();
      }
    });

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=initGooglePlaces`;
    script.async = true;
    script.defer = true;
    
    // Set timeout for loading
    const timeout = setTimeout(() => {
      if (!isScriptLoaded) {
        script.dataset.failed = 'true';
        if (retryCount < maxRetries) {
          retryCountRef.current = retryCount + 1;
          loadGoogleMapsScript(retryCount + 1);
        } else {
          setLoadError(true);
          setErrorMessage("Connection timeout. Please check your internet connection.");
          setIsLoading(false);
        }
      }
    }, 10000); // 10 second timeout

    window.initGooglePlaces = () => {
      clearTimeout(timeout);
      if (window.google && window.google.maps && window.google.maps.places) {
        setIsScriptLoaded(true);
        setIsLoading(false);
        setLoadError(false);
        retryCountRef.current = 0;
      } else {
        if (retryCount < maxRetries) {
          retryCountRef.current = retryCount + 1;
          loadGoogleMapsScript(retryCount + 1);
        } else {
          setLoadError(true);
          setErrorMessage("Failed to initialize Google Places");
          setIsLoading(false);
        }
      }
    };

    script.onerror = () => {
      clearTimeout(timeout);
      script.dataset.failed = 'true';
      if (retryCount < maxRetries) {
        retryCountRef.current = retryCount + 1;
        setTimeout(() => loadGoogleMapsScript(retryCount + 1), 1000 * (retryCount + 1));
      } else {
        setLoadError(true);
        setErrorMessage("Location search blocked. This may be due to an ad blocker or network restriction.");
        setIsLoading(false);
      }
    };

    document.head.appendChild(script);
  };

  useEffect(() => {
    if (window.google && window.google.maps && window.google.maps.places) {
      setIsScriptLoaded(true);
      setIsLoading(false);
      return;
    }

    const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existingScript && !existingScript.dataset.failed) {
      const checkExisting = () => {
        if (window.google && window.google.maps && window.google.maps.places) {
          setIsScriptLoaded(true);
          setIsLoading(false);
        } else {
          setTimeout(checkExisting, 500);
        }
      };
      checkExisting();
      return;
    }

    loadGoogleMapsScript(0);
  }, []);

  useEffect(() => {
    if (!isScriptLoaded || !inputRef.current || loadError) return;

    // Clean up existing autocomplete instance
    if (autocompleteRef.current) {
      window.google.maps.event.clearInstanceListeners(autocompleteRef.current);
      autocompleteRef.current = null;
    }

    try {
      const autocomplete = new window.google.maps.places.Autocomplete(inputRef.current, {
        types: ["(regions)"],
        fields: ["place_id", "formatted_address", "geometry", "name", "address_components"]
      });

      autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();

        if (!place.geometry) {
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

        // US States list
        const usStates = [
          'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 
          'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 
          'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 
          'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 
          'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 
          'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 
          'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 
          'Wisconsin', 'Wyoming'
        ];

        const locationName = place.formatted_address || place.name || '';
        
        // Check if it's a state or county
        const isState = usStates.some(state => locationName.includes(state) && !locationName.includes(','));
        const isCounty = locationName.toLowerCase().includes('county');
        
        // Determine if this is a city/town/municipality (and not a state or county)
        const isCity = !isState && !isCounty && addressComponents.some(component => 
          component.types.includes('locality') || 
          component.types.includes('sublocality') ||
          component.types.includes('postal_town')
        );

        const meta = {
          name: place.formatted_address || place.name,
          label: place.formatted_address || place.name,
          lat: place.geometry.location.lat(),
          lon: place.geometry.location.lng(),
          place_id: place.place_id,
          source: "google",
          originalName: place.formatted_address || place.name,
          originalLabel: place.formatted_address || place.name,
          isGreaterArea: false,
          isCity: isCity
        };

        // Check if already added using ref to avoid stale closure
        if (selectedLocationsRef.current.some(loc => loc.place_id === meta.place_id)) {
          alert("This location has already been added.");
          setCurrentInput("");
          return;
        }

        onAdd(meta);
        setCurrentInput("");
      });

      autocompleteRef.current = autocomplete;
    } catch {
      setLoadError(true);
    }

    // Cleanup on unmount or when dependencies change
    return () => {
      if (autocompleteRef.current) {
        window.google.maps.event.clearInstanceListeners(autocompleteRef.current);
      }
    };
  }, [isScriptLoaded, loadError, selectedLocations.length]);

  const canAddMore = selectedLocations.length < maxLocations;

  const handleManualAdd = () => {
    if (!manualInput.trim()) return;
    
    // Check for duplicates
    if (selectedLocationsRef.current.some(loc => 
      (loc.name || loc.label || '').toLowerCase() === manualInput.trim().toLowerCase()
    )) {
      alert("This location has already been added.");
      setManualInput("");
      return;
    }

    const meta = {
      name: manualInput.trim(),
      label: manualInput.trim(),
      lat: null,
      lon: null,
      place_id: `manual-${Date.now()}`,
      source: "manual",
      originalName: manualInput.trim(),
      originalLabel: manualInput.trim(),
      isGreaterArea: false,
      isCity: false
    };

    onAdd(meta);
    setManualInput("");
    setShowManualEntry(false);
  };

  const handleRetry = () => {
    setLoadError(false);
    setIsLoading(true);
    setErrorMessage("");
    retryCountRef.current = 0;
    loadGoogleMapsScript(0);
  };

  // Move US states list to top level to avoid recreation
  const US_STATES = [
    'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 
    'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 
    'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 
    'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 
    'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 
    'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 
    'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 
    'Wisconsin', 'Wyoming'
  ];

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
              
              {(() => {
                const locationName = location.name || location.label || '';
                const hasCounty = locationName.toLowerCase().includes('county');
                const hasState = US_STATES.some(state => locationName.includes(state));
                const showCheckbox = !hasCounty && !hasState;

                return showCheckbox ? (
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

                        // Update in place instead of remove+add
                        onUpdate(index, updatedLocation);
                      }}
                      className="w-4 h-4 rounded border-green-400 text-green-600 focus:ring-green-500"
                    />
                    <span className="font-medium">Greater Area (expands beyond city limits)</span>
                  </label>
                ) : null;
              })()}
            </div>
          ))}
        </div>
      )}

      {canAddMore && !externalDisabled && (
        <>
          {isLoading && !isScriptLoaded && (
            <div className="text-center py-8">
              <div className="inline-flex items-center gap-3 text-blue-600">
                <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span className="text-sm font-medium">Loading location search...</span>
              </div>
            </div>
          )}

          {!loadError && isScriptLoaded && (
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

              <div className="space-y-2">
                <div className="text-sm text-slate-600 bg-blue-50 border border-blue-200 rounded-lg p-3">
                  💡 Start typing a city or region name, then select from the dropdown. Each validated location counts toward your selection balance.
                </div>
                <button
                  type="button"
                  onClick={() => setShowManualEntry(!showManualEntry)}
                  className="text-sm text-blue-600 hover:text-blue-700 underline"
                >
                  {showManualEntry ? 'Hide manual entry' : 'Can\'t find your location? Add manually'}
                </button>
              </div>
            </>
          )}

          {loadError && (
            <div className="space-y-4">
              <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-400 flex items-center justify-center text-white font-bold text-sm">!</div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-amber-900 mb-1">Location Search Unavailable</h4>
                    <p className="text-sm text-amber-800 mb-3">{errorMessage}</p>
                    <div className="text-xs text-amber-700 space-y-1 mb-3">
                      <p><strong>Common fixes:</strong></p>
                      <ul className="list-disc list-inside ml-2 space-y-0.5">
                        <li>Disable ad blockers for this site</li>
                        <li>Check your internet connection</li>
                        <li>Try a different browser</li>
                        <li>Disable browser extensions temporarily</li>
                      </ul>
                    </div>
                    <button
                      type="button"
                      onClick={handleRetry}
                      className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      Try Again
                    </button>
                  </div>
                </div>
              </div>
              
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <p className="text-sm text-blue-800 font-medium mb-2">Or add locations manually:</p>
                <button
                  type="button"
                  onClick={() => setShowManualEntry(true)}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium underline"
                >
                  Switch to manual entry
                </button>
              </div>
            </div>
          )}

          {(loadError || showManualEntry) && (
            <div className="space-y-3">
              <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                ⚠️ Location search unavailable. Use manual entry below.
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Enter location manually (e.g., Nashville, TN)"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleManualAdd()}
                  className="flex-1 p-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={handleManualAdd}
                  disabled={!manualInput.trim()}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-colors flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Add
                </button>
              </div>
              <div className="text-xs text-slate-500">
                Manually entered locations will be saved as-is without validation.
              </div>
            </div>
          )}
        </>
      )}

      {(!canAddMore || externalDisabled) && (
        <div className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
          {externalDisabled 
            ? 'Selection limit of 25 reached across Services, Industries, and Locations. Remove selections to add more.'
            : `Maximum of ${maxLocations} locations reached. Remove a location to add another.`
          }
        </div>
      )}
    </div>
  );
}