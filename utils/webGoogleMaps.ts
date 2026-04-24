import { createWebMapMarkerIcon } from './mapMarkerVisuals';

type GoogleLatLngLiteral = {
  lat: number;
  lng: number;
};

type GoogleMapBoundsLiteral = {
  north: number;
  south: number;
  east: number;
  west: number;
};

type GoogleMapOptions = {
  center: GoogleLatLngLiteral;
  zoom: number;
  minZoom?: number;
  mapTypeId?: 'roadmap' | 'satellite' | 'hybrid' | 'terrain';
  mapTypeControl?: boolean;
  streetViewControl?: boolean;
  fullscreenControl?: boolean;
  zoomControl?: boolean;
  restriction?: {
    latLngBounds: GoogleMapBoundsLiteral;
    strictBounds?: boolean;
  };
};

type GoogleMarkerOptions = {
  position: GoogleLatLngLiteral;
  map: GoogleMapInstance;
  title?: string;
  icon?: {
    url: string;
    scaledSize: GoogleSize;
    anchor: GooglePoint;
  };
};

type GoogleMapsEventListener = {
  remove: () => void;
};

type GoogleMapInstance = {
  fitBounds: (bounds: GoogleLatLngBounds, padding?: number) => void;
  setCenter: (center: GoogleLatLngLiteral) => void;
  setZoom: (zoom: number) => void;
  setOptions: (options: Partial<GoogleMapOptions>) => void;
};

type GoogleMarkerInstance = {
  addListener: (eventName: 'click', handler: () => void) => GoogleMapsEventListener;
  setMap: (map: GoogleMapInstance | null) => void;
};

type GoogleLatLngBounds = {
  extend: (location: GoogleLatLngLiteral) => void;
};

type GoogleSize = object;
type GooglePoint = object;

export type GoogleMapsGlobal = {
  maps: {
    Map: new (element: HTMLElement, options: GoogleMapOptions) => GoogleMapInstance;
    Marker: new (options: GoogleMarkerOptions) => GoogleMarkerInstance;
    LatLngBounds: new () => GoogleLatLngBounds;
    Size: new (width: number, height: number) => GoogleSize;
    Point: new (x: number, y: number) => GooglePoint;
  };
};

declare global {
  interface Window {
    google?: GoogleMapsGlobal;
    __googleMapsAssetsPromise?: Promise<GoogleMapsGlobal>;
    __volcreInitGoogleMaps?: () => void;
  }
}

const GOOGLE_MAPS_SCRIPT_ID = 'volcre-google-maps-js';
const GOOGLE_MAPS_READY_CALLBACK = '__volcreInitGoogleMaps';

function getGoogleMapsScriptUrl(apiKey: string) {
  const params = new URLSearchParams({
    key: apiKey,
    v: 'weekly',
    loading: 'async',
    callback: GOOGLE_MAPS_READY_CALLBACK,
    libraries: 'marker',
  });

  const url = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
  console.log('[Maps] Loading Google Maps from:', url);
  return url;
}

function resolveLoadedGoogleMaps(): GoogleMapsGlobal | null {
  if (window.google?.maps) {
    return window.google;
  }

  return null;
}

// Loads the Google Maps JavaScript API once for browser-based map screens.
export function loadGoogleMaps(apiKey: string) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Google Maps can only load in the browser.'));
  }

  const normalizedApiKey = apiKey.trim();
  if (!normalizedApiKey) {
    return Promise.reject(new Error('Google Maps web API key is missing.'));
  }

  const existingGoogleMaps = resolveLoadedGoogleMaps();
  if (existingGoogleMaps) {
    return Promise.resolve(existingGoogleMaps);
  }

  if (window.__googleMapsAssetsPromise) {
    return window.__googleMapsAssetsPromise;
  }

  window.__googleMapsAssetsPromise = new Promise<GoogleMapsGlobal>((resolve, reject) => {
    const existingScript = document.getElementById(GOOGLE_MAPS_SCRIPT_ID) as HTMLScriptElement | null;

    const cleanup = () => {
      delete window.__volcreInitGoogleMaps;
    };

    const handleReady = () => {
      const googleMaps = resolveLoadedGoogleMaps();
      if (googleMaps) {
        cleanup();
        resolve(googleMaps);
        return;
      }

      cleanup();
      window.__googleMapsAssetsPromise = undefined;
      reject(new Error('Google Maps did not initialize.'));
    };

    const handleError = () => {
      cleanup();
      window.__googleMapsAssetsPromise = undefined;
      const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const errorMsg = isDev 
        ? 'Google Maps failed to load. Check: 1) Maps JavaScript API is enabled in Google Cloud Console, 2) API key is valid, 3) Try setting API key restrictions to "None" temporarily for dev testing.'
        : 'Google Maps script failed to load.';
      console.error('[Maps] Load error:', errorMsg);
      reject(new Error(errorMsg));
    };

    if (existingScript) {
      existingScript.remove();
    }

    window.__volcreInitGoogleMaps = handleReady;

    const script = document.createElement('script');
    script.id = GOOGLE_MAPS_SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.src = getGoogleMapsScriptUrl(normalizedApiKey);
    console.log('[Maps] API key last 4 chars:', normalizedApiKey.slice(-4));
    script.addEventListener('error', handleError, { once: true });
    document.head.appendChild(script);
  });

  return window.__googleMapsAssetsPromise;
}

// Builds the custom project pin used by the browser Google Maps markers.
export function createGoogleMapsMarkerIcon(googleMaps: GoogleMapsGlobal, accentColor: string) {
  return {
    url: createWebMapMarkerIcon({ accentColor }),
    scaledSize: new googleMaps.maps.Size(40, 48),
    anchor: new googleMaps.maps.Point(20, 48),
  };
}
