import { Project } from '../models/types';

const PHILIPPINES_CENTER = {
  latitude: 12.8797,
  longitude: 121.774,
};

const PHILIPPINES_BOUNDS = {
  south: 4.5,
  west: 116.5,
  north: 21.5,
  east: 127.5,
};

type MessageTarget = 'parent' | 'react-native';

type MapProject = {
  id: string;
  title: string;
  typeLabel: string;
  status: Project['status'];
  markerColor: string;
  volunteersNeeded: number;
  latitude: number;
  longitude: number;
};

function getStatusColor(status: Project['status']) {
  switch (status) {
    case 'Planning':
      return '#2196F3';
    case 'In Progress':
      return '#FFA500';
    case 'On Hold':
      return '#FF9800';
    case 'Completed':
      return '#4CAF50';
    case 'Cancelled':
      return '#f44336';
    default:
      return '#999999';
  }
}

function mapProjects(projects: Project[]): MapProject[] {
  return projects.map(project => ({
    id: project.id,
    title: project.title,
    typeLabel: project.isEvent ? 'Event' : 'Program',
    status: project.status,
    markerColor: project.isEvent ? '#9C27B0' : getStatusColor(project.status),
    volunteersNeeded: project.volunteersNeeded,
    latitude: project.location.latitude,
    longitude: project.location.longitude,
  }));
}

export function buildGoogleMapsHtml({
  apiKey,
  projects,
  messageTarget,
}: {
  apiKey?: string;
  projects: Project[];
  messageTarget: MessageTarget;
}) {
  const projectData = JSON.stringify(mapProjects(projects));
  const postToReactNative = messageTarget === 'react-native';

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }

          html,
          body,
          #map {
            height: 100%;
            width: 100%;
            font-family: Arial, sans-serif;
          }

          body {
            background: #eef5ef;
          }

          #fallback {
            display: none;
            height: 100%;
            width: 100%;
            align-items: center;
            justify-content: center;
            padding: 24px;
            color: #1f2937;
            text-align: center;
            background: linear-gradient(180deg, #f7fcf8 0%, #e6f4ea 100%);
          }

          #fallbackCard {
            max-width: 360px;
            padding: 20px;
            border-radius: 16px;
            background: rgba(255, 255, 255, 0.94);
            box-shadow: 0 18px 40px rgba(0, 0, 0, 0.12);
          }

          .gm-style .gm-style-iw-c {
            padding: 0 !important;
            border-radius: 14px !important;
          }

          .gm-style .gm-style-iw-d {
            overflow: hidden !important;
          }

          .info-card {
            width: 220px;
            padding: 14px;
          }

          .info-title {
            margin-bottom: 8px;
            font-size: 16px;
            font-weight: 700;
            color: #111827;
          }

          .info-chip {
            display: inline-block;
            margin-bottom: 10px;
            padding: 4px 10px;
            border-radius: 999px;
            color: #ffffff;
            font-size: 11px;
            font-weight: 700;
          }

          .info-line {
            margin-bottom: 6px;
            font-size: 12px;
            color: #4b5563;
          }

          .info-line strong {
            color: #111827;
          }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <div id="fallback">
          <div id="fallbackCard">
            <strong>Google Maps is not available.</strong>
            <p style="margin-top: 8px;">
              Add a valid <code>GOOGLE_MAPS_API_KEY</code> and make sure the Maps JavaScript API is enabled.
            </p>
          </div>
        </div>
        <script>
          const apiKey = ${JSON.stringify(apiKey || '')};
          const projects = ${projectData};
          const philippinesCenter = ${JSON.stringify(PHILIPPINES_CENTER)};
          const philippinesBounds = ${JSON.stringify(PHILIPPINES_BOUNDS)};
          const postToReactNative = ${JSON.stringify(postToReactNative)};

          function escapeHtml(value) {
            return String(value)
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;');
          }

          function postSelection(projectId) {
            const message = JSON.stringify({ type: 'selectProject', projectId });

            if (postToReactNative && window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
              window.ReactNativeWebView.postMessage(message);
            }

            if (!postToReactNative && window.parent && window.parent !== window) {
              window.parent.postMessage(message, '*');
            }
          }

          function showFallback() {
            document.getElementById('map').style.display = 'none';
            document.getElementById('fallback').style.display = 'flex';
          }

          function buildInfoCard(project) {
            return [
              '<div class="info-card">',
              '<div class="info-title">' + escapeHtml(project.title) + '</div>',
              '<div class="info-chip" style="background:' + escapeHtml(project.markerColor) + ';">' + escapeHtml(project.typeLabel) + '</div>',
              '<div class="info-line"><strong>Status:</strong> ' + escapeHtml(project.status) + '</div>',
              '<div class="info-line"><strong>Location:</strong> ' + escapeHtml(project.latitude.toFixed(4)) + ', ' + escapeHtml(project.longitude.toFixed(4)) + '</div>',
              '<div class="info-line"><strong>Volunteers Needed:</strong> ' + escapeHtml(project.volunteersNeeded) + '</div>',
              '</div>',
            ].join('');
          }

          window.initMap = function initMap() {
            if (!window.google || !window.google.maps) {
              showFallback();
              return;
            }

            const map = new window.google.maps.Map(document.getElementById('map'), {
              center: {
                lat: philippinesCenter.latitude,
                lng: philippinesCenter.longitude,
              },
              zoom: 6,
              minZoom: 5,
              mapTypeControl: false,
              streetViewControl: false,
              fullscreenControl: false,
              restriction: {
                latLngBounds: philippinesBounds,
                strictBounds: false,
              },
            });

            const infoWindow = new window.google.maps.InfoWindow();
            const bounds = new window.google.maps.LatLngBounds();

            projects.forEach(function(project, index) {
              const marker = new window.google.maps.Marker({
                map: map,
                position: {
                  lat: project.latitude,
                  lng: project.longitude,
                },
                title: project.title,
                label: {
                  text: String(index + 1),
                  color: '#ffffff',
                  fontWeight: '700',
                },
                icon: {
                  path: window.google.maps.SymbolPath.CIRCLE,
                  fillColor: project.markerColor,
                  fillOpacity: 1,
                  strokeColor: '#ffffff',
                  strokeOpacity: 1,
                  strokeWeight: 2,
                  scale: 12,
                },
              });

              bounds.extend(marker.getPosition());

              marker.addListener('click', function() {
                infoWindow.setContent(buildInfoCard(project));
                infoWindow.open({
                  anchor: marker,
                  map: map,
                });
                postSelection(project.id);
              });
            });

            if (projects.length > 0) {
              map.fitBounds(bounds, 48);
            } else {
              map.fitBounds(philippinesBounds, 48);
            }
          };

          if (!apiKey) {
            showFallback();
          } else {
            const script = document.createElement('script');
            script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(apiKey) + '&callback=initMap';
            script.async = true;
            script.defer = true;
            script.onerror = showFallback;
            document.head.appendChild(script);
          }
        </script>
      </body>
    </html>
  `;
}
