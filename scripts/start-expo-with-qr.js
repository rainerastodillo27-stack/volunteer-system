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
const { getPreferredLanIp } = require('./lan-ip');
const { loadLocalEnv } = require('./load-local-env');

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
  console.log('\x1b[32m✅ SERVICES STATUS:\x1b[0m');
  console.log('   Backend:  \x1b[33mhttp://127.0.0.1:8000\x1b[0m');
  console.log('   Web App:  \x1b[33mPress "w" after Expo starts\x1b[0m');
  console.log('   Expo:     \x1b[33m' + expoUrl + '\x1b[0m');
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
      REACT_NATIVE_PACKAGER_HOSTNAME: lanIp,
    },
  });

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

