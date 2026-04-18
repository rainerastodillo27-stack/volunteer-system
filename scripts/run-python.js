const path = require('path');
const { spawn } = require('child_process');
const { resolvePythonCommand } = require('./python-command');

const projectRoot = path.resolve(__dirname, '..');
const pythonCommand = resolvePythonCommand(projectRoot);
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
