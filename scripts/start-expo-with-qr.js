#!/usr/bin/env node
/**
 * Starts Expo dev server and displays QR code + localhost links
 * This script generates a scannable QR code for the Expo Go app
 * Usage: node scripts/start-expo-with-qr.js
 */

const { spawn } = require('child_process');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { getPreferredLanIp } = require('./lan-ip');
const { loadLocalEnv } = require('./load-local-env');

function findWindowsChromeExecutable() {
  const candidates = [
    path.join(process.env['PROGRAMFILES'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function openBrowser(url, options = {}) {
  if (!url) {
    return;
  }

  const platform = process.platform;
  let command;
  let args = [];
  const preferChrome = options.preferChrome === true;

  if (platform === 'win32') {
    if (preferChrome) {
      const chromePath = findWindowsChromeExecutable();
      if (chromePath) {
        command = chromePath;
        args = [url];
      } else {
        command = 'cmd';
        args = ['/c', 'start', '""', 'chrome', url];
      }
    } else {
      command = 'cmd';
      args = ['/c', 'start', '""', url];
    }
  } else if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  try {
    const browserProcess = spawn(command, args, {
      stdio: 'ignore',
      shell: false,
      detached: true,
    });
    browserProcess.unref();
  } catch (err) {
    console.warn('Unable to open browser automatically:', err.message);
  }
}

function probeUrlOnce(url) {
  return new Promise((resolve) => {
    try {
      const target = new URL(url);
      const client = target.protocol === 'https:' ? https : http;
      const request = client.request(
        target,
        { method: 'GET', timeout: 1500 },
        (response) => {
          response.resume();
          resolve(true);
        }
      );
      request.on('timeout', () => {
        request.destroy();
        resolve(false);
      });
      request.on('error', () => resolve(false));
      request.end();
    } catch {
      resolve(false);
    }
  });
}

async function waitForUrlReady(url, timeoutMs = 45000, intervalMs = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await probeUrlOnce(url);
    if (ready) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

async function generateQRCode(url, outputPath) {
  try {
    // Generate ASCII QR code for terminal display
    const qrText = await QRCode.toString(url, {
      errorCorrectionLevel: 'H',
      type: 'terminal',
      width: 10,
    });
    
    // Save to file
    fs.writeFileSync(outputPath, qrText, 'utf8');
    return qrText;
  } catch (err) {
    console.error('Error generating QR code:', err.message);
    return null;
  }
}

function displayBanner() {
  console.clear?.() || console.log('\n'.repeat(5));
  console.log('\x1b[36m╔═══════════════════════════════════════════════════════════╗\x1b[0m');
  console.log('\x1b[36m║         🚀 VOLUNTEER SYSTEM - STARTING SERVICES 🚀        ║\x1b[0m');
  console.log('\x1b[36m╚═══════════════════════════════════════════════════════════╝\x1b[0m');
  console.log('\n');
}

function displayLinks(expoUrl, lanIp, qrAscii) {
  const webUrl = 'http://localhost:8081';
  const devToolsUrl = 'http://localhost:19002';

  console.log('\x1b[32m✅ SERVICES STATUS:\x1b[0m');
  console.log('   Backend:   \x1b[33mhttp://127.0.0.1:8000\x1b[0m');
  console.log('   Dev Tools: \x1b[33m' + devToolsUrl + '\x1b[0m');
  console.log('   Web App:   \x1b[33m' + webUrl + '\x1b[0m');
  console.log('   Expo:      \x1b[33m' + expoUrl + '\x1b[0m');
  console.log('\n');
  
  console.log('\x1b[35m📱 MOBILE DEVICE ACCESS (LAN):\x1b[0m');
  console.log('   API:      \x1b[33mhttp://' + lanIp + ':8000\x1b[0m');
  console.log('   Expo:     \x1b[33m' + expoUrl + '\x1b[0m');
  console.log('\n');
  
  console.log('\x1b[36m📲 SCAN FOR EXPO GO (QR Code):\x1b[0m\n');
  if (qrAscii) {
    console.log(qrAscii);
  } else {
    console.log('   [QR Code URL: ' + expoUrl + ']');
  }

  console.log('\n');
  console.log('\x1b[33m💡 QUICK COMMANDS:\x1b[0m');
  console.log('   • Press "w" to open web version in browser');
  console.log('   • Press "a" for Android');
  console.log('   • Press "i" for iOS');
  console.log('   • Press "j" to show dev menu');
  console.log('   • Press "r" to reload');
  console.log('   • Press "Ctrl+C" to stop');
  console.log('\n');
  console.log('\x1b[36m═══════════════════════════════════════════════════════════\x1b[0m\n');
}

async function startExpo() {
  loadLocalEnv(path.join(__dirname, '..'));
  const lanIp = getPreferredLanIp();
  const expoUrl = `exp://${lanIp}:8081/--/`;
  const webUrl = 'http://localhost:8081';

  // Create .dev-pids directory if it doesn't exist
  const devPidsDir = path.join(__dirname, '..', '.dev-pids');
  if (!fs.existsSync(devPidsDir)) {
    fs.mkdirSync(devPidsDir, { recursive: true });
  }

  // Generate QR code before showing banner
  const qrPath = path.join(devPidsDir, 'expo-qr.txt');
  const qrAscii = await generateQRCode(expoUrl, qrPath);

  displayBanner();
  displayLinks(expoUrl, lanIp, qrAscii);

  console.log('🔄 Starting Expo dev server with web support...\n');

  // Start Expo in LAN mode so phones on the same network can open the app.
  const expoProcess = spawn('npx', ['expo', 'start', '--host', 'lan'], {
    stdio: 'inherit',
    shell: true,
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      BROWSER: process.env.BROWSER || 'chrome',
      REACT_NATIVE_PACKAGER_HOSTNAME: lanIp,
    },
  });

  // Open web after localhost responds so we avoid "waiting on localhost" stalls.
  const autoOpenWeb = process.env.AUTO_OPEN_EXPO_WEB !== 'false';
  if (autoOpenWeb) {
    void (async () => {
      const ready = await waitForUrlReady(webUrl);
      if (!ready) {
        console.warn('Web server was not ready within 45s, opening browser anyway.');
      }
      openBrowser(webUrl, { preferChrome: true });
    })();
  }

  expoProcess.on('exit', (code) => {
    // Cleanup QR code on exit
    try {
      if (fs.existsSync(qrPath)) {
        fs.unlinkSync(qrPath);
      }
    } catch (err) {
      // Ignore cleanup errors
    }
    process.exit(code);
  });

  expoProcess.on('error', (err) => {
    console.error('\x1b[31m✗ Failed to start Expo:\x1b[0m', err.message);
    process.exit(1);
  });
}

// Cleanup on process termination
process.on('SIGINT', () => {
  try {
    const qrPath = path.join(__dirname, '..', '.dev-pids', 'expo-qr.txt');
    if (fs.existsSync(qrPath)) {
      fs.unlinkSync(qrPath);
    }
  } catch (err) {
    // Ignore cleanup errors
  }
  process.exit(0);
});

startExpo().catch((err) => {
  console.error('\x1b[31m✗ Error:\x1b[0m', err.message);
  process.exit(1);
});

