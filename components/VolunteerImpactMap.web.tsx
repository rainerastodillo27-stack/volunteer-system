import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Project } from '../models/types';
import {
  PHILIPPINES_BOUNDS,
  PHILIPPINES_WEB_CENTER,
  getProjectMarkerColor,
} from '../utils/projectMap';

const MapHost = 'div' as any;

type VolunteerImpactMapProps = {
  projects: Project[];
};

function getWebGoogleMapsApiKey(): string | undefined {
  const constantsAny = Constants as typeof Constants & {
    manifest?: { extra?: Record<string, unknown> };
    manifest2?: { extra?: { expoClient?: { extra?: Record<string, unknown> } } };
  };

  const fromExpoConfig = Constants.expoConfig?.extra?.webGoogleMapsApiKey;
  const fromManifest = constantsAny.manifest?.extra?.webGoogleMapsApiKey;
  const fromManifest2 = constantsAny.manifest2?.extra?.expoClient?.extra?.webGoogleMapsApiKey;
  const fromPublicEnv = process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY;

  const resolvedKey =
    fromExpoConfig ??
    fromManifest ??
    fromManifest2 ??
    fromPublicEnv;

  return typeof resolvedKey === 'string' && resolvedKey.trim().length > 0
    ? resolvedKey.trim()
    : undefined;
}

function loadGoogleMapsScript(apiKey: string) {
  const browserWindow = window as Window & {
    google?: any;
    __googleMapsScriptPromise?: Promise<void>;
  };

  if (browserWindow.google?.maps) {
    return Promise.resolve();
  }

  if (browserWindow.__googleMapsScriptPromise) {
    return browserWindow.__googleMapsScriptPromise;
  }

  browserWindow.__googleMapsScriptPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.getElementById('google-maps-js-api') as HTMLScriptElement | null;

    const handleLoad = () => {
      if (browserWindow.google?.maps) {
        resolve();
        return;
      }

      reject(new Error('Google Maps JavaScript API did not initialize.'));
    };

    const handleError = () => reject(new Error('Failed to load Google Maps JavaScript API.'));

    if (existingScript) {
      existingScript.addEventListener('load', handleLoad, { once: true });
      existingScript.addEventListener('error', handleError, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = 'google-maps-js-api';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });
    document.head.appendChild(script);
  });

  return browserWindow.__googleMapsScriptPromise;
}

export default function VolunteerImpactMap({ projects }: VolunteerImpactMapProps) {
  const [selectedProject, setSelectedProject] = useState<Project | null>(projects[0] || null);
  const [mapError, setMapError] = useState<string | null>(null);
  const googleMapsApiKey = getWebGoogleMapsApiKey();
  const mapElementRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSelectedProject(projects[0] || null);
  }, [projects]);

  useEffect(() => {
    if (projects.length === 0) {
      return;
    }

    if (!googleMapsApiKey) {
      setMapError('Google Maps web key is missing, so the profile map cannot render on web.');
      return;
    }

    if (!mapElementRef.current) {
      return;
    }

    let cancelled = false;
    const browserWindow = window as Window & {
      google?: any;
      gm_authFailure?: () => void;
    };

    browserWindow.gm_authFailure = () => {
      if (!cancelled) {
        setMapError('Google Maps rejected the web key for this profile map.');
      }
    };

    const renderMap = async () => {
      try {
        await loadGoogleMapsScript(googleMapsApiKey);
        if (cancelled || !mapElementRef.current || !browserWindow.google?.maps) {
          return;
        }

        setMapError(null);

        const map = new browserWindow.google.maps.Map(mapElementRef.current, {
          center: PHILIPPINES_WEB_CENTER,
          zoom: 6,
          minZoom: 5,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          restriction: {
            latLngBounds: PHILIPPINES_BOUNDS,
            strictBounds: false,
          },
        });

        const bounds = new browserWindow.google.maps.LatLngBounds();

        projects.forEach((project, index) => {
          const marker = new browserWindow.google.maps.Marker({
            map,
            position: {
              lat: project.location.latitude,
              lng: project.location.longitude,
            },
            title: project.title,
            label: {
              text: String(index + 1),
              color: '#ffffff',
              fontWeight: '700',
            },
            icon: {
              path: browserWindow.google.maps.SymbolPath.CIRCLE,
              fillColor: getProjectMarkerColor(project),
              fillOpacity: 1,
              strokeColor: '#ffffff',
              strokeOpacity: 1,
              strokeWeight: 2,
              scale: 12,
            },
          });

          bounds.extend(marker.getPosition());

          marker.addListener('click', () => {
            setSelectedProject(project);
          });
        });

        if (projects.length > 0) {
          map.fitBounds(bounds, 48);
        }
      } catch {
        if (!cancelled) {
          setMapError('Google Maps could not load for the profile map.');
        }
      }
    };

    void renderMap();

    return () => {
      cancelled = true;
      if (browserWindow.gm_authFailure) {
        delete browserWindow.gm_authFailure;
      }
    };
  }, [googleMapsApiKey, projects]);

  if (projects.length === 0) {
    return null;
  }

  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <View style={styles.headerIcon}>
          <MaterialIcons name="place" size={18} color="#166534" />
        </View>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Personal Impact Map</Text>
          <Text style={styles.subtitle}>Pinned places where you completed volunteer work.</Text>
        </View>
      </View>

      <View style={styles.mapShell}>
        <MapHost ref={mapElementRef} style={styles.mapHost} />
        {mapError ? (
          <View style={styles.errorOverlay}>
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>Map unavailable on web</Text>
              <Text style={styles.errorText}>{mapError}</Text>
            </View>
          </View>
        ) : null}
      </View>

      {selectedProject && (
        <View style={styles.detailCard}>
          <Text style={styles.detailTitle}>{selectedProject.title}</Text>
          <Text style={styles.detailMeta}>
            {selectedProject.isEvent ? 'Event' : 'Program'} • {selectedProject.category}
          </Text>
          <Text style={styles.detailAddress}>{selectedProject.location.address}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    width: '100%',
    marginBottom: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  mapShell: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#e0f2fe',
    height: 320,
  },
  mapHost: {
    width: '100%',
    height: '100%',
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(239, 246, 255, 0.92)',
    paddingHorizontal: 24,
  },
  errorCard: {
    maxWidth: 380,
    paddingHorizontal: 22,
    paddingVertical: 24,
    backgroundColor: '#ffffff',
    borderRadius: 18,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#12243d',
    textAlign: 'center',
    marginBottom: 10,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#334155',
    textAlign: 'center',
  },
  detailCard: {
    marginTop: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  detailTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  detailMeta: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  detailAddress: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    color: '#475569',
  },
});
