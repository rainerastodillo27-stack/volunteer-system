import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  StyleSheet,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { loadGoogleMaps } from '../utils/webGoogleMaps';
import { resolveLocationCoordinates, type LocationSelection } from '../utils/locationGeocoding';

export interface LocationMapPickerProps {
  latitude?: string | number;
  longitude?: string | number;
  address?: string;
  onLocationChange: (location: {
    latitude: number;
    longitude: number;
    address?: string;
  }) => void;
  height?: number;
  label?: string;
  hint?: string;
  isDesktop?: boolean;
  locationSelection?: LocationSelection;
  isResolvingLocation?: boolean;
  locationError?: string;
}

const MapHost = 'div' as any;
const NativeMapsModule: any = Platform.OS === 'web' ? null : require('react-native-maps');
const NativeMapView: any = NativeMapsModule?.default || NativeMapsModule;
const NativeMarker: any = NativeMapsModule?.Marker;
const NativeGoogleProvider: any = NativeMapsModule?.PROVIDER_GOOGLE;

function getWebGoogleMapsApiKey(): string {
  return (
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY ||
    process.env.GOOGLE_MAPS_WEB_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_WEB_API_KEY ||
    'AIzaSyDrZWSM9FJ7pURqvnd2lNqK5y0I084kupE'
  );
}

// Default center: Negros Oriental / Central Visayas area (approx. Bais / Dumaguete), or Philippines center
const DEFAULT_LAT = 9.5910;
const DEFAULT_LNG = 123.1219;

export default function LocationMapPicker({
  latitude,
  longitude,
  address = '',
  onLocationChange,
  height = 260,
  label = 'Pin Location on Map',
  hint = 'Click anywhere on the map or drag the pin to set the exact location.',
  isDesktop = true,
  locationSelection = {},
  isResolvingLocation = false,
  locationError,
}: LocationMapPickerProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const nativeMapRef = useRef<any>(null);
  const onLocationChangeRef = useRef(onLocationChange);
  const requestGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const mapListenersRef = useRef<any[]>([]);
  onLocationChangeRef.current = onLocationChange;

  const [searchQuery, setSearchQuery] = useState(address || '');
  const [isSearching, setIsSearching] = useState(false);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const parsedLat = typeof latitude === 'number' ? latitude : parseFloat(String(latitude ?? ''));
  const parsedLng = typeof longitude === 'number' ? longitude : parseFloat(String(longitude ?? ''));
  const hasValidCoords = Number.isFinite(parsedLat) && Number.isFinite(parsedLng) &&
    Math.abs(parsedLat) <= 90 && Math.abs(parsedLng) <= 180 &&
    !(parsedLat === 0 && parsedLng === 0);
  const latestPointRef = useRef<{ latitude: number; longitude: number } | null>(null);
  latestPointRef.current = hasValidCoords ? { latitude: parsedLat, longitude: parsedLng } : null;
  const locationContext = JSON.stringify([
    address,
    locationSelection.barangay || '',
    locationSelection.city || '',
    locationSelection.province || '',
  ]);
  const locationContextRef = useRef(locationContext);
  locationContextRef.current = locationContext;

  const currentLat = hasValidCoords ? parsedLat : DEFAULT_LAT;
  const currentLng = hasValidCoords ? parsedLng : DEFAULT_LNG;
  const nativeRegion = {
    latitude: currentLat,
    longitude: currentLng,
    latitudeDelta: hasValidCoords ? 0.04 : 0.3,
    longitudeDelta: hasValidCoords ? 0.04 : 0.3,
  };

  // A changed selection invalidates searches and reverse lookups from the previous place.
  useEffect(() => {
    requestGenerationRef.current += 1;
    setSearchQuery(address);
    setIsSearching(false);
    setSearchError(null);
  }, [locationContext]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
      mapListenersRef.current.forEach(listener => listener?.remove?.());
      mapListenersRef.current = [];
      markerRef.current?.setMap?.(null);
    };
  }, []);

  // Reverse geocode a lat/lng using Google Geocoder or Nominatim fallback
  const reverseGeocode = useCallback(
    async (lat: number, lng: number): Promise<string> => {
      try {
        if (typeof window !== 'undefined' && (window as any).google?.maps?.Geocoder) {
          const geocoder = new (window as any).google.maps.Geocoder();
          const response = await new Promise<any>((resolve, reject) => {
            geocoder.geocode({ location: { lat, lng } }, (results: any, status: string) => {
              if (status === 'OK' && results && results[0]) {
                resolve(results[0].formatted_address);
              } else {
                reject(new Error(`Geocoder status: ${status}`));
              }
            });
          });
          if (response) return response;
        }
      } catch (e) {
        // Fallback to Nominatim
      }

      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
          {
            headers: {
              'User-Agent': 'NVC-Connect-Volunteer-System/1.0',
            },
          }
        );
        const data = await res.json();
        if (data && data.display_name) {
          return data.display_name;
        }
      } catch (e) {
        console.warn('[LocationMapPicker] Reverse geocode fallback failed:', e);
      }
      return '';
    },
    []
  );

  const handleCoordinateChange = useCallback(
    async (coordinate: { latitude: number; longitude: number }) => {
      const requestGeneration = ++requestGenerationRef.current;
      const context = locationContextRef.current;
      latestPointRef.current = coordinate;
      setIsSearching(false);
      setSearchError(null);
      if (mapInstanceRef.current && markerRef.current) {
        markerRef.current.setPosition({ lat: coordinate.latitude, lng: coordinate.longitude });
        markerRef.current.setMap(mapInstanceRef.current);
      }
      // Save the point immediately. Reverse geocoding may only enrich this same point.
      onLocationChangeRef.current(coordinate);

      const resolvedAddress = await reverseGeocode(coordinate.latitude, coordinate.longitude);
      const latestPoint = latestPointRef.current;
      if (!mountedRef.current || requestGeneration !== requestGenerationRef.current ||
          context !== locationContextRef.current || !latestPoint ||
          latestPoint.latitude !== coordinate.latitude || latestPoint.longitude !== coordinate.longitude) {
        return;
      }
      if (resolvedAddress) {
        setSearchQuery(resolvedAddress);
        onLocationChangeRef.current({ ...coordinate, address: resolvedAddress });
      }
    },
    [reverseGeocode]
  );

  // Initialize and update Google Map
  useEffect(() => {
    if (Platform.OS !== 'web' || !mapElementRef.current) return;

    let cancelled = false;

    const initMap = async () => {
      try {
        const apiKey = getWebGoogleMapsApiKey();
        const googleMaps = await loadGoogleMaps(apiKey);
        if (cancelled || !mapElementRef.current) return;

        const centerPos = { lat: currentLat, lng: currentLng };

        if (!mapInstanceRef.current) {
          const map = new googleMaps.maps.Map(mapElementRef.current, {
            center: centerPos,
            zoom: hasValidCoords ? 15 : 10,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            zoomControl: true,
          });
          mapInstanceRef.current = map;

          const marker = new googleMaps.maps.Marker({
            position: centerPos,
            map: hasValidCoords ? map : null,
            draggable: true,
            title: 'Drag pin to set exact location',
            animation: (googleMaps.maps as any).Animation?.DROP,
          } as any);
          markerRef.current = marker;

          // Click on map to reposition pin
          mapListenersRef.current.push((map as any).addListener('click', (e: any) => {
            void handleCoordinateChange({ latitude: e.latLng.lat(), longitude: e.latLng.lng() });
          }));

          // Drag pin to reposition
          mapListenersRef.current.push((marker as any).addListener('dragend', () => {
            const pos = (marker as any).getPosition();
            if (pos) {
              void handleCoordinateChange({ latitude: pos.lat(), longitude: pos.lng() });
            }
          }));

          setIsMapLoaded(true);
          setMapError(null);
        } else {
          // An unresolved selection has a map center, but no saved pin.
          markerRef.current?.setMap?.(hasValidCoords ? mapInstanceRef.current : null);
          if (!hasValidCoords) return;
          const currentMarkerPos = (markerRef.current as any)?.getPosition?.();
          if (currentMarkerPos) {
            const latDiff = Math.abs(currentMarkerPos.lat() - currentLat);
            const lngDiff = Math.abs(currentMarkerPos.lng() - currentLng);
            if (latDiff > 0.0000001 || lngDiff > 0.0000001) {
              const newPos = { lat: currentLat, lng: currentLng };
              (markerRef.current as any)?.setPosition?.(newPos);
              mapInstanceRef.current.setCenter(newPos);
              if (hasValidCoords) {
                mapInstanceRef.current.setZoom(15);
              }
            }
          }
        }
      } catch (err: any) {
        console.warn('[LocationMapPicker] Load failed:', err);
        setMapError(err?.message || 'Google Maps failed to load');
      }
    };

    initMap();

    return () => {
      cancelled = true;
    };
  }, [currentLat, currentLng, hasValidCoords, locationContext]);

  useEffect(() => {
    if (Platform.OS === 'web' || !hasValidCoords) return;
    nativeMapRef.current?.animateToRegion?.(nativeRegion, 300);
  }, [currentLat, currentLng, hasValidCoords]);

  const handleSearch = async () => {
    const query = searchQuery.trim();
    if (!query) return;

    const requestGeneration = ++requestGenerationRef.current;
    const context = locationContextRef.current;
    setIsSearching(true);
    setSearchError(null);

    try {
      const result = await resolveLocationCoordinates(query, locationSelection, {
        allowCityFallback: !locationSelection.barangay,
      });
      if (!mountedRef.current || requestGeneration !== requestGenerationRef.current ||
          context !== locationContextRef.current) {
        return;
      }
      if (!result) {
        setSearchError(locationSelection.barangay
          ? 'Could not locate this barangay. Click the map to choose the event location.'
          : 'Location not found. Try another address or click the map to choose a location.');
        return;
      }

      latestPointRef.current = { latitude: result.latitude, longitude: result.longitude };
      setSearchQuery(result.address || query);
      if (mapInstanceRef.current && markerRef.current) {
        const newPosition = { lat: result.latitude, lng: result.longitude };
        markerRef.current.setPosition(newPosition);
        markerRef.current.setMap(mapInstanceRef.current);
        mapInstanceRef.current.setCenter(newPosition);
        mapInstanceRef.current.setZoom(15);
      }
      nativeMapRef.current?.animateToRegion?.({
        latitude: result.latitude,
        longitude: result.longitude,
        latitudeDelta: 0.04,
        longitudeDelta: 0.04,
      }, 300);
      onLocationChangeRef.current(result);
    } catch (error) {
      if (mountedRef.current && requestGeneration === requestGenerationRef.current &&
          context === locationContextRef.current) {
        console.warn('[LocationMapPicker] Search failed:', error);
        setSearchError('Could not find the location. Try again or click the map to choose a point.');
      }
    } finally {
      if (mountedRef.current && requestGeneration === requestGenerationRef.current &&
          context === locationContextRef.current) {
        setIsSearching(false);
      }
    }
  };

  const isLocating = isSearching || isResolvingLocation;
  const displayedLocationError = searchError || locationError;


  return (
    <View style={styles.wrapper}>
      {/* Label and Hint */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <MaterialIcons name="pin-drop" size={16} color="#166534" />
          <Text style={styles.label}>{label}</Text>
        </View>
        <Text style={styles.hint}>{hint}</Text>
      </View>

      {/* Search Bar */}
      <View style={[styles.searchRow, !isDesktop && styles.searchRowMobile]}>
        <TextInput
          style={[styles.searchInput, !isDesktop && styles.searchInputMobile]}
          placeholder="Search location or address on map"
          placeholderTextColor="#94a3b8"
          value={searchQuery}
          onChangeText={value => {
            requestGenerationRef.current += 1;
            setIsSearching(false);
            setSearchError(null);
            setSearchQuery(value);
          }}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
          multiline={!isDesktop}
          numberOfLines={!isDesktop ? 2 : 1}
        />
        <TouchableOpacity
          onPress={handleSearch}
          disabled={isSearching}
          style={[styles.searchButton, !isDesktop && styles.searchButtonMobile, isSearching && styles.searchButtonDisabled]}
          activeOpacity={0.8}
        >
          {isSearching ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <>
              <MaterialIcons name="search" size={15} color="#ffffff" />
              <Text style={styles.searchButtonText}>Search</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Google Map Container */}
      <View style={[styles.mapContainer, { height, minHeight: height }]}>
        {Platform.OS === 'web' ? (
          <MapHost
            ref={mapElementRef}
            style={{
              width: '100%',
              height: '100%',
              minHeight: height,
              position: 'relative',
              backgroundColor: '#f1f5f9',
            }}
          />
        ) : NativeMapView && NativeMarker ? (
          <NativeMapView
            ref={(map: any) => {
              nativeMapRef.current = map;
            }}
            style={styles.nativeMap}
            initialRegion={nativeRegion}
            provider={Platform.OS === 'android' ? NativeGoogleProvider : undefined}
            mapType="standard"
            showsCompass
            showsScale
            toolbarEnabled
            onPress={(event: any) => {
              void handleCoordinateChange(event.nativeEvent.coordinate);
            }}
          >
            {hasValidCoords && <NativeMarker
              coordinate={{ latitude: currentLat, longitude: currentLng }}
              draggable
              title="Drag pin to set exact location"
              onDragEnd={(event: any) => {
                void handleCoordinateChange(event.nativeEvent.coordinate);
              }}
            />}
          </NativeMapView>
        ) : (
          <View style={styles.nativeFallback}>
            <MaterialIcons name="warning" size={40} color="#dc2626" />
            <Text style={styles.nativeFallbackText}>Interactive map is unavailable on this device.</Text>
          </View>
        )}

        {/* Loading overlay while map initializes */}
        {!isMapLoaded && !mapError && Platform.OS === 'web' && (
          <View style={styles.mapLoadingOverlay}>
            <ActivityIndicator size="small" color="#166534" />
            <Text style={styles.mapLoadingText}>Loading Google Map...</Text>
          </View>
        )}

        {/* Error overlay if map fails to load */}
        {mapError && (
          <View style={styles.mapErrorOverlay}>
            <MaterialIcons name="warning" size={24} color="#dc2626" />
            <Text style={styles.mapErrorText}>Could not load interactive map</Text>
            <Text style={styles.mapErrorSubtext}>{mapError}</Text>
          </View>
        )}
      </View>

      {/* Pinned Coordinates Status Footer */}
      <View style={styles.footerRow}>
        <View style={[styles.coordBadge, !hasValidCoords && styles.coordBadgeUnresolved]}>
          {isLocating
            ? <ActivityIndicator size="small" color="#166534" />
            : <MaterialIcons name="place" size={13} color={hasValidCoords ? '#166534' : '#92400e'} />}
          <Text style={[styles.coordText, !hasValidCoords && styles.coordTextUnresolved]}>
            {isLocating ? 'Locating selected area...'
              : hasValidCoords
              ? `Pin: ${parsedLat.toFixed(5)}, ${parsedLng.toFixed(5)}`
              : 'No pin selected. Click the map to choose a location.'}
          </Text>
        </View>
        {searchQuery ? (
          <Text style={styles.addressSummary} numberOfLines={1}>
            {searchQuery}
          </Text>
        ) : null}
      </View>
      {displayedLocationError && !isLocating ? (
        <Text style={styles.locationError}>{displayedLocationError}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 8,
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  hint: {
    fontSize: 11,
    color: '#64748b',
    fontStyle: 'italic',
  },
  searchRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  searchRowMobile: {
    alignItems: 'stretch',
  },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: '#1e293b',
    backgroundColor: '#ffffff',
  },
  searchInputMobile: {
    height: 48,
    minHeight: 48,
    paddingVertical: 0,
    lineHeight: 20,
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  searchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#166534',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 85,
  },
  searchButtonMobile: {
    minHeight: 48,
    paddingVertical: 0,
  },
  searchButtonDisabled: {
    opacity: 0.6,
  },
  searchButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },
  mapContainer: {
    width: '100%',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#e2e8f0',
  },
  nativeMap: {
    flex: 1,
    width: '100%',
  },
  mapLoadingOverlay: {
    ...(StyleSheet.absoluteFill as any),
    backgroundColor: 'rgba(248, 250, 252, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    zIndex: 10,
  },
  mapLoadingText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '600',
  },
  mapErrorOverlay: {
    ...(StyleSheet.absoluteFill as any),
    backgroundColor: '#fef2f2',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    gap: 4,
    zIndex: 10,
  },
  mapErrorText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#b91c1c',
  },
  mapErrorSubtext: {
    fontSize: 11,
    color: '#dc2626',
    textAlign: 'center',
  },
  nativeFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 20,
  },
  nativeFallbackText: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '600',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  coordBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f0fdf4',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  coordText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
  },
  coordBadgeUnresolved: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
  },
  coordTextUnresolved: {
    color: '#92400e',
  },
  locationError: {
    fontSize: 11,
    color: '#b45309',
    lineHeight: 16,
  },
  addressSummary: {
    fontSize: 11,
    color: '#64748b',
    flex: 1,
    textAlign: 'right',
  },
});
