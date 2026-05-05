import React, { useEffect, useRef, useState } from "react";
import { MapPin, X, Plus, Star } from "lucide-react";

const PLACE_FIELDS = ["id", "displayName", "formattedAddress", "location", "addressComponents"];

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
  const autocompleteRef = useRef(null);
  const autocompleteContainerRef = useRef(null);
  const selectedLocationsRef = useRef(selectedLocations);
  const retryCountRef = useRef(0);
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [manualInput, setManualInput] = useState("");
  const [showManualEntry, setShowManualEntry] = useState(false);

  // Keep selectedLocationsRef in sync
  useEffect(() => {
    selectedLocationsRef.current = selectedLocations;
  }, [selectedLocations]);

  const loadGooglePlaces = async (retryCount = 0) => {
    const maxRetries = 3;

    try {
      if (!window.google?.maps?.importLibrary) {
        throw new Error("Google Maps loader unavailable");
      }

      await window.google.maps.importLibrary("places");
      setIsScriptLoaded(true);
      setIsLoading(false);
      setLoadError(false);
      retryCountRef.current = 0;
    } catch (error) {
      if (retryCount < maxRetries) {
        retryCountRef.current = retryCount + 1;
        setTimeout(() => loadGooglePlaces(retryCount + 1), 1000 * (retryCount + 1));
        return;
      }

      setLoadError(true);
      setErrorMessage(
        error?.message?.includes("loader")
          ? "Location search is temporarily unavailable."
          : "Location search blocked. This may be due to an ad blocker or network restriction."
      );
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadGooglePlaces(0);
  }, []);

  const autocompleteCleanupRef = useRef(null);

  useEffect(() => {
    if (!isScriptLoaded || !autocompleteContainerRef.current || loadError) return;

    const buildMetaFromPlace = async (place) => {
      if (!place) return null;

      if (typeof place.fetchFields === "function") {
        await place.fetchFields({ fields: PLACE_FIELDS });
      }

      if (!place.location) return null;

      const addressComponents = place.addressComponents || [];
      const isContinent =
        addressComponents.length === 1 &&
        addressComponents[0].types?.includes("continent");

      if (isContinent) {
        alert("Please select a more specific location such as a city, county, or region. Continents are not allowed.");
        return null;
      }

      const displayName = typeof place.displayName === "string"
        ? place.displayName
        : place.displayName?.text || "";
      const locationName = place.formattedAddress || displayName || "";
      const isState = US_STATES.some((state) => locationName.includes(state) && !locationName.includes(","));
      const isCounty = locationName.toLowerCase().includes("county");
      const isCity = !isState && !isCounty && addressComponents.some((component) =>
        component.types?.includes("locality") ||
        component.types?.includes("sublocality") ||
        component.types?.includes("postal_town")
      );

      return {
        name: locationName,
        label: locationName,
        lat: place.location.lat(),
        lon: place.location.lng(),
        place_id: place.id,
        source: "google",
        originalName: locationName,
        originalLabel: locationName,
        isGreaterArea: false,
        isCity
      };
    };

    const mountAutocomplete = async () => {
      try {
        let placeAutocomplete = autocompleteRef.current;

        if (!placeAutocomplete) {
          placeAutocomplete = new window.google.maps.places.PlaceAutocompleteElement({
            includedPrimaryTypes: ["locality", "administrative_area_level_1", "administrative_area_level_2", "postal_town", "sublocality"]
          });
          autocompleteContainerRef.current.innerHTML = "";
          autocompleteContainerRef.current.appendChild(placeAutocomplete);
          autocompleteRef.current = placeAutocomplete;
        }

        if (autocompleteCleanupRef.current) {
          autocompleteCleanupRef.current();
        }

        const handlePlaceSelect = async ({ placePrediction }) => {
          const place = placePrediction?.toPlace ? placePrediction.toPlace() : null;
          const meta = await buildMetaFromPlace(place);

          if (!meta) return;
          if (selectedLocationsRef.current.some((loc) => loc.place_id === meta.place_id)) {
            alert("This location has already been added.");
            if (placeAutocomplete) {
              placeAutocomplete.value = "";
            }
            return;
          }

          onAdd(meta);
          if (placeAutocomplete) {
            placeAutocomplete.value = "";
          }
        };

        placeAutocomplete.addEventListener("gmp-select", handlePlaceSelect);
        autocompleteCleanupRef.current = () => {
          placeAutocomplete.removeEventListener("gmp-select", handlePlaceSelect);
        };
      } catch {
        setLoadError(true);
        setErrorMessage("Failed to initialize Google Places");
      }
    };

    mountAutocomplete();

    return () => {
      if (autocompleteCleanupRef.current) {
        autocompleteCleanupRef.current();
        autocompleteCleanupRef.current = null;
      }
    };
  }, [isScriptLoaded, loadError, onAdd]);

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
    loadGooglePlaces(0);
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
        gmp-place-autocomplete {
          width: 100%;
          display: block;
          background: transparent;
          outline: none;
          box-shadow: none;
          border: none;
        }

        gmp-place-autocomplete:focus,
        gmp-place-autocomplete:focus-visible,
        gmp-place-autocomplete:focus-within {
          outline: none;
          box-shadow: none;
          border: none;
        }

        gmp-place-autocomplete::part(input) {
          width: 100%;
          padding: 1rem;
          border: 1px solid #cbd5e1;
          border-radius: 0.75rem;
          font-size: 1rem;
          line-height: 1.5rem;
          color: #0f172a;
          background: white;
          box-sizing: border-box;
        }

        gmp-place-autocomplete::part(input):focus {
          outline: none;
          border-color: #cbd5e1;
          box-shadow: none;
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
              <div
                ref={autocompleteContainerRef}
                className="w-full bg-transparent"
                aria-label="Search for a city, county, or region"
              />

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