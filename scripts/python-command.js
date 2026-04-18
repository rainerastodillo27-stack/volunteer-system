const fs = require('fs');
const path = require('path');

// Resolves the Python executable the project should use for backend commands.
function resolvePythonCommand(projectRoot) {
  const workspaceRoot = path.resolve(projectRoot, '..');
  const configuredPython = process.env.VOLCRE_PYTHON;
  const candidates = [];

  if (configuredPython) {
    candidates.push(configuredPython);
  }

  if (process.platform === 'win32') {
    candidates.push(
      path.join(projectRoot, '.venv', 'Scripts', 'python.exe'),
      path.join(workspaceRoot, '.venv', 'Scripts', 'python.exe')
    );
  } else {
    candidates.push(
      path.join(projectRoot, '.venv', 'bin', 'python'),
      path.join(workspaceRoot, '.venv', 'bin', 'python')
    );
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return process.platform === 'win32' ? 'py' : 'python3';
}

module.exports = {
  resolvePythonCommand,
};
