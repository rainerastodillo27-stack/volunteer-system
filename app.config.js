const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

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

function ensureBackendStarted() {
  if (process.env.VOLCRE_AUTO_START_BACKEND === 'false') {
    return;
  }

  if (isBackendRunning()) {
    return;
  }

  const appDir = __dirname;
  const isWindows = process.platform === 'win32';
  const command = isWindows ? 'py' : 'python3';
  const args = ['-m', 'uvicorn', 'backend.api:app', '--host', '0.0.0.0', '--port', '8000', '--ws', 'websockets'];

  const child = spawn(command, args, {
    cwd: appDir,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });

  child.unref();
}

module.exports = () => {
  loadLocalEnv();
  ensureBackendStarted();

  const lanApiBaseUrl = process.env.VOLCRE_API_BASE_URL || `http://${getLanIp()}:8000`;
  const webApiBaseUrl = process.env.VOLCRE_WEB_API_BASE_URL || 'http://127.0.0.1:8000';
  const androidGoogleMapsApiKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY || '';
  const webGoogleMapsApiKey = process.env.GOOGLE_MAPS_WEB_API_KEY || '';

  return {
    expo: {
      name: 'Volcre',
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
