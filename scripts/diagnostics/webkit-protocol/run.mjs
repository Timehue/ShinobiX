import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
// Preserve runtime paths, locale, fixed CI behavior and nonsecret build provenance.
// Omit tokens, credentials, proxy auth, DEBUG_FILE, NODE_OPTIONS, and unrelated app env.
export function childEnvironment(source = process.env) {
  const names = ['PATH', 'Path', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'SystemRoot', 'SYSTEMROOT', 'WINDIR',
    'COMSPEC', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ', 'TERM',
    'CI', 'GITHUB_ACTIONS', 'GITHUB_WORKSPACE', 'GITHUB_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT',
    'GITHUB_REPOSITORY', 'GITHUB_REF', 'GITHUB_EVENT_NAME', 'RUNNER_OS', 'RUNNER_ARCH', 'RUNNER_TEMP',
    'VITE_SENTRY_DSN', 'VITE_SENTRY_RELEASE', 'VITE_BUILD_COMMIT', 'PLAYWRIGHT_BROWSERS_PATH',
    'DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME'];
  return Object.fromEntries(names.filter(name => source[name] !== undefined).map(name => [name, source[name]]));
}
export function runChild(command, args, { sourceRoot, captureRoot, env = process.env, deadline = Date.now() + 31 * 60_000, stdout = process.stdout, stderr = process.stderr } = {}) {
  mkdirSync(captureRoot, { recursive: true });
  const childEnv = childEnvironment(env);
  Object.assign(childEnv, {
    NODE_OPTIONS: `--require=${JSON.stringify(resolve(here, 'preload.cjs'))}`,
    PW_CAPTURE_ROOT: resolve(captureRoot),
    PW_CAPTURE_CORE: resolve(sourceRoot, 'shinobij.client/node_modules/playwright-core/lib/coreBundle.js'),
    PW_CAPTURE_DEADLINE: String(deadline),
  });
  const child = spawn(command, args, { cwd: sourceRoot, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  // Raw debug never reaches these pipes. Continue draining ordinary test output
  // independently of capture caps; standard backpressure is intentional.
  child.stdout.pipe(stdout, { end: false });
  child.stderr.pipe(stderr, { end: false });
  const forward = signal => {
    try { process.platform === 'win32' ? child.kill(signal) : process.kill(-child.pid, signal); } catch { /* already exited */ }
  };
  const term = () => forward('SIGTERM');
  const interrupt = () => forward('SIGINT');
  process.on('SIGTERM', term); process.on('SIGINT', interrupt);
  return new Promise(resolveResult => {
    let spawnFailed = false;
    child.on('error', () => { spawnFailed = true; });
    child.on('close', (code, signal) => {
      process.off('SIGTERM', term); process.off('SIGINT', interrupt);
      const result = { code: spawnFailed ? 1 : code, signal, spawnFailed };
      try { writeFileSync(resolve(captureRoot, 'child-status.json'), JSON.stringify(result) + '\n'); } catch { stderr.write('[safe-capture] status-write-failed\n'); }
      resolveResult(result);
    });
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const sourceRoot = process.cwd();
  if (readFileSync(resolve(sourceRoot, '.nvmrc'), 'utf8').trim() !== process.versions.node) throw new Error('Node pin mismatch');
  if (process.env.CI !== 'true') throw new Error('Diagnostic requires normal CI mode');
  const result = await runChild('npm', ['run', 'test:e2e', '--prefix', 'shinobij.client', '--', '--shard=9/12'], {
    sourceRoot, captureRoot: resolve(sourceRoot, '.ci-evidence/webkit-protocol/capture'),
  });
  if (result.signal && process.platform !== 'win32') process.kill(process.pid, result.signal);
  else process.exitCode = result.code ?? 1;
}
