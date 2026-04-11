const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(projectRoot, '..');

function getCandidatePythonPaths() {
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

  return candidates;
}

function resolvePythonCommand() {
  for (const candidate of getCandidatePythonPaths()) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return process.platform === 'win32' ? 'py' : 'python3';
}

const pythonCommand = resolvePythonCommand();
const child = spawn(pythonCommand, process.argv.slice(2), {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: false,
});

child.on('exit', code => {
  process.exit(code ?? 1);
});

child.on('error', error => {
  console.error(`Failed to start Python using "${pythonCommand}": ${error.message}`);
  process.exit(1);
});
