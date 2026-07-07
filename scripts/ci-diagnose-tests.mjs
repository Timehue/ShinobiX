import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function testFilesFromPackageScript() {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const script = pkg?.scripts?.test;
  if (typeof script !== 'string') throw new Error('package.json scripts.test is missing');

  const parts = script.trim().split(/\s+/);
  const testIndex = parts.indexOf('--test');
  if (testIndex === -1) throw new Error('scripts.test does not contain --test');

  return parts.slice(testIndex + 1).filter((part) => !part.startsWith('-'));
}

const files = testFilesFromPackageScript();

console.error(`CI diagnostic: aggregate npm test failed; checking ${files.length} test files individually.`);

const env = {
  ...process.env,
  NODE_OPTIONS: [process.env.NODE_OPTIONS, '--test-reporter=spec'].filter(Boolean).join(' '),
};

for (const file of files) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', file], {
    cwd: new URL('..', import.meta.url),
    env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.status !== 0) {
    console.error(`\nCI diagnostic: failing test file: ${file}`);
    if (result.stdout) console.error('\n--- stdout ---\n' + result.stdout.trimEnd());
    if (result.stderr) console.error('\n--- stderr ---\n' + result.stderr.trimEnd());
    process.exit(result.status ?? 1);
  }
}

console.error('CI diagnostic: no single test file failed. The aggregate failure is likely cross-file interaction or resource contention.');
process.exit(1);
