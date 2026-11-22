const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const expoCli = path.join(projectRoot, 'node_modules', 'expo', 'bin', 'cli');
const networkHost = path.join(__dirname, 'network-host.cjs');

process.stdout.write('[RECEIVER] Building the latest TV web app...\n');
const buildArgs = [expoCli, 'export', '--platform', 'web'];
if (process.env.ACTIVE_KIDS_WEB_DIST) buildArgs.push('--output-dir', process.env.ACTIVE_KIDS_WEB_DIST);
const build = spawnSync(process.execPath, buildArgs, {
  cwd: projectRoot,
  stdio: 'inherit',
  env: process.env,
});

if (build.error) {
  process.stderr.write(`[RECEIVER] Web build could not start: ${build.error.message}\n`);
  process.exit(1);
}
if (build.status !== 0) {
  process.stderr.write(`[RECEIVER] Web build failed with exit code ${build.status ?? 'unknown'}.\n`);
  process.exit(build.status ?? 1);
}

process.stdout.write('[RECEIVER] Starting the local network and WebSocket services...\n');
const host = spawn(process.execPath, [networkHost, '--open-browser'], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: process.env,
});

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    if (host.exitCode === null && !host.killed) host.kill(signal);
  });
}

host.once('error', (error) => {
  process.stderr.write(`[RECEIVER] Network service could not start: ${error.message}\n`);
  process.exitCode = 1;
});
host.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
