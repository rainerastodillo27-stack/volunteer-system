import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Project } from '../models/types';
import { getAllProjects, NEGROS_SAMPLE_PROJECTS } from '../models/storage';

const IFrame = 'iframe' as any;

const PHILIPPINES_CENTER = {
  latitude: 12.8797,
  longitude: 121.774,
};

const PHILIPPINES_BOUNDS = {
  southWest: {
    latitude: 4.5,
    longitude: 116.5,
  },
  northEast: {
    latitude: 21.5,
    longitude: 127.5,
  },
};

export default function MappingScreen({ navigation }: any) {
  const WebViewComponent =
    Platform.OS === 'web' ? null : require('react-native-webview').WebView;
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [loading, setLoading] = useState(true);
  const webViewRef = React.useRef(null);

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      return;
    }

    const handleWindowMessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') {
        return;
      }

      try {
        const data = JSON.parse(event.data);
        if (data.type === 'selectProject') {
          handleProjectSelection(data.projectId);
        }
      } catch (error) {
        console.error('Error handling web map message:', error);
      }
    };

    window.addEventListener('message', handleWindowMessage);
    return () => window.removeEventListener('message', handleWindowMessage);
  }, [projects]);

  const loadProjects = async () => {
    try {
      const allProjects = await getAllProjects();
      setProjects(allProjects.length > 0 ? allProjects : NEGROS_SAMPLE_PROJECTS);
      setLoading(false);
    } catch (error) {
      console.error('Error loading projects for map:', error);
      setProjects(NEGROS_SAMPLE_PROJECTS);
      Alert.alert('Error', 'Failed to load projects. Showing defaults.');
      setLoading(false);
    }
  };

  const getStatusColor = (status: Project['status']) => {
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
        return '#999';
    }
  };

  const getMarkerColor = (project: Project) => {
    if (project.isEvent) return '#9C27B0'; // distinct color for events
    return getStatusColor(project.status);
  };

  const handleProjectSelection = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) {
      return;
    }

    setSelectedProject(project);
    setShowDetails(true);
  };

  const generateLeafletHTML = () => {
    const projectMarkers = projects
      .map(
        (project, index) => `
      L.marker([${project.location.latitude}, ${project.location.longitude}], {
        icon: L.icon({
          iconUrl: 'data:image/svg+xml;utf8,${encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="${getMarkerColor(
              project
            )}" stroke="white" stroke-width="2"/><text x="16" y="20" text-anchor="middle" font-size="12" fill="white" font-weight="bold">${
              index + 1
            }</text></svg>`
          )}',
          iconSize: [32, 32],
          iconAnchor: [16, 32],
          popupAnchor: [0, -32],
        }),
      })
        .addTo(map)
        .bindPopup(\`<div style="font-family: Arial; width: 200px;">
          <h4 style="margin: 0 0 8px 0; color: #333;">${project.title}</h4>
          <p style="margin: 4px 0; font-size: 12px; color: #fff;">
            <span style="background:${project.isEvent ? '#9C27B0' : '#4CAF50'}; padding:4px 8px; border-radius:999px; font-weight:bold;">
              ${project.isEvent ? 'Event' : 'Program'}
            </span>
          </p>
          <p style="margin: 4px 0; font-size: 12px; color: #666;">
            <strong>Type:</strong> ${project.isEvent ? 'Event' : 'Program'}
          </p>
          <p style="margin: 4px 0; font-size: 12px; color: #666;">
            <strong>Status:</strong> <span style="color: ${getStatusColor(
            project.status
          )}; font-weight: bold;">${project.status}</span>
          </p>
          <p style="margin: 4px 0; font-size: 12px; color: #666;">
            <strong>Location:</strong> ${project.location.latitude.toFixed(4)}, ${project.location.longitude.toFixed(4)}
          </p>
          <p style="margin: 4px 0; font-size: 12px; color: #666;">
            <strong>Volunteers Needed:</strong> ${project.volunteersNeeded}
          </p>
        </div>\`)
        .on('click', function() {
          const message = JSON.stringify({
            type: 'selectProject',
            projectId: ${JSON.stringify(project.id)},
            projectTitle: ${JSON.stringify(project.title)},
            projectStatus: ${JSON.stringify(project.status)},
            volunteersNeeded: ${project.volunteersNeeded},
            projectLatitude: ${project.location.latitude},
            projectLongitude: ${project.location.longitude},
          });

          if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
            window.ReactNativeWebView.postMessage(message);
          }

          if (window.parent && window.parent !== window) {
            window.parent.postMessage(message, '*');
          }
        });
    `
      )
      .join('\n');

    const mapBounds = projects
      .map(
        (project) =>
          `[${project.location.latitude}, ${project.location.longitude}]`
      )
      .join(',\n');

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" />
          <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"><\/script>
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            body {
              height: 100vh;
              font-family: Arial, sans-serif;
            }
            #map {
              height: 100%;
              width: 100%;
            }
            .leaflet-popup-content {
              padding: 0 !important;
            }
            .leaflet-popup-content-wrapper {
              border-radius: 8px;
              box-shadow: 0 2px 8px rgba(0,0,0,0.2) !important;
            }
          </style>
        </head>
        <body>
          <div id="map"></div>
          <script>
            // Initialize map centered on the Philippines
            const philippinesBounds = [
              [${PHILIPPINES_BOUNDS.southWest.latitude}, ${PHILIPPINES_BOUNDS.southWest.longitude}],
              [${PHILIPPINES_BOUNDS.northEast.latitude}, ${PHILIPPINES_BOUNDS.northEast.longitude}]
            ];

            const map = L.map('map', {
              maxBounds: philippinesBounds,
              maxBoundsViscosity: 1.0,
              minZoom: 5,
            }).setView([${PHILIPPINES_CENTER.latitude}, ${PHILIPPINES_CENTER.longitude}], 6);

            // Add OpenStreetMap tiles
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
              attribution: '© OpenStreetMap contributors',
              maxZoom: 19,
            }).addTo(map);

            // Add scale control
            L.control.scale().addTo(map);

            // Add zoom control with better positioning
            map.zoomControl.setPosition('bottomright');

            // Add project markers
            ${projectMarkers}

            map.fitBounds(philippinesBounds, { padding: [24, 24] });

            const projectBounds = [${mapBounds}];
            if (projectBounds.length > 0) {
              map.fitBounds(projectBounds, { padding: [32, 32], maxZoom: 11 });
            }

            // Handle messages from React Native
            if (window.ReactNativeWebView) {
              document.addEventListener('click', function(e) {
                // This will be handled by marker click events
              });
            }
          <\/script>
        </body>
      </html>
    `;
  };

  const handleWebViewMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'selectProject') {
        handleProjectSelection(data.projectId);
      }
    } catch (error) {
      console.error('Error handling webview message:', error);
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={styles.loadingText}>Loading map...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Negros Programs and Events</Text>
        <Text style={styles.headerSubtitle}>Marker map for Negros Occidental, Philippines</Text>
      </View>

      {Platform.OS === 'web' ? (
        <View style={styles.webMapContainer}>
          <IFrame
            srcDoc={generateLeafletHTML()}
            style={styles.webMapFrame}
            title="Program locations map"
          />
        </View>
      ) : (
        <WebViewComponent
          ref={webViewRef}
          style={styles.webView}
          source={{ html: generateLeafletHTML() }}
          onMessage={handleWebViewMessage}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          scalesPageToFit={true}
          mixedContentMode="always"
        />
      )}

      <View style={styles.projectListContainer}>
        <Text style={styles.projectListTitle}>Negros markers ({projects.length})</Text>
      </View>

      {/* Project Details Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={showDetails}
        onRequestClose={() => setShowDetails(false)}
      >
        <View style={styles.centeredView}>
          <View style={styles.modalView}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowDetails(false)}
            >
              <MaterialIcons name="close" size={28} color="#333" />
            </TouchableOpacity>

            {selectedProject && (
              <View style={styles.modalContent}>
                <View style={styles.statusBadge}>
                  <View
                    style={[
                      styles.statusDot,
                      { backgroundColor: getStatusColor(selectedProject.status) },
                    ]}
                  />
                  <Text style={styles.statusText}>{selectedProject.status}</Text>
                </View>

                <Text style={styles.projectTitle}>{selectedProject.title}</Text>

                <Text style={styles.description}>{selectedProject.description}</Text>

                <View style={styles.infoGrid}>
                  <View style={styles.infoItem}>
                    <Text style={styles.infoLabel}>Category</Text>
                    <Text style={styles.infoValue}>{selectedProject.category}</Text>
                  </View>
                  <View style={styles.infoItem}>
                    <Text style={styles.infoLabel}>Volunteers Needed</Text>
                    <Text style={styles.infoValue}>
                      {selectedProject.volunteersNeeded}
                    </Text>
                  </View>
                </View>

                <View style={styles.infoGrid}>
                  <View style={styles.infoItem}>
                    <Text style={styles.infoLabel}>Latitude</Text>
                    <Text style={styles.infoValue}>
                      {selectedProject.location.latitude.toFixed(4)}
                    </Text>
                  </View>
                  <View style={styles.infoItem}>
                    <Text style={styles.infoLabel}>Longitude</Text>
                    <Text style={styles.infoValue}>
                      {selectedProject.location.longitude.toFixed(4)}
                    </Text>
                  </View>
                </View>

                <View style={styles.datesGrid}>
                  <View style={styles.infoItem}>
                    <Text style={styles.infoLabel}>Start Date</Text>
                    <Text style={styles.infoValue}>
                      {new Date(selectedProject.startDate).toLocaleDateString()}
                    </Text>
                  </View>
                  <View style={styles.infoItem}>
                    <Text style={styles.infoLabel}>End Date</Text>
                    <Text style={styles.infoValue}>
                      {new Date(selectedProject.endDate).toLocaleDateString()}
                    </Text>
                  </View>
                </View>

                <TouchableOpacity style={styles.viewDetailsButton}>
                  <Text style={styles.viewDetailsButtonText}>View Full Details</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  webMapContainer: {
    height: 420,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e6e6e6',
    overflow: 'hidden',
  },
  webMapFrame: {
    width: '100%',
    height: '100%',
    borderWidth: 0,
  },
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
  },
  webView: {
    flex: 1,
  },
  projectListContainer: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  projectListTitle: {
    fontSize: 13,
    color: '#666',
    fontWeight: '600',
  },
  centeredView: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalView: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingVertical: 20,
    minHeight: '70%',
  },
  closeButton: {
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  modalContent: {
    paddingHorizontal: 20,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#f0f0f0',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 16,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
  },
  projectTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  description: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 20,
  },
  infoGrid: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 16,
  },
  datesGrid: {
    flexDirection: 'row',
    marginBottom: 24,
    gap: 16,
  },
  infoItem: {
    flex: 1,
    backgroundColor: '#f9f9f9',
    padding: 12,
    borderRadius: 8,
  },
  infoLabel: {
    fontSize: 12,
    color: '#999',
    fontWeight: '600',
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 16,
    color: '#333',
    fontWeight: '600',
  },
  viewDetailsButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  viewDetailsButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
