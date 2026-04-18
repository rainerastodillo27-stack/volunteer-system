const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { resolvePythonCommand } = require('./scripts/python-command');

// Loads local environment variables from app-level `.env` files before Expo starts.
function loadLocalEnv() {
  for (const fileName of ['.env', '.env.local']) {
    const envPath = path.join(__dirname, fileName);
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const contents = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }

      const separatorIndex = line.indexOf('=');
      if (separatorIndex === -1) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();

      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

// Returns the current machine's LAN IPv4 address for mobile device API access.
function getLanIp() {
  const interfaces = os.networkInterfaces();

  for (const addresses of Object.values(interfaces)) {
    if (!addresses) continue;

    for (const address of addresses) {
      if (address.family === 'IPv4' && !address.internal) {
        return address.address;
      }
    }
  }

  return '127.0.0.1';
}

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
  loadLocalEnv();
  ensureBackendStarted();

  const configuredApiBaseUrl = process.env.VOLCRE_API_BASE_URL || '';
  const lanApiBaseUrl = configuredApiBaseUrl || `http://${getLanIp()}:8000`;
  const webApiBaseUrl =
    process.env.VOLCRE_WEB_API_BASE_URL || configuredApiBaseUrl || 'http://127.0.0.1:8000';
  const androidGoogleMapsApiKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY || '';
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
        config: androidGoogleMapsApiKey
          ? {
              googleMapsApiKey: androidGoogleMapsApiKey,
            }
          : undefined,
      },
      android: {
        adaptiveIcon: {
          backgroundColor: '#ffffff',
        },
        config: androidGoogleMapsApiKey
          ? {
              googleMaps: {
                apiKey: androidGoogleMapsApiKey,
              },
            }
          : undefined,
      },
      scheme: 'volcre',
      extra: {
        apiBaseUrl: lanApiBaseUrl,
        webApiBaseUrl,
        androidGoogleMapsApiKey,
        webGoogleMapsApiKey,
      },
      plugins: ['expo-font'],
    },
  };
};
