#!/usr/bin/env node
/**
 * Starts Expo dev server and displays QR code + localhost links
 * This script generates a scannable QR code for the Expo Go app
 * Usage: node scripts/start-expo-with-qr.js
 */

const { spawn } = require('child_process');
const os = require('os');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

// Get LAN IP for Expo
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

function displayLinks(expoUrl, webUrl, lanIp, qrAscii) {
  console.log('\x1b[32m✅ SERVICES STATUS:\x1b[0m');
  console.log('   Backend:  \x1b[33mhttp://127.0.0.1:8000\x1b[0m');
  console.log('   Web App:  \x1b[33mhttp://127.0.0.1:8081\x1b[0m');
  console.log('   Expo:     \x1b[33m' + expoUrl + '\x1b[0m');
  console.log('\n');
  
  console.log('\x1b[35m📱 MOBILE DEVICE ACCESS (LAN):\x1b[0m');
  console.log('   API:      \x1b[33mhttp://' + lanIp + ':8000\x1b[0m');
  console.log('   Expo:     \x1b[33mexp://' + lanIp + ':8081\x1b[0m');
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
  const lanIp = getLanIp();
  const expoUrl = `exp://${lanIp}:8081`;
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
  displayLinks(expoUrl, webUrl, lanIp, qrAscii);

  console.log('🔄 Starting Expo dev server with web support...\n');

  // Start Expo with web enabled
  const expoProcess = spawn('npx', ['expo', 'start', '--web'], {
    stdio: 'inherit',
    shell: true,
    cwd: path.join(__dirname, '..'),
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

