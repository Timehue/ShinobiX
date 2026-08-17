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

// Write static copies of the legal pages (privacy, terms, …) into dist. They are
// client-side routes, so without this step the SPA shell is all a crawler that
// does not execute JavaScript gets at those URLs — including the one Google's
// OAuth brand verification follows from the consent screen's privacy policy link.
// Runs after vite build because it rewrites the built index.html per page.
const prerender = spawnSync(
    process.execPath,
    [
        path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
        // tsx reads the nearest tsconfig.json, and the client's is a
        // references-only stub with no compilerOptions. Point it at the real one
        // or JSX compiles to the classic React.createElement form and the script
        // dies on "React is not defined".
        '--tsconfig', path.join(clientRoot, 'tsconfig.app.json'),
        path.join(clientRoot, 'scripts', 'prerender-legal.mts'),
    ],
    { cwd: clientRoot, env: process.env, stdio: 'inherit', windowsHide: true },
);
if (prerender.error) throw prerender.error;
if (prerender.status !== 0) process.exit(prerender.status ?? 1);
