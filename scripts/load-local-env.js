const fs = require('fs');
const path = require('path');

// Loads project-level .env files into process.env without overwriting existing shell values.
function loadLocalEnv(projectRoot) {
  for (const fileName of ['.env', '.env.local']) {
    const envPath = path.join(projectRoot, fileName);
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

module.exports = {
  loadLocalEnv,
};
