import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientRoot = path.join(repoRoot, 'shinobij.client');
const installMarker = path.join(clientRoot, 'node_modules', '.package-lock.json');

function runNpm(args) {
    const npmEntry = process.env.npm_execpath;
    const command = npmEntry ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const commandArgs = npmEntry ? [npmEntry, ...args] : args;
    const result = spawnSync(command, commandArgs, {
        cwd: clientRoot,
        env: process.env,
        stdio: 'inherit',
        windowsHide: true,
    });

    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}

// Fresh and CI builds still get npm ci's deterministic lockfile install. Local
// builds reuse an already-installed tree so Windows does not try to unlink a
// native Rolldown binding that a recently exited Vite process is releasing.
if (process.env.CI || !existsSync(installMarker)) {
    runNpm(['ci']);
} else {
    console.log('[build:client] Reusing installed client dependencies (set CI=1 for a clean install).');
}

runNpm(['run', 'build']);
