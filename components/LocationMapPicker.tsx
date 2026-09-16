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
import { inferCoordinatesFromPlace } from '../utils/projectMap';

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
}: LocationMapPickerProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const nativeMapRef = useRef<any>(null);

  const [searchQuery, setSearchQuery] = useState(address || '');
  const [isSearching, setIsSearching] = useState(false);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const parsedLat = typeof latitude === 'number' ? latitude : parseFloat(String(latitude || ''));
  const parsedLng = typeof longitude === 'number' ? longitude : parseFloat(String(longitude || ''));
  const hasValidCoords = !isNaN(parsedLat) && !isNaN(parsedLng) && parsedLat !== 0 && parsedLng !== 0;

  const currentLat = hasValidCoords ? parsedLat : DEFAULT_LAT;
  const currentLng = hasValidCoords ? parsedLng : DEFAULT_LNG;
  const nativeRegion = {
    latitude: currentLat,
    longitude: currentLng,
    latitudeDelta: hasValidCoords ? 0.04 : 0.3,
    longitudeDelta: hasValidCoords ? 0.04 : 0.3,
  };

  // Sync searchQuery when external address changes (and input is not focused)
  useEffect(() => {
    if (address && address !== searchQuery && !isSearching) {
      setSearchQuery(address);
    }
  }, [address]);

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
            map: map,
            draggable: true,
            title: 'Drag pin to set exact location',
            animation: (googleMaps.maps as any).Animation?.DROP,
          } as any);
          markerRef.current = marker;

          // Click on map to reposition pin
          (map as any).addListener('click', async (e: any) => {
            const clickedLat = e.latLng.lat();
            const clickedLng = e.latLng.lng();
            (marker as any).setPosition(e.latLng);

            const resolvedAddr = await reverseGeocode(clickedLat, clickedLng);
            if (resolvedAddr) {
              setSearchQuery(resolvedAddr);
            }
            onLocationChange({
              latitude: clickedLat,
              longitude: clickedLng,
              address: resolvedAddr || undefined,
            });
          });

          // Drag pin to reposition
          (marker as any).addListener('dragend', async () => {
            const pos = (marker as any).getPosition();
            const draggedLat = pos.lat();
            const draggedLng = pos.lng();

            const resolvedAddr = await reverseGeocode(draggedLat, draggedLng);
            if (resolvedAddr) {
              setSearchQuery(resolvedAddr);
            }
            onLocationChange({
              latitude: draggedLat,
              longitude: draggedLng,
              address: resolvedAddr || undefined,
            });
          });

          setIsMapLoaded(true);
          setMapError(null);
        } else {
          // Map already exists; check if marker position changed externally
          const currentMarkerPos = (markerRef.current as any)?.getPosition?.();
          if (currentMarkerPos) {
            const latDiff = Math.abs(currentMarkerPos.lat() - currentLat);
            const lngDiff = Math.abs(currentMarkerPos.lng() - currentLng);
            if (latDiff > 0.0001 || lngDiff > 0.0001) {
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
  }, [currentLat, currentLng, hasValidCoords]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    nativeMapRef.current?.animateToRegion?.(nativeRegion, 300);
  }, [currentLat, currentLng, hasValidCoords]);

  const handleNativeCoordinateChange = useCallback(
    async (coordinate: { latitude: number; longitude: number }) => {
      const resolvedAddr = await reverseGeocode(coordinate.latitude, coordinate.longitude);
      if (resolvedAddr) {
        setSearchQuery(resolvedAddr);
      }
      onLocationChange({
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        address: resolvedAddr || undefined,
      });
    },
    [onLocationChange, reverseGeocode]
  );

  // Handle address search
  const handleSearch = async () => {
    const rawQuery = searchQuery.trim();
    if (!rawQuery) return;

    // Strip parenthetical region codes like "(NIR)", "(BARMM)", "(CAR)" that
    // geocoding services don't recognise, and trim excess whitespace/commas.
    const cleanQuery = rawQuery
      .replace(/\s*\([^)]{1,10}\)/g, '')   // remove short parenthetical codes
      .replace(/,\s*,/g, ',')
      .trim();

    const parts = cleanQuery.split(',').map(p => p.trim()).filter(Boolean);
    const rawCity = parts.length >= 2 ? parts[parts.length >= 3 ? 1 : 0] : parts[0];
    const cleanCity = rawCity ? rawCity.replace(/^City of\s+/i, '').replace(/\s+City$/i, '').trim() : '';

    // Check local DB coordinates for the city/place as an anchor
    const localCoords = inferCoordinatesFromPlace(cleanQuery, [], false) ||
      (cleanCity ? inferCoordinatesFromPlace(cleanCity, [], false) : null) ||
      inferCoordinatesFromPlace(cleanQuery, [], true);

    const distanceKm = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
      const R = 6371;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLng = ((lng2 - lng1) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
          Math.cos((lat2 * Math.PI) / 180) *
          Math.sin(dLng / 2) *
          Math.sin(dLng / 2);
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const MAX_BARANGAY_DISTANCE_KM = 25;

    // Build smart queries to try:
    const queriesToTry = Array.from(new Set([
      // If barangay + city: try "${barangay}, ${cleanCity}, Philippines"
      ...(parts.length >= 3 && cleanCity ? [`${parts[0]}, ${cleanCity}, Philippines`] : []),
      `${cleanQuery}, Philippines`,
      cleanQuery,
      // City with "City of" stripped
      ...(cleanCity ? [`${cleanCity}, Philippines`] : []),
      // city + region (drop barangay prefix if 3+ parts)
      ...(parts.length >= 3 ? [parts.slice(1).join(', ')] : []),
    ]));

    setIsSearching(true);
    try {
      let foundLat: number | null = null;
      let foundLng: number | null = null;
      let foundAddress: string = cleanQuery;

      for (const query of queriesToTry) {
        if (foundLat !== null) break;

        // 1. Try Google Geocoder if available
        if (typeof window !== 'undefined' && (window as any).google?.maps?.Geocoder) {
          try {
            const geocoder = new (window as any).google.maps.Geocoder();
            const geocodeOptions: any = {
              address: query,
              componentRestrictions: { country: 'PH' },
            };
            if (localCoords) {
              const delta = 0.25;
              geocodeOptions.bounds = {
                south: localCoords.latitude - delta,
                west: localCoords.longitude - delta,
                north: localCoords.latitude + delta,
                east: localCoords.longitude + delta,
              };
            }

            const gResult = await new Promise<any>((resolve, reject) => {
              geocoder.geocode(geocodeOptions, (results: any, status: string) => {
                if (status === 'OK' && results && results[0]) {
                  resolve(results[0]);
                } else {
                  reject(new Error(status));
                }
              });
            });

            if (gResult?.geometry?.location) {
              const resLat = gResult.geometry.location.lat();
              const resLng = gResult.geometry.location.lng();
              if (!localCoords || distanceKm(localCoords.latitude, localCoords.longitude, resLat, resLng) <= MAX_BARANGAY_DISTANCE_KM) {
                foundLat = resLat;
                foundLng = resLng;
                foundAddress = gResult.formatted_address || query;
                break;
              }
            }
          } catch (e) {
            // Fall through to Nominatim
          }
        }

        // 2. Fallback to Nominatim search
        if (foundLat === null || foundLng === null) {
          try {
            const response = await fetch(
              `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
              {
                headers: {
                  'User-Agent': 'NVC-Connect-Volunteer-System/1.0',
                },
              }
            );
            const data = await response.json();
            if (data && data.length > 0 && data[0].lat && data[0].lon) {
              const resLat = parseFloat(data[0].lat);
              const resLng = parseFloat(data[0].lon);
              if (!localCoords || distanceKm(localCoords.latitude, localCoords.longitude, resLat, resLng) <= MAX_BARANGAY_DISTANCE_KM) {
                foundLat = resLat;
                foundLng = resLng;
                foundAddress = data[0].display_name;
                break;
              }
            }
          } catch (e) {
            // try next query
          }
        }
      }

      // 3. Fall back to local DB coordinates if search yielded no valid in-bounds point
      if (foundLat === null && localCoords) {
        foundLat = localCoords.latitude;
        foundLng = localCoords.longitude;
        foundAddress = cleanQuery;
      }

      if (foundLat !== null && foundLng !== null) {
        setSearchQuery(foundAddress);
        if (mapInstanceRef.current && markerRef.current) {
          const newPos = { lat: foundLat, lng: foundLng };
          markerRef.current.setPosition(newPos);
          mapInstanceRef.current.setCenter(newPos);
          mapInstanceRef.current.setZoom(15);
        }
        nativeMapRef.current?.animateToRegion?.({
          latitude: foundLat,
          longitude: foundLng,
          latitudeDelta: 0.04,
          longitudeDelta: 0.04,
        }, 300);
        onLocationChange({
          latitude: foundLat,
          longitude: foundLng,
          address: foundAddress,
        });
      } else {
        alert('Location not found. Try searching with city or municipality name.');
      }
    } catch (e) {
      console.warn('[LocationMapPicker] Search error:', e);
      alert('Could not complete search. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };


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
          onChangeText={setSearchQuery}
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
              void handleNativeCoordinateChange(event.nativeEvent.coordinate);
            }}
          >
            <NativeMarker
              coordinate={{ latitude: currentLat, longitude: currentLng }}
              draggable
              title="Drag pin to set exact location"
              onDragEnd={(event: any) => {
                void handleNativeCoordinateChange(event.nativeEvent.coordinate);
              }}
            />
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
        <View style={styles.coordBadge}>
          <MaterialIcons name="place" size={13} color="#166534" />
          <Text style={styles.coordText}>
            {hasValidCoords
              ? `Pin: ${parsedLat.toFixed(5)}, ${parsedLng.toFixed(5)}`
              : 'Pin placed at default center. Click or drag to adjust.'}
          </Text>
        </View>
        {searchQuery ? (
          <Text style={styles.addressSummary} numberOfLines={1}>
            {searchQuery}
          </Text>
        ) : null}
      </View>
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
  addressSummary: {
    fontSize: 11,
    color: '#64748b',
    flex: 1,
    textAlign: 'right',
  },
});
