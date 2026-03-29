const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env');
const envExamplePath = path.join(projectRoot, '.env.example');

if (fs.existsSync(envPath)) {
  console.log('.env already exists.');
  process.exit(0);
}

if (!fs.existsSync(envExamplePath)) {
  console.warn('.env.example was not found, so .env could not be created.');
  process.exit(0);
}

fs.copyFileSync(envExamplePath, envPath);
console.log('Created .env from .env.example. Fill in any real secrets before running the backend.');
