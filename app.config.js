const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { resolvePythonCommand } = require('./scripts/python-command');
const { getPreferredLanIp } = require('./scripts/lan-ip');
const { loadLocalEnv } = require('./scripts/load-local-env');

// Returns whether an address points at the local machine or a private LAN host.
function isLocalBackendUrl(value) {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname;

    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
      return true;
    }

    if (/^10\./.test(hostname) || /^192\.168\./.test(hostname)) {
      return true;
    }

    const match = hostname.match(/^172\.(\d{1,3})\./);
    if (match) {
      const secondOctet = Number.parseInt(match[1], 10);
      return secondOctet >= 16 && secondOctet <= 31;
    }

    return false;
  } catch {
    return false;
  }
}

// Checks whether the app has been pointed at a hosted backend instead of a local one.
function hasRemoteBackendOverride() {
  const configuredUrls = [
    process.env.VOLCRE_API_BASE_URL,
    process.env.VOLCRE_WEB_API_BASE_URL,
  ].filter(Boolean);

  return configuredUrls.some((value) => !isLocalBackendUrl(value));
}

// Detects whether the backend is already listening on port 8000.
function isBackendRunning() {
  try {
    const result = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        "if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) { 'running' }",
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    );

    return result.includes('running');
  } catch {
    return false;
  }
}

// Starts the backend in the background when development mode allows it.
function ensureBackendStarted() {
  if (process.env.VOLCRE_AUTO_START_BACKEND === 'false') {
    return;
  }

  if (hasRemoteBackendOverride()) {
    return;
  }

  if (isBackendRunning()) {
    return;
  }

  const appDir = __dirname;
  const command = resolvePythonCommand(appDir);
  const args = ['-m', 'uvicorn', 'backend.api:app', '--host', '0.0.0.0', '--port', '8000', '--ws', 'websockets'];

  const child = spawn(command, args, {
    cwd: appDir,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });

  child.unref();
}

// Exposes runtime Expo configuration for API URLs and native map keys.
module.exports = () => {
  loadLocalEnv(__dirname);
  ensureBackendStarted();

  const configuredApiBaseUrl = process.env.VOLCRE_API_BASE_URL || '';
  const lanApiBaseUrl = configuredApiBaseUrl || `http://${getPreferredLanIp()}:8000`;
  const webApiBaseUrl =
    process.env.VOLCRE_WEB_API_BASE_URL || configuredApiBaseUrl || 'http://127.0.0.1:8000';
  const mobileGoogleMapsApiKey =
    process.env.GOOGLE_MAPS_MOBILE_API_KEY ||
    process.env.GOOGLE_MAPS_ANDROID_API_KEY ||
    '';
  const webGoogleMapsApiKey = process.env.GOOGLE_MAPS_WEB_API_KEY || '';

  return {
    expo: {
      name: 'NVC CONNECT',
      slug: 'volcre',
      version: '1.0.0',
      orientation: 'portrait',
      assetBundlePatterns: ['**/*'],
      ios: {
        supportsTablet: true,
        config: mobileGoogleMapsApiKey
          ? {
              googleMapsApiKey: mobileGoogleMapsApiKey,
            }
          : undefined,
      },
      android: {
        package: 'com.volcre.nvcconnect',
        versionCode: 1,
        adaptiveIcon: {
          backgroundColor: '#ffffff',
        },
        config: mobileGoogleMapsApiKey
          ? {
              googleMaps: {
                apiKey: mobileGoogleMapsApiKey,
              },
            }
          : undefined,
      },
      scheme: 'volcre',
      extra: {
        apiBaseUrl: lanApiBaseUrl,
        webApiBaseUrl,
        mobileGoogleMapsApiKey,
        androidGoogleMapsApiKey: mobileGoogleMapsApiKey,
        webGoogleMapsApiKey,
      },
      plugins: ['expo-font'],
    },
  };
};
